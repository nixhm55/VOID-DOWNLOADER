/**
 * Binary audio metadata & cover-art embedder for MP4/M4A (ISO BMFF `ilst`/`covr`),
 * MP3 (ID3v2.3 `APIC`), FLAC (`METADATA_BLOCK_PICTURE`), and WAV (`ID3 ` chunk).
 * Ensures every downloaded song file displays its album cover directly on the file
 * icon in macOS Finder, Windows Explorer, and media players without downloading a separate PNG.
 */

export interface AudioTrackMetadata {
  title: string;
  artist: string;
  album?: string;
  coverJpegBytes?: Uint8Array;
}

export interface AudioBinaryProbeResult {
  container: 'flac' | 'm4a' | 'wav' | 'mp3' | 'ogg' | 'webm' | 'unknown';
  codec: 'FLAC' | 'ALAC' | 'WAV' | 'AAC-LC' | 'MP3' | 'Opus' | 'Vorbis' | 'Unknown';
  isLossless: boolean;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
}

export interface EmbeddedAudioResult {
  blob: Blob;
  extension: 'm4a' | 'mp3' | 'flac' | 'wav' | 'alac' | 'aiff' | 'ogg' | 'opus';
  mimeType: string;
  codec: AudioBinaryProbeResult['codec'];
  isLossless: boolean;
  probe: AudioBinaryProbeResult;
}

const textEncoder = new TextEncoder();

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const arr of arrays) total += arr.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.byteLength;
  }
  return out;
}

function writeAscii(target: Uint8Array, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    target[offset + i] = str.charCodeAt(i) & 0xff;
  }
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.byteLength, offset + length);
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function u32be(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, value >>> 0, false);
  return buf;
}

function encodeUtf16LeWithBom(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[2 + i * 2 + 1] = (code >>> 8) & 0xff;
  }
  return out;
}

function encodeSynchsafe32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function buildId3v23TextFrame(frameId: string, value: string): Uint8Array {
  const clean = value.trim();
  if (!clean) return new Uint8Array(0);
  const textBytes = encodeUtf16LeWithBom(clean);
  const bodySize = 1 + textBytes.byteLength;
  const frame = new Uint8Array(10 + bodySize);
  writeAscii(frame, 0, frameId);
  const view = new DataView(frame.buffer);
  view.setUint32(4, bodySize, false);
  frame[8] = 0;
  frame[9] = 0;
  frame[10] = 0x01; // UTF-16 with BOM
  frame.set(textBytes, 11);
  return frame;
}

function buildId3v23ApicFrame(jpegBytes: Uint8Array): Uint8Array {
  const mimeBytes = textEncoder.encode('image/jpeg\0');
  // encoding (1) + mime ('image/jpeg\0' = 11) + picType (1 = 0x03 Front Cover) + desc ('\0' = 1) + jpegBytes
  const bodySize = 1 + mimeBytes.byteLength + 1 + 1 + jpegBytes.byteLength;
  const frame = new Uint8Array(10 + bodySize);
  writeAscii(frame, 0, 'APIC');
  const view = new DataView(frame.buffer);
  view.setUint32(4, bodySize, false);
  frame[8] = 0;
  frame[9] = 0;
  let pos = 10;
  frame[pos++] = 0x00; // ISO-8859-1 for MIME & empty description
  frame.set(mimeBytes, pos);
  pos += mimeBytes.byteLength;
  frame[pos++] = 0x03; // Front Cover
  frame[pos++] = 0x00; // Empty description null-terminator
  frame.set(jpegBytes, pos);
  return frame;
}

function buildId3v23Tag(meta: AudioTrackMetadata): Uint8Array {
  const frames: Uint8Array[] = [];
  if (meta.title) frames.push(buildId3v23TextFrame('TIT2', meta.title));
  if (meta.artist) frames.push(buildId3v23TextFrame('TPE1', meta.artist));
  if (meta.album) frames.push(buildId3v23TextFrame('TALB', meta.album));
  if (meta.coverJpegBytes && meta.coverJpegBytes.byteLength > 0) {
    frames.push(buildId3v23ApicFrame(meta.coverJpegBytes));
  }
  const framesPayload = concatBytes(frames);
  const header = new Uint8Array(10);
  writeAscii(header, 0, 'ID3');
  header[3] = 0x03; // ID3v2.3.0
  header[4] = 0x00;
  header[5] = 0x00;
  header.set(encodeSynchsafe32(framesPayload.byteLength), 6);
  return concatBytes([header, framesPayload]);
}

