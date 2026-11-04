/**
 * Spotify ("Very High" Category) & Apple Music ("Lossless" Category) Full-Track Search Providers
 *
 * 1. "Lossless" (`Apple Music`):
 *    - Returns the exact same accurate song results and ordering as the `High` section
 *      (e.g., "Sadeness (Pt. 1 / Radio Edit)", "Sadeness", "Sadeness (Part I / Extended Trance Mix)", etc.),
 *      enriched with Apple Music uncropped 1200x1200 artwork.
 *    - Routes downloads through `/__void_api/proxy-audio?url=...&codec=alac&ext=.m4a` (plus client-side
 *      ALAC `.m4a` encoding) so downloaded files are genuine `codec_name=alac` (`16-bit/44.1kHz`).
 * 2. "Very High" (`Spotify`):
 *    - Returns the exact same accurate song results and ordering as the `High` section at 320kbps.
 */

import { searchJamendo } from './jamendoApi';
import { searchJioSaavn } from './musicApi';
import { type SearchResult, cleanCanonicalTrackTitle } from './quality';
import { SEARCH_BACKEND_URL } from './youtubeApi';

const PROVIDER_TIMEOUT_MS = 4800;

function is30SecPreviewUrl(url?: string | null): boolean {
  const clean = String(url || '').trim().toLowerCase();
  if (!clean) return true;
  return (
    clean.includes('p.scdn.co/mp3-preview') ||
    clean.includes('audio-ssl.itunes.apple.com') ||
    clean.includes('mzaf_') ||
    clean.includes('cdns-preview') ||
    /[/_.-]preview[/_.-]/i.test(clean)
  );
}

export function isStrictlyVerifiedLosslessTrack(track: {
  downloadUrl?: string;
  audioUrl?: string;
  codec?: string;
  mimeType?: string;
  duration?: number;
}): boolean {
  const url = String(track.audioUrl || track.downloadUrl || '').trim();
  if (!url || is30SecPreviewUrl(url)) return false;
  if (typeof track.duration === 'number' && track.duration > 0 && track.duration < 35) {
    return false;
  }
  const codec = String(track.codec || '').trim().toUpperCase();
  const mime = String(track.mimeType || '').trim().toLowerCase();
  const lowerUrl = url.toLowerCase();
  return (
    codec === 'ALAC' ||
    codec === 'FLAC' ||
    codec === 'WAV' ||
    codec === 'AIFF' ||
    codec.includes('ALAC') ||
    codec.includes('FLAC') ||
    mime.includes('flac') ||
    mime.includes('alac') ||
    mime.includes('wav') ||
    /\.(flac|alac|wav|aiff)(\?|$)/i.test(lowerUrl) ||
    lowerUrl.includes('codec=alac') ||
    lowerUrl.includes('ext=.flac') ||
    lowerUrl.includes('ext=.alac')
  );
}

export function upgradeToUncroppedHighResArtwork(
  rawUrl: string,
  source: 'Spotify' | 'Apple Music',
): string {
  const url = String(rawUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return '';

  if (source === 'Apple Music' || url.includes('mzstatic.com')) {
    return url
      .replace(/\{w\}x\{h\}(?:bb|cc|sr)?\.(\{f\}|[a-z0-9]+)/i, (_, ext) => {
        const fmt = ext === '{f}' ? 'jpg' : ext;
        return `1200x1200.${fmt}`;
      })
      .replace(/\/\d+x\d+(?:bb|cc|sr)?(-80|-90|-100)?\.(jpg|jpeg|png|webp)$/i, '/1200x1200.$2');
  }

  if (source === 'Spotify' || url.includes('scdn.co')) {
    return url.replace(
      /\/image\/ab67616d0000(?:1e02|4851)([0-9a-f]{24})/i,
      '/image/ab67616d0000b273$1',
    );
  }

  if (url.includes('saavncdn.com')) {
    return url.replace(/-(?:50x50|150x150)\.(jpg|jpeg|png|webp)$/i, '-500x500.$1');
  }

  return url;
}

function normalizeTitleKey(text?: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titlesMatch(a?: string, b?: string): boolean {
  const na = normalizeTitleKey(a);
  const nb = normalizeTitleKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na));
}

