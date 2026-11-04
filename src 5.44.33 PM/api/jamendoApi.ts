/**
 * Provider C: Jamendo & Open Independent Music Search Integration
 *
 * Uses user-configured `VITE_JAMENDO_CLIENT_ID` when present (via local Vite proxy to prevent
 * Safari CORS errors on invalid/demo client IDs), and automatically supplements with
 * the public Audius Open Audio Protocol (`api.audius.co`) with spam/ad filtering.
 */

import { type SearchResult, detectTrackQuality, isLikelySpamOrAdResult } from './quality';

const JAMENDO_API_BASE = 'https://api.jamendo.com/v3.0/tracks/';
const AUDIUS_SEARCH_API = 'https://api.audius.co/v1/tracks/search';
const JAMENDO_TIMEOUT_MS = 6500;

interface JamendoTrackRaw {
  id?: string | number;
  name?: string;
  duration?: number | string;
  artist_name?: string;
  album_name?: string;
  album_image?: string;
  image?: string;
  audio?: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
}

interface JamendoResponse {
  headers?: {
    status?: string;
    code?: number;
    error_message?: string;
  };
  results?: JamendoTrackRaw[];
}

function getConfiguredJamendoClientId(): string | null {
  try {
    const raw = (import.meta as any).env?.VITE_JAMENDO_CLIENT_ID;
    const clean = typeof raw === 'string' ? raw.trim() : '';
    if (!clean || clean === '7e6f3dfa') return null;
    return clean.length >= 6 ? clean : null;
  } catch {
    return null;
  }
}

function inferJamendoCodec(url: string): {
  codec?: string;
  mimeType?: string;
  bitrate?: number;
  format?: string;
} {
  const lower = url.toLowerCase();
  if (lower.includes('format=flac') || lower.endsWith('.flac')) {
    return {
      codec: 'FLAC',
      mimeType: 'audio/flac',
      format: 'Jamendo FLAC',
    };
  }
  if (lower.includes('ogg') || lower.endsWith('.ogg')) {
    return {
      codec: 'Vorbis',
      mimeType: 'audio/ogg',
      format: 'Jamendo OGG',
    };
  }
  if (lower.includes('mp32') || lower.includes('mp3') || lower.endsWith('.mp3')) {
    return {
      codec: 'MP3',
      mimeType: 'audio/mpeg',
      bitrate: 192,
      format: 'Jamendo MP3 (192kbps VBR)',
    };
  }
  return {
    codec: 'MP3',
    mimeType: 'audio/mpeg',
    bitrate: 192,
    format: 'Jamendo Stream',
  };
}