function embedMp3Metadata(audioBytes: Uint8Array, meta: AudioTrackMetadata): Uint8Array {
  let audioStart = 0;
  if (
    audioBytes.byteLength >= 10 &&
    audioBytes[0] === 0x49 && // 'I'
    audioBytes[1] === 0x44 && // 'D'
    audioBytes[2] === 0x33 // '3'
  ) {
    const flags = audioBytes[5];
    const tagBodySize =
      ((audioBytes[6] & 0x7f) << 21) |
      ((audioBytes[7] & 0x7f) << 14) |
      ((audioBytes[8] & 0x7f) << 7) |
      (audioBytes[9] & 0x7f);
    const footerSize = flags & 0x10 ? 10 : 0;
    const totalExistingTag = 10 + tagBodySize + footerSize;
    if (totalExistingTag < audioBytes.byteLength) {
      audioStart = totalExistingTag;
    }
  }
  const id3Tag = buildId3v23Tag(meta);
  return concatBytes([id3Tag, audioBytes.subarray(audioStart)]);
}

/* ───────────────────────── MP4 / M4A (ISO BMFF) Atom Embedder ───────────────────────── */

interface Mp4Box {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
}

function parseMp4Boxes(bytes: Uint8Array, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = start;
  while (pos + 8 <= end) {
    const rawSize = view.getUint32(pos, false);
    const type = readAscii(bytes, pos + 4, 4);
    let boxSize = rawSize;
    let headerSize = 8;
    if (rawSize === 1) {
      if (pos + 16 > end) break;
      const hi = view.getUint32(pos + 8, false);
      const lo = view.getUint32(pos + 12, false);
      boxSize = hi * 4294967296 + lo;
      headerSize = 16;
    } else if (rawSize === 0) {
      boxSize = end - pos;
    }
    if (boxSize < headerSize || pos + boxSize > end) break;
    boxes.push({ type, offset: pos, size: boxSize, headerSize });
    pos += boxSize;
  }
  return boxes;
}

function makeMp4Box(type: string, payload: Uint8Array): Uint8Array {
  const total = 8 + payload.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total >>> 0, false);
  writeAscii(out, 4, type);
  out.set(payload, 8);
  return out;
}

function makeIlstDataItem(atomType: string, dataTypeFlag: number, valueBytes: Uint8Array): Uint8Array {
  // 'data' box: 8-byte box header + 4-byte type indicator + 4-byte locale (0) + valueBytes
  const dataPayload = new Uint8Array(8 + valueBytes.byteLength);
  const view = new DataView(dataPayload.buffer);
  view.setUint32(0, dataTypeFlag >>> 0, false);
  view.setUint32(4, 0, false);
  dataPayload.set(valueBytes, 8);
  const dataBox = makeMp4Box('data', dataPayload);
  return makeMp4Box(atomType, dataBox);
}

function buildMp4UdtaBox(meta: AudioTrackMetadata): Uint8Array {
  const items: Uint8Array[] = [];
  if (meta.title.trim()) {
    items.push(makeIlstDataItem('\xa9nam', 1, textEncoder.encode(meta.title.trim())));
  }
  if (meta.artist.trim()) {
    items.push(makeIlstDataItem('\xa9ART', 1, textEncoder.encode(meta.artist.trim())));
  }
  if (meta.album?.trim()) {
    items.push(makeIlstDataItem('\xa9alb', 1, textEncoder.encode(meta.album.trim())));
  }
  if (meta.coverJpegBytes && meta.coverJpegBytes.byteLength > 0) {
    // Type 13 (0x0D) = JPEG in MP4 covr data atom
    items.push(makeIlstDataItem('covr', 13, meta.coverJpegBytes));
  }

  const ilstBox = makeMp4Box('ilst', concatBytes(items));

  // Apple 'mdir' handler box required inside 'meta'
  const hdlrPayload = new Uint8Array(25);
  // version/flags (4) = 0, pre_defined (4) = 0, handler_type (4) = 'mdir', reserved (12) = 'appl' + 0, name (1) = 0
  writeAscii(hdlrPayload, 8, 'mdir');
  writeAscii(hdlrPayload, 12, 'appl');
  const hdlrBox = makeMp4Box('hdlr', hdlrPayload);

  const metaVersionFlags = new Uint8Array(4); // FullBox version 0, flags 0
  const metaBox = makeMp4Box('meta', concatBytes([metaVersionFlags, hdlrBox, ilstBox]));
  return makeMp4Box('udta', metaBox);
}

const CONTAINER_BOX_TYPES = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'dinf',
  'mvex',
  'moof',
  'traf',
]);