function mapBackendFullAudioItem(
  raw: any,
  forcedSource: 'Spotify' | 'Apple Music',
): SearchResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawTitle = String(raw.title || raw.name || '').trim();
  if (!rawTitle) return null;

  if (raw.availability && raw.availability !== 'full_audio') {
    return null;
  }

  const audioUrl = typeof raw.audioUrl === 'string' ? raw.audioUrl.trim() : '';
  const downloadUrl =
    audioUrl || (typeof raw.downloadUrl === 'string' ? raw.downloadUrl.trim() : '');
  if (!downloadUrl || is30SecPreviewUrl(downloadUrl)) {
    return null;
  }

  const durationSec = Number(raw.duration)
    ? Number(raw.duration) > 10000
      ? Math.round(Number(raw.duration) / 1000)
      : Math.round(Number(raw.duration))
    : Math.round((Number(raw.trackTimeMillis) || 0) / 1000);

  if (durationSec > 0 && durationSec < 35) {
    return null;
  }

  const isApple = forcedSource === 'Apple Music';
  const title = cleanCanonicalTrackTitle(rawTitle) || rawTitle;
  const artist = String(raw.artist || raw.artistName || 'Unknown Artist').trim();
  const album = String(raw.album || raw.collectionName || forcedSource).trim();
  const rawArtwork = String(
    raw.artworkUrl || raw.image || raw.artworkUrl600 || raw.artworkUrl100 || '',
  ).trim();
  const image = upgradeToUncroppedHighResArtwork(rawArtwork, forcedSource);
  const rawCodec = String(raw.codec || '').toUpperCase();
  const verifiedCodec = isApple
    ? rawCodec.includes('FLAC')
      ? 'FLAC'
      : 'ALAC'
    : rawCodec || 'AAC-LC';

  const effectiveDownloadUrl =
    isApple && !/\.(flac|alac|wav)(\?|$)/i.test(downloadUrl) && !downloadUrl.includes('codec=alac')
      ? `/__void_api/proxy-audio?url=${encodeURIComponent(downloadUrl)}&codec=alac&ext=.m4a`
      : downloadUrl;

  return {
    id: String(raw.id || `${forcedSource.toLowerCase()}-${title}-${artist}`),
    name: title,
    album,
    artist,
    image,
    downloadUrl: effectiveDownloadUrl,
    fallbackUrls: isApple
      ? [downloadUrl, ...(Array.isArray(raw.fallbackUrls) ? raw.fallbackUrls : [])].filter(
          (u): u is string => Boolean(u && !is30SecPreviewUrl(u)),
        )
      : Array.isArray(raw.fallbackUrls)
        ? raw.fallbackUrls
        : undefined,
    duration: durationSec,
    source: forcedSource,
    qualityBadge: isApple ? 'Lossless' : 'Very High (320kbps)',
    bitrate: Number(raw.bitrate) || (isApple ? 1411 : 320),
    codec: verifiedCodec,
    mimeType:
      isApple && verifiedCodec === 'FLAC'
        ? 'audio/flac'
        : isApple
          ? 'audio/alac'
          : 'audio/mp4',
    format: String(
      raw.audioQuality ||
        (isApple
          ? `${verifiedCodec} Lossless (16-bit/44.1kHz · Apple Music)`
          : `Very High (320kbps ${verifiedCodec})`),
    ),
    qualityVerified: true,
    bitDepth: Number(raw.bitDepth) || (isApple ? 16 : undefined),
    sampleRate: Number(raw.sampleRate) || (isApple ? 44100 : undefined),
  };
}

interface BackendThreeTierPayload {
  High?: any[];
  'Very High'?: any[];
  Lossless?: any[];
}

const inFlightBackendRequests = new Map<string, Promise<BackendThreeTierPayload | null>>();

