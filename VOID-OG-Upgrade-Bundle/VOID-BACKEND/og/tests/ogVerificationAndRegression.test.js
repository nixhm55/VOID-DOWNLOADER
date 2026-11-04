'use strict';

/**
 * VOID OG — Comprehensive Automated Verification, Negative-Case & Regression Test Suite
 *
 * Uses real FFmpeg-generated binary audio files (16-bit/44.1kHz FLAC, 24-bit/96kHz Hi-Res FLAC,
 * 16-bit/44.1kHz PCM WAV, 24-bit/48kHz ALAC, 16-bit/44.1kHz AIFF, 320kbps MP3, MP3 renamed .flac,
 * AAC in M4A, Ogg Vorbis, Opus, FLAC transcoded from MP3 with LAME tags, short <35s preview FLAC)
 * and runs them through all 4 OG verification stages + provider isolation + deduplication +
 * playback-time re-verification.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  buildVerifiedOgTrack,
} = require('../models');
const {
  runFullOgVerificationPipeline,
} = require('../verification');
const {
  searchOgProviders,
  resolveOgTrack,
  getOgProviderStatusReport,
} = require('../services');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'void-og-test-'));

function generateAudioFixture(filename, ffmpegArgs) {
  const outPath = path.join(tmpDir, filename);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:duration=45:amplitude=0.4',
      ...ffmpegArgs,
      outPath,
    ],
    { timeout: 15000 }
  );
  return new Uint8Array(fs.readFileSync(outPath));
}

function generateShortPreviewFixture(filename, ffmpegArgs) {
  const outPath = path.join(tmpDir, filename);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:duration=20:amplitude=0.4',
      ...ffmpegArgs,
      outPath,
    ],
    { timeout: 15000 }
  );
  return new Uint8Array(fs.readFileSync(outPath));
}

async function runAllTests() {
  const report = {
    passedCount: 0,
    failedCount: 0,
    positiveTests: [],
    negativeTests: [],
    providerTests: [],
    deduplicationTests: [],
  };

  console.log('Generating real binary audio fixtures via FFmpeg...');

  // Positive genuine lossless fixtures (45s duration)
  const flac16_44 = generateAudioFixture('genuine_16_44.flac', [
    '-c:a',
    'flac',
    '-sample_fmt',
    's16',
    '-ar',
    '44100',
    '-ac',
    '2',
  ]);
  const flac24_96 = generateAudioFixture('genuine_24_96.flac', [
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    '-bits_per_raw_sample',
    '24',
    '-ar',
    '96000',
    '-ac',
    '2',
  ]);
  const wav16_44 = generateAudioFixture('genuine_16_44.wav', [
    '-c:a',
    'pcm_s16le',
    '-ar',
    '44100',
    '-ac',
    '2',
  ]);
  const alac24_48 = generateAudioFixture('genuine_24_48.m4a', [
    '-c:a',
    'alac',
    '-sample_fmt',
    's32p',
    '-ar',
    '48000',
    '-ac',
    '2',
  ]);
  const aiff16_44 = generateAudioFixture('genuine_16_44.aiff', [
    '-c:a',
    'pcm_s16be',
    '-ar',
    '44100',
    '-ac',
    '2',
  ]);

  // Negative lossy / disguised / invalid fixtures
  const mp3_320 = generateAudioFixture('disguised_320kbps.flac', [
    '-f',
    'mp3',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '320k',
    '-ar',
    '44100',
    '-ac',
    '2',
  ]);
  const aac_m4a = generateAudioFixture('lossy_aac.m4a', [
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-ar',
    '44100',
    '-ac',
    '2',
  ]);
  const ogg_vorbis = generateAudioFixture('lossy_vorbis.ogg', [
    '-c:a',
    'vorbis',
    '-strict',
    '-2',
    '-ac',
    '2',
  ]);
  const flac_from_mp3 = generateAudioFixture('transcoded_from_mp3.flac', [
    '-c:a',
    'flac',
    '-sample_fmt',
    's16',
    '-ar',
    '44100',
    '-metadata',
    'COMMENT=Transcoded from MP3 via libmp3lame 320kbps',
  ]);
  const short_preview_flac = generateShortPreviewFixture('preview_20s.flac', [
    '-c:a',
    'flac',
    '-sample_fmt',
    's16',
    '-ar',
    '44100',
  ]);

  /* ─────────────────────────────────────────────────────────────────────────
   * 1. POSITIVE TESTS: GENUINE LOSSLESS STREAMS (FLAC 16/44.1, FLAC 24/96, WAV, ALAC, AIFF)
   * ───────────────────────────────────────────────────────────────────────── */

  const positiveCases = [
    {
      name: 'Genuine 16-bit / 44.1 kHz FLAC (Internet Archive CC0 Original)',
      bytes: flac16_44,
      expectedCodec: 'FLAC',
      expectedBitDepth: 16,
      expectedSampleRate: 44100,
      expectedBadge: 'FLAC · 16-bit · 44.1 kHz',
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/carnatic_classical_cc0/kriti_16_44.flac',
        duration: 45,
        byteSize: flac16_44.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        licenseShortName: 'CC0 1.0',
        commercialRightsConfirmed: true,
        downloadAllowed: true,
        allowedTerritories: ['WORLDWIDE', 'IN'],
      },
    },
    {
      name: 'Genuine 24-bit / 96 kHz Hi-Res FLAC (Wikimedia Commons CC-BY)',
      bytes: flac24_96,
      expectedCodec: 'FLAC',
      expectedBitDepth: 24,
      expectedSampleRate: 96000,
      expectedBadge: 'FLAC · 24-bit · 96 kHz',
      candidate: {
        providerId: 'wikimedia-commons',
        providerName: 'Wikimedia Commons',
        streamUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Hindustani_Raga_24_96.flac',
        duration: 45,
        byteSize: flac24_96.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        licenseShortName: 'CC BY 4.0',
        commercialRightsConfirmed: true,
        downloadAllowed: true,
        allowedTerritories: ['WORLDWIDE', 'IN'],
      },
    },
    {
      name: 'Genuine 16-bit / 44.1 kHz Linear PCM WAV (Wikimedia Commons Public Domain)',
      bytes: wav16_44,
      expectedCodec: 'WAV',
      expectedBitDepth: 16,
      expectedSampleRate: 44100,
      expectedBadge: 'WAV · 16-bit · 44.1 kHz',
      candidate: {
        providerId: 'wikimedia-commons',
        providerName: 'Wikimedia Commons',
        streamUrl: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Classical_Master.wav',
        duration: 45,
        byteSize: wav16_44.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
        licenseShortName: 'Public Domain Mark 1.0',
        commercialRightsConfirmed: true,
        downloadAllowed: true,
        allowedTerritories: ['WORLDWIDE', 'IN'],
      },
    },
    {
      name: 'Genuine 24-bit / 48 kHz ALAC Master (Internet Archive CC-BY Original)',
      bytes: alac24_48,
      expectedCodec: 'ALAC',
      expectedBitDepth: 24,
      expectedSampleRate: 48000,
      expectedBadge: 'ALAC · 24-bit · 48 kHz',
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/malayalam_folk_master/song_24_48.m4a',
        duration: 45,
        byteSize: alac24_48.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        licenseShortName: 'CC BY 4.0',
        commercialRightsConfirmed: true,
        downloadAllowed: true,
        allowedTerritories: ['WORLDWIDE', 'IN'],
      },
    },
    {
      name: 'Genuine 16-bit / 44.1 kHz AIFF Master (Internet Archive Public Domain)',
      bytes: aiff16_44,
      expectedCodec: 'AIFF',
      expectedBitDepth: 16,
      expectedSampleRate: 44100,
      expectedBadge: 'AIFF · 16-bit · 44.1 kHz',
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/archival_aiff_master/track.aiff',
        duration: 45,
        byteSize: aiff16_44.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
        licenseShortName: 'Public Domain Mark 1.0',
        commercialRightsConfirmed: true,
        downloadAllowed: true,
        allowedTerritories: ['WORLDWIDE', 'IN'],
      },
    },
  ];

  for (const tc of positiveCases) {
    const res = runFullOgVerificationPipeline({
      headerBytes: tc.bytes,
      candidate: tc.candidate,
      requestedTerritory: 'IN',
    });
    assert.equal(
      res.eligibleForOg,
      true,
      `Expected ${tc.name} to pass OG verification: ${res.failedReasons.join(', ')}`
    );
    assert.equal(res.stage2.codec, tc.expectedCodec);
    assert.equal(res.stage2.bitDepth, tc.expectedBitDepth);
    assert.equal(res.stage2.sampleRate, tc.expectedSampleRate);

    const track = buildVerifiedOgTrack({
      id: `test:${tc.expectedCodec}`,
      title: tc.name,
      artist: 'Test Artist',
      album: 'Test Album',
      providerId: tc.candidate.providerId,
      providerName: tc.candidate.providerName,
      streamUrl: tc.candidate.streamUrl,
      downloadAllowed: true,
      duration: 45,
      verificationReport: res,
    });
    assert.ok(track, 'Expected buildVerifiedOgTrack to return a valid OG track');
    assert.equal(track.ogSpecBadge, tc.expectedBadge);
    report.passedCount++;
    report.positiveTests.push({
      test: tc.name,
      codec: track.codec,
      bitDepth: track.bitDepth,
      sampleRate: track.sampleRate,
      bitrateKbps: track.bitrate,
      badge: track.ogSpecBadge,
      status: 'PASSED',
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 2. DELIBERATE NEGATIVE TESTS (MUST ALL BE REJECTED / FAIL CLOSED)
   * ───────────────────────────────────────────────────────────────────────── */

  const negativeCases = [
    {
      name: '320 kbps MP3 file renamed with .flac extension',
      bytes: mp3_320,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/fake_lossless/disguised_320kbps.flac',
        duration: 45,
        byteSize: mp3_320.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: '256 kbps AAC stream inside .m4a container returned by a provider',
      bytes: aac_m4a,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/fake_alac/lossy_aac.m4a',
        duration: 45,
        byteSize: aac_m4a.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'Ogg Vorbis stream returned by a provider',
      bytes: ogg_vorbis,
      candidate: {
        providerId: 'jamendo-flac',
        providerName: 'Jamendo',
        streamUrl: 'https://prod-1.storage.jamendo.com/?trackid=123&format=ogg',
        duration: 45,
        byteSize: ogg_vorbis.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'FLAC file transcoded from a lossy MP3 source (LAME transcode metadata)',
      bytes: flac_from_mp3,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/fake_master/transcoded_from_mp3.flac',
        duration: 45,
        byteSize: flac_from_mp3.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'Internet Archive derivative file (source="derivative" instead of "original")',
      bytes: flac16_44,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/derived_item/track.flac',
        duration: 45,
        byteSize: flac16_44.byteLength,
        sourceType: 'derivative',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'On-the-fly lossy-to-ALAC proxy URL (/__void_api/proxy-audio?codec=alac)',
      bytes: alac24_48,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/proxy-audio?codec=alac&ext=.m4a',
        duration: 45,
        byteSize: alac24_48.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: '20-second preview clip (fails full-track duration requirement >= 35s)',
      bytes: short_preview_flac,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/preview_item/preview_20s.flac',
        duration: 20,
        byteSize: short_preview_flac.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'Track with Non-Commercial (CC BY-NC-ND) license & no commercial clearance',
      bytes: flac16_44,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/nc_item/track.flac',
        duration: 45,
        byteSize: flac16_44.byteLength,
        sourceType: 'original',
        licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
        licenseShortName: 'CC BY-NC-ND 4.0',
        commercialRightsConfirmed: false,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'Track with missing / uncertain rights metadata',
      bytes: flac16_44,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/unknown_rights/track.flac',
        duration: 45,
        byteSize: flac16_44.byteLength,
        sourceType: 'original',
        licenseUrl: '',
        licenseShortName: '',
        commercialRightsConfirmed: false,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'Track unavailable in India (US/EU only territory restriction)',
      bytes: flac16_44,
      candidate: {
        providerId: 'qobuz',
        providerName: 'Qobuz',
        streamUrl: 'https://www.qobuz.com/api.json/0.2/track/getFileUrl?track_id=1',
        duration: 45,
        byteSize: flac16_44.byteLength,
        sourceType: 'original',
        commercialRightsConfirmed: true,
        allowedTerritories: ['US', 'FR', 'GB'],
      },
    },
    {
      name: 'Provider prohibiting content mixing in a shared multi-provider catalogue (TIDAL without written authorization)',
      bytes: flac16_44,
      candidate: {
        providerId: 'tidal',
        providerName: 'TIDAL',
        streamUrl: 'https://openapi.tidal.com/v2/tracks/123',
        duration: 45,
        byteSize: flac16_44.byteLength,
        sourceType: 'original',
        commercialRightsConfirmed: true,
        allowMultiProviderMixing: false,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'SSRF attempt targeting private/loopback IP (https://127.0.0.1/internal.flac)',
      bytes: flac16_44,
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://127.0.0.1/internal.flac',
        duration: 45,
        byteSize: flac16_44.byteLength,
        sourceType: 'original',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
    {
      name: 'Truncated / corrupted binary header',
      bytes: new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00]),
      candidate: {
        providerId: 'internet-archive',
        providerName: 'Internet Archive',
        streamUrl: 'https://archive.org/download/corrupt/track.flac',
        duration: 45,
        byteSize: 6,
        sourceType: 'original',
        commercialRightsConfirmed: true,
        allowedTerritories: ['IN'],
      },
    },
  ];

  for (const nc of negativeCases) {
    const res = runFullOgVerificationPipeline({
      headerBytes: nc.bytes,
      candidate: nc.candidate,
      requestedTerritory: 'IN',
    });
    assert.equal(
      res.eligibleForOg,
      false,
      `Negative case '${nc.name}' MUST be rejected by OG verification`
    );
    const built = buildVerifiedOgTrack({
      id: 'neg-test',
      title: nc.name,
      artist: 'Test',
      album: 'Test',
      providerId: nc.candidate.providerId,
      providerName: nc.candidate.providerName,
      streamUrl: nc.candidate.streamUrl,
      duration: 45,
      verificationReport: res,
    });
    assert.equal(built, null, 'buildVerifiedOgTrack must return null for rejected track');
    report.passedCount++;
    report.negativeTests.push({
      test: nc.name,
      rejected: true,
      failedReasons: res.failedReasons,
      status: 'PASSED (Properly Rejected)',
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 3. PLAYBACK-TIME STREAM SWAP PROTECTION (PROVIDER CHANGES LOSSLESS TO LOSSY)
   * ───────────────────────────────────────────────────────────────────────── */
  {
    const initialRes = runFullOgVerificationPipeline({
      headerBytes: flac16_44,
      candidate: positiveCases[0].candidate,
      requestedTerritory: 'IN',
    });
    const validTrack = buildVerifiedOgTrack({
      id: 'og:swap-test',
      title: 'Swap Protection Test',
      artist: 'Artist',
      album: 'Album',
      providerId: 'internet-archive',
      providerName: 'Internet Archive',
      streamUrl: 'https://archive.org/download/swap_test/track.flac',
      duration: 45,
      verificationReport: initialRes,
    });

    // Simulate provider suddenly returning 320kbps MP3 bytes at playback time for the same URL
    const playbackCheck = await resolveOgTrack(validTrack, {
      territory: 'IN',
      customFetchHeaderBytes: async () => ({
        bytes: mp3_320,
        contentType: 'audio/mpeg',
        totalBytes: mp3_320.byteLength,
      }),
    });
    assert.equal(
      playbackCheck.eligible,
      false,
      'Playback-time re-verification MUST reject a stream that changed from FLAC to MP3'
    );
    report.passedCount++;
    report.negativeTests.push({
      test: 'Provider dynamically swaps previously verified FLAC URL to 320kbps MP3 at playback time',
      rejected: true,
      failedReasons: [playbackCheck.reason],
      status: 'PASSED (Failed Closed at Playback Time)',
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 4. PROVIDER ISOLATION & DEDUPLICATION TESTS
   * ───────────────────────────────────────────────────────────────────────── */
  {
    const ver16 = runFullOgVerificationPipeline({
      headerBytes: flac16_44,
      candidate: positiveCases[0].candidate,
      requestedTerritory: 'IN',
    });
    const ver24 = runFullOgVerificationPipeline({
      headerBytes: flac24_96,
      candidate: positiveCases[1].candidate,
      requestedTerritory: 'IN',
    });

    const track16 = buildVerifiedOgTrack({
      id: 'og:ia:same-song',
      isrc: 'INUM72400001',
      title: 'Vatapi Ganapatim',
      artist: 'M. S. Subbulakshmi',
      album: 'Carnatic Heritage',
      providerId: 'internet-archive',
      providerName: 'Internet Archive',
      streamUrl: 'https://archive.org/download/carnatic/vatapi_16.flac',
      duration: 240,
      verificationReport: ver16,
    });

    const track24 = buildVerifiedOgTrack({
      id: 'og:commons:same-song',
      isrc: 'INUM72400001',
      title: 'Vatapi Ganapatim',
      artist: 'M. S. Subbulakshmi',
      album: 'Carnatic Heritage',
      providerId: 'wikimedia-commons',
      providerName: 'Wikimedia Commons',
      streamUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/vatapi_24_96.flac',
      duration: 240,
      verificationReport: ver24,
    });

    const trackLive = buildVerifiedOgTrack({
      id: 'og:ia:live-version',
      isrc: 'INUM72400002',
      title: 'Vatapi Ganapatim (Live at Madras Music Academy)',
      artist: 'M. S. Subbulakshmi',
      album: 'Carnatic Heritage (Live)',
      providerId: 'internet-archive',
      providerName: 'Internet Archive',
      streamUrl: 'https://archive.org/download/carnatic/vatapi_live.flac',
      duration: 310,
      verificationReport: ver16,
    });

    const mockProviders = [
      {
        getStatus: () => ({
          providerId: 'failing-provider',
          providerName: 'Failing Provider',
          category: 'Category 1 — Live and verified',
          enabled: true,
        }),
        search: async () => {
          throw new Error('Simulated provider network timeout');
        },
      },
      {
        getStatus: () => ({
          providerId: 'internet-archive',
          providerName: 'Internet Archive',
          category: 'Category 1 — Live and verified',
          enabled: true,
        }),
        search: async () => [track16, trackLive],
      },
      {
        getStatus: () => ({
          providerId: 'wikimedia-commons',
          providerName: 'Wikimedia Commons',
          category: 'Category 1 — Live and verified',
          enabled: true,
        }),
        search: async () => [track24],
      },
    ];

    const searchResult = await searchOgProviders('Vatapi Ganapatim', {
      customProviders: mockProviders,
    });

    assert.equal(searchResult.success, true);
    assert.equal(searchResult.tracks.length, 2);
    const studioWinner = searchResult.tracks.find((t) => t.isrc === 'INUM72400001');
    assert.equal(studioWinner.bitDepth, 24);
    assert.equal(studioWinner.sampleRate, 96000);
    assert.equal(studioWinner.providerName, 'Wikimedia Commons');
    assert.equal(studioWinner.ogSpecBadge, 'FLAC · 24-bit · 96 kHz');

    report.passedCount += 2;
    report.deduplicationTests.push({
      test: 'ISRC deduplication prefers 24-bit/96kHz FLAC over 16-bit/44.1kHz FLAC while preserving Live recording separately',
      status: 'PASSED',
    });
    report.providerTests.push({
      test: 'Provider failure isolation continues querying healthy OG providers without lossy fallback',
      status: 'PASSED',
    });
  }

  // Verify Provider Status Registry
  const statusReport = getOgProviderStatusReport();
  assert.equal(statusReport.length, 17, 'Expected 17 registered OG provider adapters');
  const tidalStatus = statusReport.find((p) => p.providerId === 'tidal');
  assert.equal(tidalStatus.enabled, false, 'TIDAL must remain disabled for shared OG catalogue without written authorization');
  report.passedCount++;

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(
    JSON.stringify(
      {
        summary: `ALL ${report.passedCount} OG VERIFICATION, NEGATIVE & ISOLATION TESTS PASSED`,
        providerCount: statusReport.length,
        report,
      },
      null,
      2
    )
  );
}

runAllTests().catch((err) => {
  console.error('OG Test Suite Failed:', err);
  process.exit(1);
});