function shiftMp4ChunkOffsetsInPlace(
  bytes: Uint8Array,
  start: number,
  end: number,
  delta: number,
): void {
  if (delta === 0) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = parseMp4Boxes(bytes, start, end);
  for (const box of boxes) {
    const contentStart = box.offset + box.headerSize;
    const contentEnd = box.offset + box.size;
    if (box.type === 'stco') {
      if (contentStart + 8 <= contentEnd) {
        const count = view.getUint32(contentStart + 4, false);
        for (let i = 0; i < count; i++) {
          const entryPos = contentStart + 8 + i * 4;
          if (entryPos + 4 > contentEnd) break;
          const oldOffset = view.getUint32(entryPos, false);
          view.setUint32(entryPos, (oldOffset + delta) >>> 0, false);
        }
      }
    } else if (box.type === 'co64') {
      if (contentStart + 8 <= contentEnd) {
        const count = view.getUint32(contentStart + 4, false);
        for (let i = 0; i < count; i++) {
          const entryPos = contentStart + 8 + i * 8;
          if (entryPos + 8 > contentEnd) break;
          const hi = view.getUint32(entryPos, false);
          const lo = view.getUint32(entryPos + 4, false);
          const updated = hi * 4294967296 + lo + delta;
          const newHi = Math.floor(updated / 4294967296);
          const newLo = updated >>> 0;
          view.setUint32(entryPos, newHi >>> 0, false);
          view.setUint32(entryPos + 4, newLo >>> 0, false);
        }
      }
    } else if (CONTAINER_BOX_TYPES.has(box.type)) {
      shiftMp4ChunkOffsetsInPlace(bytes, contentStart, contentEnd, delta);
    }
  }
}

function embedMp4Metadata(audioBytes: Uint8Array, meta: AudioTrackMetadata): Uint8Array {
  const topBoxes = parseMp4Boxes(audioBytes, 0, audioBytes.byteLength);
  const moovIdx = topBoxes.findIndex((b) => b.type === 'moov');
  const mdatIdx = topBoxes.findIndex((b) => b.type === 'mdat');
  if (moovIdx === -1) return audioBytes;

  const moovBox = topBoxes[moovIdx];
  const moovChildren = parseMp4Boxes(
    audioBytes,
    moovBox.offset + moovBox.headerSize,
    moovBox.offset + moovBox.size,
  );

  // Keep all non-udta, non-free children of moov, then append our fresh udta box
  const keptChildren: Uint8Array[] = [];
  for (const child of moovChildren) {
    if (child.type === 'udta' || child.type === 'free') continue;
    keptChildren.push(audioBytes.subarray(child.offset, child.offset + child.size));
  }
  const udtaBox = buildMp4UdtaBox(meta);
  keptChildren.push(udtaBox);

  const newMoovPayload = concatBytes(keptChildren);
  const newMoovBox = makeMp4Box('moov', newMoovPayload);
  const delta = newMoovBox.byteLength - moovBox.size;

  // If moov appears before mdat, shift all stco/co64 chunk offsets inside newMoovBox by +delta
  if (mdatIdx !== -1 && moovIdx < mdatIdx && delta !== 0) {
    shiftMp4ChunkOffsetsInPlace(newMoovBox, 8, newMoovBox.byteLength, delta);
  }

  const outChunks: Uint8Array[] = [];
  for (let i = 0; i < topBoxes.length; i++) {
    if (i === moovIdx) {
      outChunks.push(newMoovBox);
    } else {
      const b = topBoxes[i];
      outChunks.push(audioBytes.subarray(b.offset, b.offset + b.size));
    }
  }
  return concatBytes(outChunks);
}

/* ───────────────────────── FLAC Metadata Block Picture Embedder ───────────────────────── */

function buildFlacVorbisCommentBlock(meta: AudioTrackMetadata): Uint8Array {
  const vendor = textEncoder.encode('VOID Downloader');
  const comments: Uint8Array[] = [];
  if (meta.title.trim()) comments.push(textEncoder.encode(`TITLE=${meta.title.trim()}`));
  if (meta.artist.trim()) comments.push(textEncoder.encode(`ARTIST=${meta.artist.trim()}`));
  if (meta.album?.trim()) comments.push(textEncoder.encode(`ALBUM=${meta.album.trim()}`));

  let bodyLen = 4 + vendor.byteLength + 4;
  for (const c of comments) bodyLen += 4 + c.byteLength;

  const body = new Uint8Array(bodyLen);
  const view = new DataView(body.buffer);
  let pos = 0;
  view.setUint32(pos, vendor.byteLength, true);
  pos += 4;
  body.set(vendor, pos);
  pos += vendor.byteLength;
  view.setUint32(pos, comments.length, true);
  pos += 4;
  for (const c of comments) {
    view.setUint32(pos, c.byteLength, true);
    pos += 4;
    body.set(c, pos);
    pos += c.byteLength;
  }

  const header = new Uint8Array(4);
  header[0] = 4; // Block type 4 = VORBIS_COMMENT (not last)
  header[1] = (body.byteLength >>> 16) & 0xff;
  header[2] = (body.byteLength >>> 8) & 0xff;
  header[3] = body.byteLength & 0xff;
  return concatBytes([header, body]);
}

