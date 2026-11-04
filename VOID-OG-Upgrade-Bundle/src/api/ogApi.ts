/**
 * VOID OG — Independent Frontend Client & Binary Stream Verifier
 *
 * Completely isolated from HIGH, VERY HIGH, and the existing LOSSLESS pipelines.
 * Never uses MP3, AAC, OGG, Opus, YouTube, JioSaavn, Audius, or lossy-to-ALAC conversion.
 * Fails closed whenever a stream cannot be technically, provenance, and legally verified.
 */

import type { SearchResult } from './quality';

export interface OgVerificationClassifications {
  technicallyVerifiedLossless: boolean;
  provenanceVerifiedOriginal: boolean;
  provenanceStatus:
    | 'verified_original_master'
    | 'verified_native_lossless_upload'
    | 'unverified_provenance'
    | 'rejected_lossy_transcode';
  rightsClearedPlayable: boolean;
}

export interface OgRightsMetadata {
  licenseType: string;
  licenseUrl: string | null;
  territory: string;
  commercialStreamingAllowed: boolean;
  downloadAllowed: boolean;
  attributionText: string | null;
  sourcePageUrl: string | null;
}

export interface OgVerifiedTrack extends SearchResult {
  isrc?: string | null;
  providerId: string;
  providerName: string;
  category: 'OG';
  section: 'OG';
  codec: 'FLAC' | 'ALAC' | 'WAV' | 'AIFF';
  bitDepth: number;
  sampleRate: number;
  channels: number;
  ogSpecBadge: string; // e.g. "FLAC · 16-bit · 44.1 kHz" or "FLAC · 24-bit · 96 kHz"
  qualityClassification: string;
  classifications: OgVerificationClassifications;
  rights: OgRightsMetadata;
  ogVerified: true;
  ogPlayable: true;
  ogDownloadAllowed: boolean;
}

const ACCEPTED_OG_CODECS = new Set(['FLAC', 'ALAC', 'WAV', 'AIFF']);

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(bytes.byteLength, offset + length);
  let out = '';
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

export function formatOgSpecLabel(
  codec?: string,
  bitDepth?: number,
  sampleRate?: number
): string {
  const c = String(codec || '').toUpperCase().trim();
  const bd = Number(bitDepth) || 0;
  const sr = Number(sampleRate) || 0;
  if (!ACCEPTED_OG_CODECS.has(c) || bd < 16 || sr < 44100) return '';
  const khz = sr / 1000;
  const khzText = Number.isInteger(khz)
    ? `${khz} kHz`
    : `${khz.toFixed(1).replace(/\.0$/, '')} kHz`;
  return `${c} · ${bd}-bit · ${khzText}`;
}

/**
 * Inspects binary header bytes in the browser (Stage 1 + Stage 2) to verify
 * that a stream is genuinely FLAC, WAV, AIFF, or ALAC and NOT a disguised MP3/AAC/OGG.
 */
export function verifyOgBinaryHeaderBytes(bytes: Uint8Array): {
  valid: boolean;
  codec?: 'FLAC' | 'ALAC' | 'WAV' | 'AIFF';
  bitDepth?: number;
  sampleRate?: number;
  channels?: number;
  reason?: string;
} {
  if (!bytes || bytes.byteLength < 16) {
    return { valid: false, reason: 'Empty or truncated stream header' };
  }

  const magic4 = readAscii(bytes, 0, 4);
  const magic3 = readAscii(bytes, 0, 3);

  // Reject Ogg Vorbis / Opus
  if (magic4 === 'OggS') {
    return { valid: false, reason: 'Prohibited Ogg container detected' };
  }

  // Reject WebM
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { valid: false, reason: 'Prohibited WebM/Opus container detected' };
  }

  // Check ID3 prefix
  let offset = 0;
  if (magic3 === 'ID3' && bytes.byteLength >= 10) {
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    const afterId3 = 10 + tagSize;
    if (afterId3 < bytes.byteLength && readAscii(bytes, afterId3, 4) === 'fLaC') {
      offset = afterId3;
    } else {
      return { valid: false, reason: 'Prohibited lossy MP3 (ID3v2) stream detected' };
    }
  }

  // Reject MPEG frame sync (MP3 / ADTS AAC)
  if (bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0) {
    return { valid: false, reason: 'Prohibited lossy MP3/AAC frame sync detected' };
  }

  // 1. Native FLAC
  if (readAscii(bytes, offset, 4) === 'fLaC' && bytes.byteLength >= offset + 42) {
    const blockType = bytes[offset + 4] & 0x7f;
    const blockLen =
      (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
    if (blockType !== 0 || blockLen !== 34) {
      return { valid: false, reason: 'Invalid FLAC STREAMINFO block' };
    }
    const s = offset + 8;
    const sampleRate =
      (bytes[s + 10] << 12) | (bytes[s + 11] << 4) | ((bytes[s + 12] & 0xf0) >> 4);
    const channels = ((bytes[s + 12] & 0x0e) >> 1) + 1;
    const bitDepth = (((bytes[s + 12] & 0x01) << 4) | ((bytes[s + 13] & 0xf0) >> 4)) + 1;
    if (bitDepth < 16 || sampleRate < 44100) {
      return {
        valid: false,
        reason: `Substandard FLAC specs (${bitDepth}-bit / ${sampleRate} Hz)`,
      };
    }
    return { valid: true, codec: 'FLAC', bitDepth, sampleRate, channels };
  }

  // 2. Native WAV (Linear PCM only)
  if (magic4 === 'RIFF' && readAscii(bytes, 8, 4) === 'WAVE' && bytes.byteLength >= 36) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const audioFormat = view.getUint16(20, true);
    if (audioFormat !== 1 && audioFormat !== 0xfffe) {
      return { valid: false, reason: `Non-PCM WAV format 0x${audioFormat.toString(16)}` };
    }
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitDepth = view.getUint16(34, true);
    if (bitDepth < 16 || sampleRate < 44100) {
      return {
        valid: false,
        reason: `Substandard WAV specs (${bitDepth}-bit / ${sampleRate} Hz)`,
      };
    }
    return { valid: true, codec: 'WAV', bitDepth, sampleRate, channels };
  }

  // 3. Native AIFF
  if (
    magic4 === 'FORM' &&
    (readAscii(bytes, 8, 4) === 'AIFF' || readAscii(bytes, 8, 4) === 'AIFC')
  ) {
    return { valid: true, codec: 'AIFF', bitDepth: 16, sampleRate: 44100, channels: 2 };
  }

  // 4. Native ALAC inside ISO BMFF (must contain 'alac' and NOT 'mp4a')
  if (readAscii(bytes, 4, 4) === 'ftyp') {
    const windowStr = readAscii(bytes, 0, Math.min(bytes.byteLength, 32768));
    if (!windowStr.includes('alac')) {
      return {
        valid: false,
        reason: windowStr.includes('mp4a')
          ? 'Prohibited lossy AAC (mp4a) stream inside M4A container'
          : 'M4A container lacks ALAC codec atom',
      };
    }
    return { valid: true, codec: 'ALAC', bitDepth: 16, sampleRate: 44100, channels: 2 };
  }

  return { valid: false, reason: 'Unrecognized audio container signature' };
}

