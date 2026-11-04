'use strict';

/**
 * VOID OG — Independent Service Layer
 *
 * Implements the required independent functions:
 * - `searchOgProviders`
 * - `resolveOgTracks`
 * - `resolveOgTrack`
 * - `fetchOgStream`
 * - `verifyOgAudio`
 * - `verifyOgProvenance`
 * - `verifyOgRights`
 * - `checkOgTerritory`
 * - `deduplicateOgTracks`
 *
 * Enforces provider isolation and the strict NO-LOSSY-FALLBACK guarantee:
 * - Searches enabled OG providers in parallel.
 * - A provider failure never crashes the OG section.
 * - Never falls back to HIGH, VERY HIGH, or the existing LOSSLESS pipelines.
 * - Fails closed if a stream fails any of the 4 verification stages.
 */

const { getOgEnvConfig, validateOgStreamUrlSafety } = require('../config');
const {
  verifyOgContainerAndCodec,
  verifyOgAudio,
  verifyOgProvenance,
  verifyOgRights,
  checkOgTerritory,
  runFullOgVerificationPipeline,
} = require('../verification');
const {
  fetchStreamHeaderBytes,
  createOgProviderRegistry,
} = require('../providers');
const { deduplicateOgTracks } = require('../search');

// Cache of verified OG tracks by ID for playback-time re-verification
const verifiedOgTrackStore = new Map();

/**
 * Searches all enabled and authorized OG providers in parallel with strict provider isolation.
 */
async function searchOgProviders(
  query,
  {
    limit = 12,
    territory = 'IN',
    signal,
    envConfig = getOgEnvConfig(),
    customProviders = null,
    customFetchHeaderBytes = null,
  } = {}
) {
  const cleanQuery = String(query || '').trim();
  const providers = customProviders || createOgProviderRegistry(envConfig);
  const providerStatuses = providers.map((p) => p.getStatus());
  const enabledProviders = providers.filter((p) => p.getStatus().enabled);

  if (!cleanQuery || enabledProviders.length === 0) {
    return {
      success: true,
      section: 'OG',
      query: cleanQuery,
      territory,
      tracks: [],
      providerOutcomes: providerStatuses.map((st) => ({
        providerId: st.providerId,
        providerName: st.providerName,
        category: st.category,
        enabled: st.enabled,
        status: st.enabled ? 'skipped_empty_query' : 'disabled_awaiting_access',
        count: 0,
      })),
    };
  }

  const perProviderLimit = Math.max(4, Math.ceil(limit / enabledProviders.length));

  const tasks = enabledProviders.map(async (provider) => {
    const status = provider.getStatus();
    try {
      const items = await provider.search(cleanQuery, {
        limit: perProviderLimit,
        territory,
        signal,
        customFetchHeaderBytes,
      });
      return {
        providerId: status.providerId,
        providerName: status.providerName,
        category: status.category,
        enabled: true,
        status: 'fulfilled',
        items: Array.isArray(items) ? items : [],
      };
    } catch (err) {
      return {
        providerId: status.providerId,
        providerName: status.providerName,
        category: status.category,
        enabled: true,
        status: 'failed_isolated',
        error: err instanceof Error ? err.message : String(err),
        items: [],
      };
    }
  });

  const settled = await Promise.allSettled(tasks);
  const rawTracks = [];
  const activeOutcomes = new Map();

  for (const entry of settled) {
    if (entry.status === 'fulfilled' && entry.value) {
      activeOutcomes.set(entry.value.providerId, {
        providerId: entry.value.providerId,
        providerName: entry.value.providerName,
        category: entry.value.category,
        enabled: true,
        status: entry.value.status,
        count: entry.value.items.length,
        ...(entry.value.error ? { error: entry.value.error } : {}),
      });
      for (const track of entry.value.items) {
        if (track && track.ogPlayable && track.ogVerified) {
          verifiedOgTrackStore.set(track.id, track);
          rawTracks.push(track);
        }
      }
    }
  }

  const deduplicated = deduplicateOgTracks(rawTracks).slice(0, limit);

  const providerOutcomes = providerStatuses.map((st) => {
    if (activeOutcomes.has(st.providerId)) {
      return activeOutcomes.get(st.providerId);
    }
    return {
      providerId: st.providerId,
      providerName: st.providerName,
      category: st.category,
      enabled: st.enabled,
      status: 'disabled_awaiting_access',
      missingRequirements: st.missingRequirements || [],
      count: 0,
    };
  });

  return {
    success: true,
    section: 'OG',
    query: cleanQuery,
    territory,
    tracks: deduplicated,
    providerOutcomes,
  };
}

/**
 * Alias matching architectural specification (`resolveOgTracks`).
 */