function buildFlacPictureBlock(jpegBytes: Uint8Array, isLast: boolean): Uint8Array {
  const mime = textEncoder.encode('image/jpeg');
  const body = concatBytes([
    u32be(3), // Picture type 3 = Cover (front)
    u32be(mime.byteLength),
    mime,
    u32be(0), // Description length 0
    u32be(600), // Width
    u32be(600), // Height
    u32be(24), // Color depth
    u32be(0), // Indexed colors
    u32be(jpegBytes.byteLength),
    jpegBytes,
  ]);
  const header = new Uint8Array(4);
  header[0] = (isLast ? 0x80 : 0x00) | 6; // Block type 6 = PICTURE
  header[1] = (body.byteLength >>> 16) & 0xff;
  header[2] = (body.byteLength >>> 8) & 0xff;
  header[3] = body.byteLength & 0xff;
  return concatBytes([header, body]);
}

function embedFlacMetadata(audioBytes: Uint8Array, meta: AudioTrackMetadata): Uint8Array {
  if (audioBytes.byteLength < 42 || readAscii(audioBytes, 0, 4) !== 'fLaC') {
    return audioBytes;
  }
  let pos = 4;
  const blocks: { type: number; data: Uint8Array }[] = [];
  while (pos + 4 <= audioBytes.byteLength) {
    const headerByte = audioBytes[pos];
    const isLast = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const length =
      (audioBytes[pos + 1] << 16) | (audioBytes[pos + 2] << 8) | audioBytes[pos + 3];
    pos += 4;
    if (pos + length > audioBytes.byteLength) return audioBytes;
    const blockBody = audioBytes.subarray(pos, pos + length);
    pos += length;
    // Strip old VORBIS_COMMENT (4), PICTURE (6), and PADDING (1) so we write clean ones
    if (blockType !== 4 && blockType !== 6 && blockType !== 1) {
      blocks.push({ type: blockType, data: blockBody });
    }
    if (isLast) break;
  }

  const outParts: Uint8Array[] = [textEncoder.encode('fLaC')];
  const hasCover = Boolean(meta.coverJpegBytes && meta.coverJpegBytes.byteLength > 0);

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const hdr = new Uint8Array(4);
    hdr[0] = b.type & 0x7f;
    hdr[1] = (b.data.byteLength >>> 16) & 0xff;
    hdr[2] = (b.data.byteLength >>> 8) & 0xff;
    hdr[3] = b.data.byteLength & 0xff;
    outParts.push(hdr, b.data);
  }

  const commentBlock = buildFlacVorbisCommentBlock(meta);
  if (!hasCover) {
    commentBlock[0] |= 0x80; // Mark comment block as last if no cover
    outParts.push(commentBlock);
  } else {
    outParts.push(commentBlock);
    outParts.push(buildFlacPictureBlock(meta.coverJpegBytes!, true));
  }

  outParts.push(audioBytes.subarray(pos));
  return concatBytes(outParts);
}

/* ───────────────────────── WAV ID3 Chunk Embedder ───────────────────────── */

function embedWavMetadata(audioBytes: Uint8Array, meta: AudioTrackMetadata): Uint8Array {
  if (
    audioBytes.byteLength < 12 ||
    readAscii(audioBytes, 0, 4) !== 'RIFF' ||
    readAscii(audioBytes, 8, 4) !== 'WAVE'
  ) {
    return audioBytes;
  }
  const id3Tag = buildId3v23Tag(meta);
  const padByte = id3Tag.byteLength % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(0);
  const chunkHeader = new Uint8Array(8);
  writeAscii(chunkHeader, 0, 'ID3 ');
  const view = new DataView(chunkHeader.buffer);
  view.setUint32(4, id3Tag.byteLength, true);

  const combined = concatBytes([audioBytes, chunkHeader, id3Tag, padByte]);
  const riffView = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
  riffView.setUint32(4, combined.byteLength - 8, true);
  return combined;
}

/* ───────────────────────── Binary Codec Inspector (FFprobe-equivalent in JS) ───────────────────────── */

function findMp4SampleEntryCodec(
  bytes: Uint8Array,
  start: number,
  end: number,
): { fourcc: string; sampleRate?: number; channels?: number; bitDepth?: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = parseMp4Boxes(bytes, start, end);
  for (const box of boxes) {
    const contentStart = box.offset + box.headerSize;
    const contentEnd = box.offset + box.size;
    if (box.type === 'stsd') {
      const entryStart = contentStart + 8;
      if (entryStart + 36 <= contentEnd) {
        const entrySize = view.getUint32(entryStart, false);
        const fourcc = readAscii(bytes, entryStart + 4, 4);
        const channels = view.getUint16(entryStart + 24, false);
        const bitDepth = view.getUint16(entryStart + 26, false);
        const sampleRate = view.getUint32(entryStart + 32, false) >>> 16;
        if (fourcc === 'alac' && entryStart + 36 + 24 <= Math.min(contentEnd, entryStart + entrySize)) {
          const childBoxes = parseMp4Boxes(
            bytes,
            entryStart + 36,
            Math.min(contentEnd, entryStart + entrySize),
          );
          const alacBox = childBoxes.find((b) => b.type === 'alac');
          if (alacBox && alacBox.offset + alacBox.headerSize + 28 <= contentEnd) {
            const cfgStart = alacBox.offset + alacBox.headerSize + 4;
            const alacBitDepth = bytes[cfgStart + 5];
            const alacChannels = bytes[cfgStart + 9];
            const alacSampleRate = view.getUint32(cfgStart + 20, false);
            return {
              fourcc,
              sampleRate: alacSampleRate || sampleRate,
              channels: alacChannels || channels,
              bitDepth: alacBitDepth || bitDepth,
            };
          }
        }
        return { fourcc, sampleRate, channels, bitDepth };
      }
    } else if (CONTAINER_BOX_TYPES.has(box.type)) {
      const found = findMp4SampleEntryCodec(bytes, contentStart, contentEnd);
      if (found) return found;
    }
  }
  return null;
}

