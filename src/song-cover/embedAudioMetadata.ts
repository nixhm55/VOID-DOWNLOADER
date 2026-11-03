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

export interface EmbeddedAudioResult {
  blob: Blob;
  extension: 'm4a' | 'mp3' | 'flac' | 'wav';
  mimeType: string;
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

/* ───────────────────────── Master Container Detector & Embedder ───────────────────────── */

export async function embedMetadataAndCoverIntoAudio(
  audioBlob: Blob,
  meta: AudioTrackMetadata,
  fallbackCodecHint?: string,
): Promise<EmbeddedAudioResult> {
  const buffer = await audioBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 1. Detect MP4 / M4A container (bytes 4..7 === 'ftyp')
  if (bytes.byteLength >= 12 && readAscii(bytes, 4, 4) === 'ftyp') {
    try {
      const tagged = embedMp4Metadata(bytes, meta);
      return {
        blob: new Blob([tagged], { type: 'audio/mp4' }),
        extension: 'm4a',
        mimeType: 'audio/mp4',
      };
    } catch {
      return {
        blob: new Blob([bytes], { type: 'audio/mp4' }),
        extension: 'm4a',
        mimeType: 'audio/mp4',
      };
    }
  }

  // 2. Detect FLAC container (bytes 0..3 === 'fLaC')
  if (bytes.byteLength >= 4 && readAscii(bytes, 0, 4) === 'fLaC') {
    try {
      const tagged = embedFlacMetadata(bytes, meta);
      return {
        blob: new Blob([tagged], { type: 'audio/flac' }),
        extension: 'flac',
        mimeType: 'audio/flac',
      };
    } catch {
      return {
        blob: new Blob([bytes], { type: 'audio/flac' }),
        extension: 'flac',
        mimeType: 'audio/flac',
      };
    }
  }

  // 3. Detect WAV container (bytes 0..3 === 'RIFF' && bytes 8..11 === 'WAVE')
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
      };
    } catch {
      return {
        blob: new Blob([bytes], { type: 'audio/wav' }),
        extension: 'wav',
        mimeType: 'audio/wav',
      };
    }
  }

  // 4. Detect MP3 (ID3v2 header or MPEG frame sync) or fallback to MP3 with ID3v2.3 APIC
  const isMp3 =
    (bytes.byteLength >= 3 && readAscii(bytes, 0, 3) === 'ID3') ||
    (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ||
    /mp3|mpeg/i.test(audioBlob.type || fallbackCodecHint || '');

  if (isMp3) {
    try {
      const tagged = embedMp3Metadata(bytes, meta);
      return {
        blob: new Blob([tagged], { type: 'audio/mpeg' }),
        extension: 'mp3',
        mimeType: 'audio/mpeg',
      };
    } catch {
      return {
        blob: new Blob([bytes], { type: 'audio/mpeg' }),
        extension: 'mp3',
        mimeType: 'audio/mpeg',
      };
    }
  }

  // Fallback for any other stream: prepend ID3v2.3 tag so media players & Finder still read cover art
  try {
    const tagged = embedMp3Metadata(bytes, meta);
    return {
      blob: new Blob([tagged], { type: 'audio/mpeg' }),
      extension: 'mp3',
      mimeType: 'audio/mpeg',
    };
  } catch {
    return {
      blob: audioBlob,
      extension: 'm4a',
      mimeType: audioBlob.type || 'audio/mp4',
    };
  }
}