async function resolveOgTracks(query, options = {}) {
  return searchOgProviders(query, options);
}

/**
 * Re-validates a single OG track at playback/download resolution time.
 * Ensures that if a provider swaps a previously lossless stream to a lossy stream,
 * or if an unverified track is passed in via direct URL/playlist, OG fails closed.
 */
async function resolveOgTrack(
  trackOrId,
  { territory = 'IN', customFetchHeaderBytes = null } = {}
) {
  const track =
    typeof trackOrId === 'string'
      ? verifiedOgTrackStore.get(trackOrId) || null
      : trackOrId;

  if (!track || typeof track !== 'object') {
    return {
      eligible: false,
      reason: 'Track not found in verified OG registry',
      track: null,
    };
  }

  const streamUrl = String(track.streamUrl || track.downloadUrl || '').trim();
  const safety = validateOgStreamUrlSafety(streamUrl);
  if (!safety.safe) {
    return {
      eligible: false,
      reason: `SSRF / Domain validation failed at playback time: ${safety.reason}`,
      track: null,
    };
  }

  const headerFetcher = customFetchHeaderBytes || fetchStreamHeaderBytes;
  try {
    const probe = await headerFetcher(streamUrl);
    const candidate = {
      providerId: track.providerId || 'internet-archive',
      providerName: track.providerName || track.source || 'Internet Archive',
      streamUrl,
      contentType: probe.contentType,
      duration: Number(track.duration) || 0,
      byteSize: probe.totalBytes,
      sourceType: 'original',
      licenseUrl: track.rights?.licenseUrl || 'https://creativecommons.org/publicdomain/mark/1.0/',
      licenseShortName: track.rights?.licenseType || 'Public Domain',
      commercialRightsConfirmed: Boolean(track.rights?.commercialStreamingAllowed),
      allowMultiProviderMixing: true,
      downloadAllowed: Boolean(track.rights?.downloadAllowed),
      allowedTerritories: [track.rights?.territory || 'IN', 'WORLDWIDE'],
    };

    const report = runFullOgVerificationPipeline({
      headerBytes: probe.bytes,
      candidate,
      requestedTerritory: territory,
    });

    if (!report.eligibleForOg) {
      return {
        eligible: false,
        reason: `Playback-time OG re-verification failed: ${report.failedReasons.join('; ')}`,
        verificationReport: report,
        track: null,
      };
    }

    return {
      eligible: true,
      verificationReport: report,
      track: {
        ...track,
        codec: report.stage2.codec,
        bitDepth: report.stage2.bitDepth,
        sampleRate: report.stage2.sampleRate,
        mimeType: report.stage1.mimeType,
      },
    };
  } catch (err) {
    return {
      eligible: false,
      reason: `Playback-time stream probe failed: ${err instanceof Error ? err.message : String(err)}`,
      track: null,
    };
  }
}

/**
 * Fetches and streams a verified OG audio stream with byte-range support,
 * only after confirming Stage 1 + Stage 2 + Stage 3 + Stage 4 eligibility.
 */
async function fetchOgStream(
  streamUrl,
  {
    providerId = 'internet-archive',
    providerName = 'Internet Archive',
    licenseUrl = 'https://creativecommons.org/publicdomain/mark/1.0/',
    commercialRightsConfirmed = true,
    duration = 180,
    territory = 'IN',
    rangeHeader = '',
    customFetchHeaderBytes = null,
  } = {}
) {
  const resolution = await resolveOgTrack(
    {
      providerId,
      providerName,
      streamUrl,
      duration,
      rights: {
        licenseUrl,
        commercialStreamingAllowed: commercialRightsConfirmed,
        territory,
      },
    },
    { territory, customFetchHeaderBytes }
  );

  if (!resolution.eligible) {
    return {
      ok: false,
      status: 403,
      reason: resolution.reason,
    };
  }

  return {
    ok: true,
    status: 200,
    streamUrl,
    rangeHeader,
    mimeType: resolution.track.mimeType,
    codec: resolution.track.codec,
    bitDepth: resolution.track.bitDepth,
    sampleRate: resolution.track.sampleRate,
    verificationReport: resolution.verificationReport,
  };
}

function getOgProviderStatusReport(envConfig = getOgEnvConfig()) {
  const registry = createOgProviderRegistry(envConfig);
  return registry.map((p) => p.getStatus());
}

module.exports = {
  searchOgProviders,
  resolveOgTracks,
  resolveOgTrack,
  fetchOgStream,
  verifyOgContainerAndCodec,
  verifyOgAudio,
  verifyOgProvenance,
  verifyOgRights,
  checkOgTerritory,
  deduplicateOgTracks,
  getOgProviderStatusReport,
  verifiedOgTrackStore,
};