export function inspectAudioBinaryStream(bytes: Uint8Array): AudioBinaryProbeResult {
  // 1. Native FLAC ('fLaC')
  if (bytes.byteLength >= 42 && readAscii(bytes, 0, 4) === 'fLaC') {
    const siOffset = 8;
    const sampleRate =
      (bytes[siOffset + 10] << 12) | (bytes[siOffset + 11] << 4) | (bytes[siOffset + 12] >> 4);
    const channels = ((bytes[siOffset + 12] >> 1) & 0x07) + 1;
    const bitDepth = (((bytes[siOffset + 12] & 0x01) << 4) | (bytes[siOffset + 13] >> 4)) + 1;
    return {
      container: 'flac',
      codec: 'FLAC',
      isLossless: true,
      sampleRate: sampleRate || 44100,
      channels: channels || 2,
      bitDepth: bitDepth || 16,
    };
  }

  // 2. ISO BMFF / MP4 / M4A ('ftyp' at bytes 4..7)
  if (bytes.byteLength >= 12 && readAscii(bytes, 4, 4) === 'ftyp') {
    const sampleEntry = findMp4SampleEntryCodec(bytes, 0, bytes.byteLength);
    if (sampleEntry) {
      const fcc = sampleEntry.fourcc.trim();
      if (fcc === 'alac') {
        return {
          container: 'm4a',
          codec: 'ALAC',
          isLossless: true,
          sampleRate: sampleEntry.sampleRate,
          channels: sampleEntry.channels,
          bitDepth: sampleEntry.bitDepth,
        };
      }
      if (fcc === 'fLaC') {
        return {
          container: 'm4a',
          codec: 'FLAC',
          isLossless: true,
          sampleRate: sampleEntry.sampleRate,
          channels: sampleEntry.channels,
          bitDepth: sampleEntry.bitDepth,
        };
      }
      if (fcc === 'Opus') {
        return {
          container: 'm4a',
          codec: 'Opus',
          isLossless: false,
          sampleRate: sampleEntry.sampleRate,
          channels: sampleEntry.channels,
        };
      }
      return {
        container: 'm4a',
        codec: 'AAC-LC',
        isLossless: false,
        sampleRate: sampleEntry.sampleRate,
        channels: sampleEntry.channels,
      };
    }
    return {
      container: 'm4a',
      codec: 'AAC-LC',
      isLossless: false,
    };
  }

  // 3. RIFF WAVE ('RIFF'....'WAVE')
  if (
    bytes.byteLength >= 36 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WAVE'
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitDepth = view.getUint16(34, true);
    return {
      container: 'wav',
      codec: 'WAV',
      isLossless: true,
      sampleRate: sampleRate || 44100,
      channels: channels || 2,
      bitDepth: bitDepth || 16,
    };
  }

  // 4. Ogg ('OggS')
  if (bytes.byteLength >= 36 && readAscii(bytes, 0, 4) === 'OggS') {
    const headerAscii = readAscii(bytes, 28, 12);
    if (headerAscii.includes('FLAC')) {
      return { container: 'ogg', codec: 'FLAC', isLossless: true };
    }
    if (headerAscii.includes('OpusHead')) {
      return { container: 'ogg', codec: 'Opus', isLossless: false };
    }
    return { container: 'ogg', codec: 'Vorbis', isLossless: false };
  }

  // 5. MP3 ('ID3' or MPEG frame sync)
  if (
    (bytes.byteLength >= 3 && readAscii(bytes, 0, 3) === 'ID3') ||
    (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return {
      container: 'mp3',
      codec: 'MP3',
      isLossless: false,
    };
  }

  return {
    container: 'unknown',
    codec: 'Unknown',
    isLossless: false,
  };
}

export async function probeAudioBlob(blob: Blob): Promise<AudioBinaryProbeResult> {
  const buf = await blob.arrayBuffer();
  return inspectAudioBinaryStream(new Uint8Array(buf));
}

/* ───────────────────────── Pure-JS Apple Lossless (ALAC) .m4a Container Encoder ───────────────────────── */

function u16be(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value & 0xffff, false);
  return buf;
}

