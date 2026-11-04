/** Original ID3v2 text/APIC parser from src/lib/library.ts, isolated for song artwork reuse. */
function decodeId3Text(frame: Uint8Array) {
  const encoding = frame[0];
  const bytes = frame.slice(1);
  try {
    if (encoding === 1) return new TextDecoder('utf-16').decode(bytes).replace(/\0+$/g, '').trim();
    if (encoding === 2) return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/g, '').trim();
    if (encoding === 0) return new TextDecoder('windows-1252').decode(bytes).replace(/\0+$/g, '').trim();
    return new TextDecoder().decode(bytes).replace(/\0+$/g, '').trim();
  } catch { return ''; }
}

export async function readMp3Tags(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'mp3' || file.size < 10) return {};
  try {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 3 * 1024 * 1024)).arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 3)) !== 'ID3') return {};
    const version = bytes[3];
    const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    let offset = 10;
    const tags: { title?: string; artist?: string; album?: string; artwork?: Blob } = {};
    const frameEnd = Math.min(bytes.length, 10 + tagSize);
    while (offset + 10 < frameEnd) {
      const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = version === 4
        ? ((bytes[offset + 4] & 0x7f) << 21) | ((bytes[offset + 5] & 0x7f) << 14) | ((bytes[offset + 6] & 0x7f) << 7) | (bytes[offset + 7] & 0x7f)
        : bytes[offset + 4] * 0x1000000 + bytes[offset + 5] * 0x10000 + bytes[offset + 6] * 0x100 + bytes[offset + 7];
      offset += 10;
      if (!size || offset + size > frameEnd) break;
      const frame = bytes.slice(offset, offset + size);
      if (id === 'TIT2') tags.title = decodeId3Text(frame);
      if (id === 'TPE1') tags.artist = decodeId3Text(frame);
      if (id === 'TALB') tags.album = decodeId3Text(frame);
      if (id === 'APIC' && !tags.artwork) {
        const encoding = frame[0];
        let cursor = 1;
        while (cursor < frame.length && frame[cursor] !== 0) cursor += 1;
        const mime = new TextDecoder().decode(frame.slice(1, cursor)) || 'image/jpeg';
        cursor += 1; // MIME terminator
        cursor += 1; // picture type
        const wide = encoding === 1 || encoding === 2;
        while (cursor < frame.length) {
          const first = frame[cursor];
          const second = wide ? frame[cursor + 1] : 0;
          if (first === 0 && second === 0) { cursor += wide ? 2 : 1; break; }
          cursor += wide ? 2 : 1;
        }
        if (cursor < frame.length) tags.artwork = new Blob([frame.slice(cursor).buffer as ArrayBuffer], { type: mime });
      }
      offset += size;
    }
    return tags;
  } catch { return {}; }
}
