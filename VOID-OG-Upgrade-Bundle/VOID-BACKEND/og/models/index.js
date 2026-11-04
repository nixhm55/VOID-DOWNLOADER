'use strict';

/**
 * VOID OG — Models & Verified Track Builders
 *
 * Enforces strict separation between:
 * 1. Technically verified lossless file (`technicallyVerifiedLossless`)
 * 2. Provenance-verified original lossless source (`provenanceVerifiedOriginal`)
 * 3. Rights-cleared playable lossless track (`rightsClearedPlayable`)
 *
 * Only tracks satisfying all mandatory checks receive `ogPlayable: true`.
 */

const { ACCEPTED_OG_CODECS } = require('../config');

/**
 * Provider Discovery Categories required by Void OG specification:
 * - Category 1: Live and verified
 * - Category 2: Technically ready (adapter implemented, awaiting credentials/contract/rights)
 * - Category 3: Investigated but unavailable
 * - Category 4: Rejected (lossy-only, unofficial, or legally/technically unsuitable)
 */
const OG_PROVIDER_CATEGORIES = Object.freeze({
  CATEGORY_1_LIVE_VERIFIED: 'Category 1 — Live and verified',
  CATEGORY_2_TECHNICALLY_READY: 'Category 2 — Technically ready',
  CATEGORY_3_UNAVAILABLE: 'Category 3 — Investigated but unavailable',
  CATEGORY_4_REJECTED: 'Category 4 — Rejected',
});

/**
 * Formats sample rate in kHz cleanly (e.g., 44100 -> "44.1 kHz", 96000 -> "96 kHz").
 */
function formatSampleRateKhz(sampleRateHz) {
  const sr = Number(sampleRateHz);
  if (!Number.isFinite(sr) || sr <= 0) return '';
  const khz = sr / 1000;
  return Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1).replace(/\.0$/, '')} kHz`;
}

/**
 * Formats the exact verified OG quality badge required by the UI:
 * Examples:
 * - "FLAC · 16-bit · 44.1 kHz"
 * - "FLAC · 24-bit · 96 kHz"
 * - "ALAC · 24-bit · 48 kHz"
 */
function formatOgVerifiedSpecLabel(codec, bitDepth, sampleRate) {
  const cleanCodec = String(codec || '').toUpperCase().trim();
  const bd = Number(bitDepth);
  const sr = Number(sampleRate);
  if (!ACCEPTED_OG_CODECS.includes(cleanCodec) || !bd || !sr) {
    return '';
  }
  return `${cleanCodec} · ${bd}-bit · ${formatSampleRateKhz(sr)}`;
}

/**
 * Determines the honest quality classification without fake Hi-Res claims.
 * Never claims "Original Studio Master" unless provenance is explicitly verified.
 */
function classifyOgQualityTier({ codec, bitDepth, sampleRate, provenanceStatus }) {
  const cleanCodec = String(codec || '').toUpperCase();
  const bd = Number(bitDepth) || 0;
  const sr = Number(sampleRate) || 0;

  if (!ACCEPTED_OG_CODECS.includes(cleanCodec) || bd < 16 || sr < 44100) {
    return 'Rejected';
  }

  const isHiRes = bd >= 24 && sr >= 48000;
  if (isHiRes) {
    return provenanceStatus === 'verified_original_master'
      ? 'Verified Hi-Res Lossless'
      : 'Hi-Res Lossless (Technically Verified)';
  }

  return provenanceStatus === 'verified_original_master' ||
    provenanceStatus === 'verified_native_lossless_upload'
    ? 'CD-Quality Lossless (16-bit / 44.1 kHz+)'
    : 'Lossless (Technically Verified)';
}

/**
 * Constructs an immutable, verified OG Track record.
 * Throws or returns null if the track has not passed all 4 verification stages.
 */
function buildVerifiedOgTrack({
  id,
  isrc = null,
  title,
  artist,
  album,
  artworkUrl = '',
  providerId,
  providerName,
  streamUrl,
  downloadUrl = null,
  downloadAllowed = false,
  duration,
  language = null,
  sourcePageUrl = null,
  verificationReport,
}) {
  if (!verificationReport || !verificationReport.eligibleForOg) {
    return null;
  }

  const { stage1, stage2, stage3, stage4 } = verificationReport;
  const codec = stage2.codec;
  const bitDepth = stage2.bitDepth;
  const sampleRate = stage2.sampleRate;
  const channels = stage2.channels || 2;
  const specLabel = formatOgVerifiedSpecLabel(codec, bitDepth, sampleRate);
  if (!specLabel) return null;

  const qualityClassification = classifyOgQualityTier({
    codec,
    bitDepth,
    sampleRate,
    provenanceStatus: stage3.provenanceStatus,
  });

  const cleanTitle = String(title || 'Untitled').trim();
  const cleanArtist = String(artist || 'Unknown Artist').trim();
  const cleanAlbum = String(album || providerName || 'OG Lossless').trim();

  return {
    id: String(id),
    isrc: isrc ? String(isrc).trim().toUpperCase() : null,
    name: cleanTitle,
    title: cleanTitle,
    artist: cleanArtist,
    album: cleanAlbum,
    image: String(artworkUrl || '').trim(),
    artworkUrl: String(artworkUrl || '').trim(),
    source: providerName,
    providerId,
    providerName,
    category: 'OG',
    section: 'OG',

    // Verified technical specs
    codec,
    bitDepth,
    sampleRate,
    channels,
    bitrate: stage2.bitrateKbps || Math.round((sampleRate * bitDepth * channels) / 1000),
    duration: Number(duration || stage2.durationSec || 0),
    mimeType: stage1.mimeType,
    format: `${specLabel} · ${providerName}`,
    ogSpecBadge: specLabel,
    qualityBadge: 'Lossless',
    qualityClassification,
    language: language || null,

    // Three separated classifications required by Stage 3
    classifications: {
      technicallyVerifiedLossless: Boolean(stage1.passed && stage2.passed),
      provenanceVerifiedOriginal: Boolean(stage3.passed),
      provenanceStatus: stage3.provenanceStatus,
      rightsClearedPlayable: Boolean(stage4.passed),
    },

    // Rights & territory metadata
    rights: {
      licenseType: stage4.licenseType,
      licenseUrl: stage4.licenseUrl || null,
      territory: stage4.territory || 'IN',
      commercialStreamingAllowed: Boolean(stage4.commercialStreamingAllowed),
      downloadAllowed: Boolean(downloadAllowed && stage4.downloadAllowed),
      attributionText: stage4.attributionText || null,
      sourcePageUrl: sourcePageUrl || stage4.sourcePageUrl || null,
    },

    // Playback & Download URLs (strictly no lossy fallback URLs)
    streamUrl: String(streamUrl).trim(),
    downloadUrl: String(streamUrl).trim(),
    ogDownloadUrl:
      downloadAllowed && stage4.downloadAllowed
        ? String(downloadUrl || streamUrl).trim()
        : null,
    fallbackUrls: [], // OG strictly prohibits lossy fallbacks

    qualityVerified: true,
    ogVerified: true,
    ogPlayable: true,
    verifiedAt: verificationReport.verifiedAt || new Date().toISOString(),
  };
}

module.exports = {
  OG_PROVIDER_CATEGORIES,
  formatSampleRateKhz,
  formatOgVerifiedSpecLabel,
  classifyOgQualityTier,
  buildVerifiedOgTrack,
};