export function buildAlacM4aFromPcm16Stereo(
  leftInt16: Int16Array,
  rightInt16: Int16Array,
  sampleRate = 44100,
): Uint8Array {
  const totalSamples = leftInt16.length;
  const maxFrame = 4096;
  const frames: Uint8Array[] = [];
  const frameSizes: number[] = [];
  let offset = 0;

  while (offset < totalSamples) {
    const n = Math.min(maxFrame, totalSamples - offset);
    const hasSize = n !== maxFrame ? 1 : 0;
    const totalBits = 3 + 16 + 1 + 2 + 1 + (hasSize ? 32 : 0) + n * 2 * 16 + 3;
    const buf = new Uint8Array(Math.ceil(totalBits / 8));
    let bitPos = 0;
    const writeBits = (val: number, bits: number) => {
      for (let i = bits - 1; i >= 0; i--) {
        if ((val >>> i) & 1) {
          buf[bitPos >>> 3] |= 1 << (7 - (bitPos & 7));
        }
        bitPos++;
      }
    };
    writeBits(1, 3); // ID_CPE (stereo channel pair)
    writeBits(0, 16); // unused header bits
    writeBits(hasSize, 1);
    writeBits(0, 2); // uncompressed_bytes = 0
    writeBits(1, 1); // is_uncompressed = 1 (verbatim 16-bit lossless ALAC frame)
    if (hasSize) writeBits(n >>> 0, 32);
    for (let i = 0; i < n; i++) {
      writeBits(leftInt16[offset + i] & 0xffff, 16);
      writeBits(rightInt16[offset + i] & 0xffff, 16);
    }
    writeBits(7, 3); // ID_END
    frames.push(buf);
    frameSizes.push(buf.byteLength);
    offset += n;
  }

  const mdatPayload = concatBytes(frames);
  const ftyp = makeMp4Box(
    'ftyp',
    concatBytes([
      textEncoder.encode('M4A '),
      u32be(0),
      textEncoder.encode('M4A mp42isom\0\0\0\0'),
    ]),
  );

  const avgBitRate = Math.round(
    (mdatPayload.byteLength * 8 * sampleRate) / Math.max(1, totalSamples),
  );
  const alacCookie = concatBytes([
    u32be(0),
    u32be(maxFrame),
    new Uint8Array([0, 16, 40, 10, 14, 2]),
    u16be(255),
    u32be(maxFrame * 4 + 16),
    u32be(avgBitRate),
    u32be(sampleRate),
  ]);
  const alacSpecificBox = makeMp4Box('alac', alacCookie);

  const sampleEntryPayload = concatBytes([
    new Uint8Array(6),
    u16be(1),
    new Uint8Array(8),
    u16be(2),
    u16be(16),
    u16be(0),
    u16be(0),
    u32be((sampleRate & 0xffff) << 16),
    alacSpecificBox,
  ]);
  const stsd = makeMp4Box(
    'stsd',
    concatBytes([u32be(0), u32be(1), makeMp4Box('alac', sampleEntryPayload)]),
  );

  const numFrames = frameSizes.length;
  const lastFrameSamples = totalSamples - (numFrames - 1) * maxFrame;
  const sttsEntries =
    numFrames > 1 && lastFrameSamples !== maxFrame
      ? concatBytes([
          u32be(0),
          u32be(2),
          u32be(numFrames - 1),
          u32be(maxFrame),
          u32be(1),
          u32be(lastFrameSamples),
        ])
      : concatBytes([
          u32be(0),
          u32be(1),
          u32be(numFrames),
          u32be(numFrames === 1 ? lastFrameSamples : maxFrame),
        ]);
  const stts = makeMp4Box('stts', sttsEntries);
  const stsc = makeMp4Box(
    'stsc',
    concatBytes([u32be(0), u32be(1), u32be(1), u32be(numFrames), u32be(1)]),
  );
  const stsz = makeMp4Box(
    'stsz',
    concatBytes([u32be(0), u32be(0), u32be(numFrames), ...frameSizes.map(u32be)]),
  );
  const stco = makeMp4Box('stco', concatBytes([u32be(0), u32be(1), u32be(0)]));
  const stbl = makeMp4Box('stbl', concatBytes([stsd, stts, stsc, stsz, stco]));
  const smhd = makeMp4Box('smhd', new Uint8Array(8));
  const dref = makeMp4Box('dref', concatBytes([u32be(0), u32be(1), makeMp4Box('url ', u32be(1))]));
  const dinf = makeMp4Box('dinf', dref);
  const minf = makeMp4Box('minf', concatBytes([smhd, dinf, stbl]));
  const mdhd = makeMp4Box(
    'mdhd',
    concatBytes([
      u32be(0),
      u32be(0),
      u32be(0),
      u32be(sampleRate),
      u32be(totalSamples),
      u16be(0x55c4),
      u16be(0),
    ]),
  );
  const hdlr = makeMp4Box(
    'hdlr',
    concatBytes([
      u32be(0),
      u32be(0),
      textEncoder.encode('soun'),
      new Uint8Array(12),
      new Uint8Array([0]),
    ]),
  );
  const mdia = makeMp4Box('mdia', concatBytes([mdhd, hdlr, minf]));
  const tkhd = makeMp4Box(
    'tkhd',
    concatBytes([
      u32be(0x00000007),
      u32be(0),
      u32be(0),
      u32be(1),
      u32be(0),
      u32be(totalSamples),
      new Uint8Array(8),
      u16be(0),
      u16be(0),
      u16be(0x0100),
      u16be(0),
      u32be(0x00010000),
      u32be(0),
      u32be(0),
      u32be(0),
      u32be(0x00010000),
      u32be(0),
      u32be(0),
      u32be(0),
      u32be(0x40000000),
      u32be(0),
      u32be(0),
    ]),
  );
  const trak = makeMp4Box('trak', concatBytes([tkhd, mdia]));
  const mvhd = makeMp4Box(
    'mvhd',
    concatBytes([
      u32be(0),
      u32be(0),
      u32be(0),
      u32be(sampleRate),
      u32be(totalSamples),
      u32be(0x00010000),
      u16be(0x0100),
      new Uint8Array(10),
      u32be(0x00010000),
      u32be(0),
      u32be(0),
      u32be(0),
      u32be(0x00010000),
      u32be(0),
      u32be(0),
      u32be(0),
      u32be(0x40000000),
      new Uint8Array(24),
      u32be(2),
    ]),
  );
  const moov = makeMp4Box('moov', concatBytes([mvhd, trak]));
  const mdatChunkOffset = ftyp.byteLength + moov.byteLength + 8;
  new DataView(moov.buffer, moov.byteOffset, moov.byteLength).setUint32(
    moov.byteLength - 4,
    mdatChunkOffset,
    false,
  );
  const mdat = makeMp4Box('mdat', mdatPayload);
  return concatBytes([ftyp, moov, mdat]);
}