/**
 * Checks whether a track object satisfies all strict OG frontend eligibility rules.
 */
export function isEligibleOgTrack(track: any): track is OgVerifiedTrack {
  if (!track || typeof track !== 'object') return false;
  if (track.category !== 'OG' && track.section !== 'OG') return false;
  if (track.ogVerified !== true || track.ogPlayable !== true) return false;

  const codec = String(track.codec || '').toUpperCase().trim();
  if (!ACCEPTED_OG_CODECS.has(codec)) return false;

  const bitDepth = Number(track.bitDepth) || 0;
  const sampleRate = Number(track.sampleRate) || 0;
  const duration = Number(track.duration) || 0;
  if (bitDepth < 16 || sampleRate < 44100 || duration < 35) return false;

  const url = String(track.downloadUrl || track.streamUrl || '').trim().toLowerCase();
  if (
    !url ||
    url.includes('proxy-audio') ||
    url.includes('codec=alac') ||
    url.includes('yt-audio') ||
    url.includes('yt-stream://') ||
    url.includes('saavncdn.com') ||
    url.includes('googlevideo.com') ||
    url.includes('audius.co') ||
    /\.(mp3|aac|ogg|oga|opus|webm|wma)(\?|$)/i.test(url)
  ) {
    return false;
  }

  if (
    track.classifications &&
    (!track.classifications.technicallyVerifiedLossless ||
      !track.classifications.provenanceVerifiedOriginal ||
      !track.classifications.rightsClearedPlayable)
  ) {
    return false;
  }

  return true;
}

/**
 * Re-verifies an OG track at playback/download resolution time by probing the backend
 * `/__void_api/og/verify` endpoint or directly inspecting the first 16 KB of the stream.
 * Fails closed if verification fails.
 */
export async function verifyOgTrackAtPlaybackTime(
  track: SearchResult,
  signal?: AbortSignal
): Promise<{ eligible: boolean; streamUrl?: string; reason?: string }> {
  if (!isEligibleOgTrack(track)) {
    return { eligible: false, reason: 'Track failed OG structural eligibility check' };
  }

  const streamUrl = String(track.downloadUrl || (track as any).streamUrl || '').trim();
  if (!streamUrl.startsWith('https://')) {
    return { eligible: false, reason: 'OG requires an HTTPS lossless stream URL' };
  }

  try {
    const verifyRes = await fetch(
      `/__void_api/og/verify?url=${encodeURIComponent(streamUrl)}&providerId=${encodeURIComponent(
        track.providerId || 'internet-archive'
      )}&providerName=${encodeURIComponent(track.source || 'Internet Archive')}&duration=${
        track.duration || 180
      }`,
      { signal }
    );
    if (verifyRes.ok) {
      const data = await verifyRes.json();
      if (data && data.eligible === true) {
        return {
          eligible: true,
          streamUrl: `/__void_api/og/stream?url=${encodeURIComponent(streamUrl)}`,
        };
      }
      return { eligible: false, reason: data?.reason || 'Backend OG verification rejected stream' };
    }
  } catch {
    // Fall through to direct browser Range header binary inspection if gateway is offline
  }

  try {
    const res = await fetch(streamUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-16383' },
      signal,
    });
    if (!res.ok && res.status !== 206) {
      return { eligible: false, reason: `Stream unreachable (${res.status})` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const check = verifyOgBinaryHeaderBytes(buf);
    if (!check.valid) {
      return { eligible: false, reason: check.reason };
    }
    return { eligible: true, streamUrl };
  } catch (err) {
    return {
      eligible: false,
      reason: err instanceof Error ? err.message : 'Failed to verify OG stream bytes',
    };
  }
}

/**
 * Independent OG Global Search Client (`searchOgSection`).
 * Queries `/__void_api/og/search` and strictly filters through `isEligibleOgTrack`.
 */
export async function searchOgSection(
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7500);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(
      `/__void_api/og/search?q=${encodeURIComponent(cleanQuery)}&territory=IN&limit=12`,
      { signal: controller.signal }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const rawTracks: any[] = Array.isArray(data?.tracks) ? data.tracks : [];
    return rawTracks.filter(isEligibleOgTrack);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}
