'use strict';

/**
 * VOID OG — Independent Search & ISRC/Recording Deduplication Engine
 *
 * Implements:
 * - `deduplicateOgTracks`:
 *   1. Matches by ISRC wherever available.
 *   2. Considers track title, artist, album, duration, and version/recording identity.
 *   3. NEVER merges different recordings, remixes, live versions, or remasters merely because titles are similar.
 *   4. Prefers the highest verified native quality (bitDepth -> sampleRate -> provenance -> codec) when multiple providers supply the exact same recording.
 *   5. Retains the actual source provider for every result.
 */

function extractRecordingVersionSignature(title = '', album = '') {
  const combined = `${title} ${album}`.toLowerCase();
  const tags = [];
  const rules = [
    [/\b(live|concert|recital|unplugged)\b/, 'live'],
    [/\b(remix|mix|vip|club|dub)\b/, 'remix'],
    [/\b(remaster(?:ed)?(?:\s*\d{4})?)\b/, 'remaster'],
    [/\b(acoustic|stripped)\b/, 'acoustic'],
    [/\b(instrumental|karaoke)\b/, 'instrumental'],
    [/\b(radio\s*edit|short\s*version|single\s*edit)\b/, 'edit'],
    [/\b(extended|full\s*length)\b/, 'extended'],
    [/\b(mono)\b/, 'mono'],
    [/\b(stereo)\b/, 'stereo'],
    [/\b(take\s*\d+|alt(?:ernate)?\s*take)\b/, 'take'],
  ];

  for (const [re, label] of rules) {
    const match = combined.match(re);
    if (match) tags.push(`${label}:${match[0].replace(/\s+/g, '_')}`);
  }
  return tags.sort().join('|');
}

function normalizeIdentityToken(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function computeOgQualityScore(track) {
  if (!track || !track.ogPlayable) return -1;
  const bitDepthScore = (Number(track.bitDepth) || 16) * 1000;
  const sampleRateScore = Math.round((Number(track.sampleRate) || 44100) / 100);
  const provenanceScore =
    track.classifications?.provenanceStatus === 'verified_original_master'
      ? 500
      : track.classifications?.provenanceStatus === 'verified_native_lossless_upload'
        ? 300
        : 0;
  const codecScore =
    track.codec === 'FLAC'
      ? 40
      : track.codec === 'ALAC'
        ? 35
        : track.codec === 'WAV'
          ? 30
          : 25;
  return bitDepthScore + sampleRateScore + provenanceScore + codecScore;
}

/**
 * Determines whether two verified OG tracks represent the exact same recording.
 * Never merges distinct live versions, remixes, remasters, or recordings with >3s duration difference.
 */
function areSameOgRecording(a, b) {
  if (!a || !b) return false;

  const verA = extractRecordingVersionSignature(a.title || a.name, a.album);
  const verB = extractRecordingVersionSignature(b.title || b.name, b.album);
  if (verA !== verB) {
    return false;
  }

  // 1. If both have ISRCs, they must match
  if (a.isrc && b.isrc) {
    return String(a.isrc).trim().toUpperCase() === String(b.isrc).trim().toUpperCase();
  }

  // 2. Compare normalized title, artist, album, and duration (within 3 seconds)
  const titleA = normalizeIdentityToken(a.title || a.name);
  const titleB = normalizeIdentityToken(b.title || b.name);
  const artistA = normalizeIdentityToken(a.artist);
  const artistB = normalizeIdentityToken(b.artist);
  const albumA = normalizeIdentityToken(a.album);
  const albumB = normalizeIdentityToken(b.album);

  if (!titleA || !titleB || titleA !== titleB) return false;
  if (!artistA || !artistB || artistA !== artistB) return false;
  if (albumA && albumB && albumA !== albumB) return false;

  const durA = Number(a.duration) || 0;
  const durB = Number(b.duration) || 0;
  if (durA > 0 && durB > 0 && Math.abs(durA - durB) > 3) {
    return false;
  }

  return true;
}

/**
 * Deduplicates verified OG tracks while preferring the highest verified native lossless quality.
 */
function deduplicateOgTracks(tracks = []) {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const accepted = tracks.filter(
    (t) =>
      t &&
      t.ogVerified === true &&
      t.ogPlayable === true &&
      t.classifications?.technicallyVerifiedLossless === true &&
      t.classifications?.provenanceVerifiedOriginal === true &&
      t.classifications?.rightsClearedPlayable === true
  );

  const deduplicated = [];

  for (const candidate of accepted) {
    const existingIdx = deduplicated.findIndex((ex) => areSameOgRecording(ex, candidate));
    if (existingIdx === -1) {
      deduplicated.push(candidate);
    } else {
      const existing = deduplicated[existingIdx];
      if (computeOgQualityScore(candidate) > computeOgQualityScore(existing)) {
        deduplicated[existingIdx] = candidate;
      }
    }
  }

  return deduplicated;
}

module.exports = {
  extractRecordingVersionSignature,
  computeOgQualityScore,
  areSameOgRecording,
  deduplicateOgTracks,
};