export async function convertAudioBlobToAlacM4a(blob: Blob): Promise<Blob | null> {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  const ctx = new AudioCtx({ sampleRate: 44100 });
  try {
    const rawBuf = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(rawBuf.slice(0));
    const sr = audioBuffer.sampleRate || 44100;
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    const len = ch0.length;
    const left16 = new Int16Array(len);
    const right16 = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const l = Math.max(-1, Math.min(1, ch0[i]));
      const r = Math.max(-1, Math.min(1, ch1[i]));
      left16[i] = l < 0 ? Math.round(l * 32768) : Math.round(l * 32767);
      right16[i] = r < 0 ? Math.round(r * 32768) : Math.round(r * 32767);
    }
    const alacBytes = buildAlacM4aFromPcm16Stereo(left16, right16, sr);
    return new Blob([alacBytes], { type: 'audio/alac' });
  } catch {
    return null;
  } finally {
    try {
      await ctx.close();
    } catch {
      // Ignore
    }
  }
}

/* ───────────────────────── Master Container Detector & Embedder ───────────────────────── */

export async function embedMetadataAndCoverIntoAudio(
  audioBlob: Blob,
  meta: AudioTrackMetadata,
  fallbackCodecHint?: string,
  categoryHint?: string,
  urlHint?: string,
): Promise<EmbeddedAudioResult> {
  const buffer = await audioBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const probe = inspectAudioBinaryStream(bytes);
  const hintUpper = String(fallbackCodecHint || '').toUpperCase();
  const cat = String(categoryHint || '').trim();
  const lowerUrl = String(urlHint || '').toLowerCase();

  // 1. Native FLAC container (bytes 0..3 === 'fLaC')
  if (bytes.byteLength >= 4 && readAscii(bytes, 0, 4) === 'fLaC') {
    try {
      const tagged = embedFlacMetadata(bytes, meta);
      return {
        blob: new Blob([tagged], { type: 'audio/flac' }),
        extension: 'flac',
        mimeType: 'audio/flac',
        codec: 'FLAC',
        isLossless: true,
        probe,
      };
    } catch {
      return {
        blob: new Blob([bytes], { type: 'audio/flac' }),
        extension: 'flac',
        mimeType: 'audio/flac',
        codec: 'FLAC',
        isLossless: true,
        probe,
      };
    }
  }

  // 2. Native WAV container (bytes 0..3 === 'RIFF' && bytes 8..11 === 'WAVE')
  if (
    bytes.byteLength >= 12 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WAVE'
  ) {
    try {
      const tagged = embedWavMetadata(bytes, meta);
      return {
        blob: new Blob([tagged], { type: 'audio/wav' }),
        extension: 'wav',
        mimeType: 'audio/wav',
        codec: 'WAV',
        isLossless: true,
        probe,
      };
    } catch {
      return {
        blob: new Blob([bytes], { type: 'audio/wav' }),
        extension: 'wav',
        mimeType: 'audio/wav',
        codec: 'WAV',
        isLossless: true,
        probe,
      };
    }
  }

  // 3. Native AIFF container ('FORM'....'AIFF')
  if (
    (bytes.byteLength >= 12 &&
      readAscii(bytes, 0, 4) === 'FORM' &&
      readAscii(bytes, 8, 4) === 'AIFF') ||
    hintUpper.includes('AIFF') ||
    /\.aiff?(\?|$)/i.test(lowerUrl)
  ) {
    return {
      blob: new Blob([bytes], { type: 'audio/aiff' }),
      extension: 'aiff',
      mimeType: 'audio/aiff',
      codec: 'WAV',
      isLossless: true,
      probe,
    };
  }

  // 4. Ogg / Opus container ('OggS')
  if (probe.container === 'ogg') {
    const isOpus = probe.codec === 'Opus' || hintUpper.includes('OPUS');
    const ext = isOpus ? 'opus' : 'ogg';
    const mime = isOpus ? 'audio/opus' : 'audio/ogg';
    return {
      blob: new Blob([bytes], { type: mime }),
      extension: ext,
      mimeType: mime,
      codec: probe.codec,
      isLossless: probe.isLossless,
      probe,
    };
  }

  // 5. MP4 / ISO BMFF container (bytes 4..7 === 'ftyp')
  if (bytes.byteLength >= 12 && readAscii(bytes, 4, 4) === 'ftyp') {
    const isAlac =
      probe.codec === 'ALAC' ||
      cat === 'Hi-Res Lossless' ||
      hintUpper.includes('ALAC') ||
      /\.alac(\?|$)/i.test(lowerUrl);
    const isFlacInMp4 =
      probe.codec === 'FLAC' ||
      (cat === 'Lossless' && !isAlac && (hintUpper.includes('FLAC') || /\.flac(\?|$)/i.test(lowerUrl)));

    const ext: EmbeddedAudioResult['extension'] = isAlac
      ? 'alac'
      : isFlacInMp4
        ? 'flac'
        : cat === 'Very High'
          ? 'mp3'
          : 'm4a';
    const mime = isAlac
      ? 'audio/alac'
      : isFlacInMp4
        ? 'audio/flac'
        : ext === 'mp3'
          ? 'audio/mpeg'
          : 'audio/mp4';
    try {
      const tagged = embedMp4Metadata(bytes, meta);
      return {
        blob: new Blob([tagged], { type: mime }),
        extension: ext,
        mimeType: mime,
        codec: isAlac ? 'ALAC' : probe.codec,
        isLossless: isAlac || probe.isLossless,
        probe,
      };
    } catch {
      return {
        blob: new Blob([bytes], { type: mime }),
        extension: ext,
        mimeType: mime,
        codec: isAlac ? 'ALAC' : probe.codec,
        isLossless: isAlac || probe.isLossless,
        probe,
      };
    }
  }

  // 6. Category-specific automatic format detection for Lossless / Hi-Res Lossless
  if (cat === 'Hi-Res Lossless' || hintUpper.includes('ALAC')) {
    return {
      blob: new Blob([bytes], { type: 'audio/alac' }),
      extension: 'alac',
      mimeType: 'audio/alac',
      codec: 'ALAC',
      isLossless: true,
      probe,
    };
  }
  if (cat === 'Lossless' || hintUpper.includes('FLAC')) {
    const isWavHint = hintUpper.includes('WAV') || /\.wav(\?|$)/i.test(lowerUrl);
    return {
      blob: new Blob([bytes], { type: isWavHint ? 'audio/wav' : 'audio/flac' }),
      extension: isWavHint ? 'wav' : 'flac',
      mimeType: isWavHint ? 'audio/wav' : 'audio/flac',
      codec: isWavHint ? 'WAV' : 'FLAC',
      isLossless: true,
      probe,
    };
  }

  // 7. MP3 / Very High / High fallback with ID3v2.3 APIC cover art
  try {
    const tagged = embedMp3Metadata(bytes, meta);
    return {
      blob: new Blob([tagged], { type: 'audio/mpeg' }),
      extension: 'mp3',
      mimeType: 'audio/mpeg',
      codec: 'MP3',
      isLossless: false,
      probe: { ...probe, container: 'mp3', codec: 'MP3', isLossless: false },
    };
  } catch {
    return {
      blob: audioBlob,
      extension: 'mp3',
      mimeType: audioBlob.type || 'audio/mpeg',
      codec: probe.codec,
      isLossless: probe.isLossless,
      probe,
    };
  }
}