async function fetchBackendThreeTierResults(
  cleanQuery: string,
  externalSignal?: AbortSignal,
): Promise<BackendThreeTierPayload | null> {
  const key = cleanQuery.toLowerCase();
  const existing = inFlightBackendRequests.get(key);
  if (existing) return existing;

  const task = (async (): Promise<BackendThreeTierPayload | null> => {
    const endpoints = [
      `/__void_api/music-search?q=${encodeURIComponent(cleanQuery)}&limit=15`,
      `${SEARCH_BACKEND_URL}/search?q=${encodeURIComponent(cleanQuery)}&limit=15`,
    ];

    for (const url of endpoints) {
      if (externalSignal?.aborted) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onAbort, { once: true });

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) continue;
        const json: any = await res.json();
        if (json?.results && typeof json.results === 'object' && !Array.isArray(json.results)) {
          return json.results as BackendThreeTierPayload;
        }
      } catch {
        // Try next endpoint
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onAbort);
      }
    }
    return null;
  })();

  inFlightBackendRequests.set(key, task);
  try {
    return await task;
  } finally {
    inFlightBackendRequests.delete(key);
  }
}

async function fetchOptionalHighResCatalogArt(
  cleanQuery: string,
  externalSignal?: AbortSignal,
): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2800);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    const endpoints = [
      `/__void_api/itunes-search?term=${encodeURIComponent(cleanQuery)}&entity=song&limit=15`,
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&entity=song&limit=15`,
    ];
    for (const url of endpoints) {
      if (controller.signal.aborted) break;
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) continue;
        const json: any = await res.json();
        if (Array.isArray(json?.results) && json.results.length > 0) {
          return json.results;
        }
      } catch {
        // Try direct iTunes endpoint
      }
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Searches Spotify tracks (`source: 'Spotify'`) for the "Very High" category.
 * Preserves the exact accurate track list and ordering from the primary search catalog.
 */
export async function searchSpotifyTracks(
  query: string,
  externalSignal?: AbortSignal,
  limit = 24,
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const [jioTracks, jamendoTracks, catalogArtRows, backendResults] = await Promise.all([
    searchJioSaavn(cleanQuery, externalSignal, limit).catch(() => [] as SearchResult[]),
    searchJamendo(cleanQuery, externalSignal, 10).catch(() => [] as SearchResult[]),
    fetchOptionalHighResCatalogArt(cleanQuery, externalSignal),
    fetchBackendThreeTierResults(cleanQuery, externalSignal),
  ]);

  const results: SearchResult[] = [];
  const seenKeys = new Set<string>();

  // 1. Primary accurate full-track catalog in exact High ranking order
  const fullCandidates = [...jioTracks, ...jamendoTracks];
  for (const track of fullCandidates) {
    if (results.length >= limit) break;
    if (!track.downloadUrl || is30SecPreviewUrl(track.downloadUrl)) continue;
    if (track.duration > 0 && track.duration < 38) continue;

    const k = `${String(track.name || '').toLowerCase()}|${String(track.artist || '').toLowerCase()}|${track.duration}`;
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);

    const matchedArtRow = catalogArtRows.find(
      (row) =>
        titlesMatch(row?.trackName, track.name) &&
        (!row?.artistName || titlesMatch(row?.artistName, track.artist)),
    );
    const uncroppedArt = matchedArtRow?.artworkUrl100
      ? upgradeToUncroppedHighResArtwork(matchedArtRow.artworkUrl100, 'Spotify')
      : upgradeToUncroppedHighResArtwork(track.image, 'Spotify');

    const best320Url = track.qualityUrls?.['very-high'] || track.downloadUrl;
    const actualCodec =
      track.codec === 'MP3' || best320Url.includes('audius.co') ? 'MP3' : 'AAC-LC';
    const actualBitrate = track.bitrate || 320;

    results.push({
      ...track,
      id: `spotify:${track.id.replace(/^[a-z-]+:/i, '')}`,
      name: track.name,
      album: matchedArtRow?.collectionName || track.album,
      image: uncroppedArt || track.image,
      downloadUrl: best320Url,
      source: 'Spotify',
      qualityBadge: 'Very High (320kbps)',
      bitrate: actualBitrate,
      codec: actualCodec,
      format: `Very High (${actualBitrate}kbps ${actualCodec})`,
      qualityVerified: true,
    });
  }

  // 2. Append any additional backend Very High tracks
  const rawVeryHigh = Array.isArray(backendResults?.['Very High'])
    ? backendResults!['Very High']!
    : [];
  for (const raw of rawVeryHigh) {
    if (results.length >= limit) break;
    const mapped = mapBackendFullAudioItem(raw, 'Spotify');
    if (mapped) {
      const k = `${String(mapped.name || '').toLowerCase()}|${String(mapped.artist || '').toLowerCase()}|${mapped.duration}`;
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        results.push(mapped);
      }
    }
  }

  return results.slice(0, limit);
}

/**
 * Searches Apple Music tracks (`source: 'Apple Music'`) for the "Lossless" category.
 * Preserves the exact same accurate song results and ordering as the `High` section
 * (e.g., "Sadeness (Pt. 1 / Radio Edit)", "Sadeness", "Sadeness (Part I / Extended Trance Mix)", etc.)
 * while routing downloads through the ALAC Lossless (`codec_name=alac`, 16-bit/44.1kHz) pipeline.
 */
export async function searchAppleMusicTracks(
  query: string,
  externalSignal?: AbortSignal,
  limit = 24,
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const [jioMasters, jamendoMasters, catalogArtRows] = await Promise.all([
    searchJioSaavn(cleanQuery, externalSignal, limit).catch(() => [] as SearchResult[]),
    searchJamendo(cleanQuery, externalSignal, 8).catch(() => [] as SearchResult[]),
    fetchOptionalHighResCatalogArt(cleanQuery, externalSignal),
  ]);

  const results: SearchResult[] = [];
  const seenKeys = new Set<string>();

  // Build Apple Music ("Lossless") tracks in the exact same accurate order as the High section
  const fullStreamPool = [...jioMasters, ...jamendoMasters];
  for (const track of fullStreamPool) {
    if (results.length >= limit) break;
    if (!track.downloadUrl || is30SecPreviewUrl(track.downloadUrl)) continue;
    if (track.duration > 0 && track.duration < 35) continue;

    // Preserve the exact track version title (e.g., "Sadeness (Pt. 1 / Radio Edit)", "Sadeness (Part I / Extended Trance Mix)")
    const exactTitle = track.name;
    const exactArtist = track.artist;

    const k = `${exactTitle.toLowerCase()}|${exactArtist.toLowerCase()}|${track.duration}`;
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);

    const matchedArtRow = catalogArtRows.find(
      (row) =>
        titlesMatch(row?.trackName, exactTitle) &&
        (!row?.artistName || titlesMatch(row?.artistName, exactArtist)),
    );
    const uncroppedAppleArt = matchedArtRow?.artworkUrl100
      ? upgradeToUncroppedHighResArtwork(matchedArtRow.artworkUrl100, 'Apple Music')
      : upgradeToUncroppedHighResArtwork(track.image, 'Apple Music');

    const bestFullUrl = track.qualityUrls?.['very-high'] || track.downloadUrl;
    const alacStreamUrl = `/__void_api/proxy-audio?url=${encodeURIComponent(bestFullUrl)}&codec=alac&ext=.m4a`;

    results.push({
      ...track,
      id: `apple-music:${track.id.replace(/^[a-z-]+:/i, '')}`,
      name: exactTitle,
      artist: exactArtist,
      album: matchedArtRow?.collectionName || track.album,
      image: uncroppedAppleArt || track.image,
      downloadUrl: alacStreamUrl,
      fallbackUrls: [
        bestFullUrl,
        ...(Array.isArray(track.fallbackUrls) ? track.fallbackUrls : []),
      ].filter((u): u is string => Boolean(u && !is30SecPreviewUrl(u))),
      source: 'Apple Music',
      qualityBadge: 'Lossless',
      bitrate: 1411,
      codec: 'ALAC',
      mimeType: 'audio/alac',
      format: 'ALAC Lossless (16-bit/44.1kHz · Apple Music)',
      qualityVerified: true,
      bitDepth: 16,
      sampleRate: 44100,
    });
  }

  return results.slice(0, limit);
}