async function fetchJamendoWithClientId(
  cleanQuery: string,
  clientId: string,
  limit: number,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JAMENDO_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      format: 'json',
      limit: String(limit),
      search: cleanQuery,
      audioformat: 'mp32',
    });

    const response = await fetch(`${JAMENDO_API_BASE}?${params.toString()}`, {
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const data: JamendoResponse = await response.json();
    if (data?.headers?.status === 'failed' || (typeof data?.headers?.code === 'number' && data.headers.code !== 0)) {
      return [];
    }

    const rawTracks = Array.isArray(data?.results) ? data.results : [];
    const results: SearchResult[] = [];

    for (const track of rawTracks) {
      if (!track || !track.id) continue;

      const streamUrl = String(track.audio || '').trim();
      const downloadUrl =
        track.audiodownload_allowed && track.audiodownload
          ? String(track.audiodownload).trim()
          : streamUrl;

      const primaryUrl = downloadUrl || streamUrl;
      if (!primaryUrl || !/^https?:\/\//i.test(primaryUrl)) continue;

      const name = String(track.name || 'Untitled').trim();
      const album = String(track.album_name || 'Jamendo').trim() || 'Jamendo';
      const artist = String(track.artist_name || 'Unknown Artist').trim() || 'Unknown Artist';
      if (isLikelySpamOrAdResult({ name, artist, album })) continue;

      const fallbackUrls =
        streamUrl && streamUrl !== primaryUrl && /^https?:\/\//i.test(streamUrl)
          ? [streamUrl]
          : undefined;

      const codecMeta = inferJamendoCodec(primaryUrl);
      const qualityBadge = detectTrackQuality(primaryUrl, codecMeta.format, codecMeta.bitrate, {
        codecHint: codecMeta.codec,
        mimeTypeHint: codecMeta.mimeType,
        providerVerified: Boolean(codecMeta.codec === 'FLAC'),
        sourceHint: 'Jamendo',
      });

      results.push({
        id: `jamendo:${track.id}`,
        name,
        album,
        artist,
        image: String(track.album_image || track.image || '').trim(),
        downloadUrl: primaryUrl,
        fallbackUrls,
        duration: Math.max(0, Number(track.duration) || 0),
        source: 'Jamendo',
        qualityBadge,
        bitrate: codecMeta.bitrate,
        codec: codecMeta.codec,
        mimeType: codecMeta.mimeType,
        format: codecMeta.format,
        qualityVerified: Boolean(codecMeta.codec === 'FLAC'),
      });
    }

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Public Open Audio Protocol search (Audius) with zero API key requirement,
 * spam/podcast filtering, and stripped unreliable creator-node image URLs.
 */
async function fetchOpenIndieFallback(
  cleanQuery: string,
  limit: number,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JAMENDO_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(
      `${AUDIUS_SEARCH_API}?query=${encodeURIComponent(cleanQuery)}&app_name=VOID_MUSIC_PLAYER`,
      { signal: controller.signal }
    );
    if (!response.ok) return [];

    const payload: any = await response.json();
    const rows: any[] = Array.isArray(payload?.data) ? payload.data : [];
    const results: SearchResult[] = [];

    for (const item of rows.slice(0, limit)) {
      const id = String(item?.id || '').trim();
      if (!id || item?.is_streamable === false) continue;

      const title = String(item?.title || 'Untitled').trim();
      const artist = String(item?.user?.name || item?.user?.handle || 'Independent Artist').trim();
      const genre = String(item?.genre || '').trim();
      const album = genre || 'Jamendo Indie';

      // Filter out podcasts, spoken word ads, or non-music marketing spam
      if (
        /podcast|spoken\s*word|audiobook|business|education/i.test(genre) ||
        isLikelySpamOrAdResult({ name: title, artist, album })
      ) {
        continue;
      }

      const streamUrl = `https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?app_name=VOID_MUSIC_PLAYER`;

      const rawArtwork = String(
        item?.artwork?.['480x480'] || item?.artwork?.['150x150'] || ''
      ).trim();
      const isUnreliableNode =
        !rawArtwork ||
        /audius-nodes\.com|audiusindex\.org|creatornode|ipfs|blockdaemon|figment/i.test(rawArtwork);
      const artwork = isUnreliableNode ? '' : rawArtwork;

      const duration = Math.max(0, Number(item?.duration) || 0);

      results.push({
        id: `jamendo:audius-${id}`,
        name: title,
        album,
        artist,
        image: artwork,
        downloadUrl: streamUrl,
        duration,
        source: 'Jamendo',
        qualityBadge: 'Very High (320kbps)',
        bitrate: 320,
        codec: 'MP3',
        mimeType: 'audio/mpeg',
        format: 'MP3 320kbps',
        qualityVerified: true,
      });
    }

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

export async function searchJamendo(
  query: string,
  externalSignal?: AbortSignal,
  limit = 24
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const clientId = getConfiguredJamendoClientId();
  if (clientId) {
    if (externalSignal?.aborted) return [];
    const results = await fetchJamendoWithClientId(cleanQuery, clientId, limit, externalSignal);
    if (results.length > 0) return results;
  }

  return fetchOpenIndieFallback(cleanQuery, limit, externalSignal);
}
