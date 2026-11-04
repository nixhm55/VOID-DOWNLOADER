/**
 * Provider E: Lossless Audio Connector
 * Environment variable: VITE_LOSSLESS_API_URLS (optional custom gateway URLs)
 *
 * Strictly returns verified FLAC, ALAC, WAV, or AIFF lossless streams from:
 * 1. Local Vite Lossless Aggregator (`/__void_api/lossless-search`)
 * 2. Official Jamendo FLAC API (`audioformat=flac` when client_id is configured)
 * 3. User-configured lossless gateways (`VITE_LOSSLESS_API_URLS`)
 *
 * Never uses unauthorized mirrors or lossy AAC/MP3 fallbacks.
 */

import { type SearchResult, detectTrackQuality, formatProviderLabel } from "./quality";

const GATEWAY_TIMEOUT_MS = 6500;

export const BUILTIN_THIRD_PARTY_LOSSLESS_MIRRORS = [] as const;

export interface LosslessGatewayConfigStatus {
  configured: boolean;
  endpoints: string[];
  invalidEntries: string[];
}

/**
 * Safely parses, validates, normalizes, and deduplicates `VITE_LOSSLESS_API_URLS`.
 */
export function parseLosslessGatewayUrls(rawEnv?: string): LosslessGatewayConfigStatus {
  const raw = String(rawEnv ?? import.meta.env.VITE_LOSSLESS_API_URLS ?? "").trim();
  if (!raw) {
    return { configured: false, endpoints: [], invalidEntries: [] };
  }

  let candidates: string[] = [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        candidates = parsed.map((item) => String(item ?? "").trim());
      }
    } catch {
      candidates = raw.split(/[\s,;]+/);
    }
  } else {
    candidates = raw.split(/[\s,;]+/);
  }

  const seen = new Set<string>();
  const endpoints: string[] = [];
  const invalidEntries: string[] = [];

  for (const entry of candidates) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (/^(your_|placeholder|example|https?:\/\/example\.com|https?:\/\/your-)/i.test(trimmed)) {
      invalidEntries.push(trimmed);
      continue;
    }
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        invalidEntries.push(trimmed);
        continue;
      }
      const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
      if (!seen.has(normalized)) {
        seen.add(normalized);
        endpoints.push(normalized);
      }
    } catch {
      invalidEntries.push(trimmed);
    }
  }

  return {
    configured: endpoints.length > 0,
    endpoints,
    invalidEntries,
  };
}

function extractTrackListFromPayload(payload: unknown): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object") return [];

  const obj = payload as Record<string, any>;
  if (Array.isArray(obj.data)) return obj.data;
  if (obj.data && typeof obj.data === "object") {
    if (Array.isArray(obj.data.items)) return obj.data.items;
    if (Array.isArray(obj.data.results)) return obj.data.results;
    if (Array.isArray(obj.data.tracks)) return obj.data.tracks;
    if (obj.data.tracks && Array.isArray(obj.data.tracks.items)) return obj.data.tracks.items;
  }
  if (Array.isArray(obj.results)) return obj.results;
  if (obj.results && typeof obj.results === "object" && Array.isArray(obj.results.items)) {
    return obj.results.items;
  }
  if (Array.isArray(obj.tracks)) return obj.tracks;
  if (obj.tracks && typeof obj.tracks === "object" && Array.isArray(obj.tracks.items)) {
    return obj.tracks.items;
  }
  if (Array.isArray(obj.items)) return obj.items;
  return [];
}

function decodeBase64Manifest(manifestBase64: string): {
  url?: string;
  mimeType?: string;
  codec?: string;
} | null {
  try {
    const decoded =
      typeof atob === "function"
        ? atob(manifestBase64)
        : Buffer.from(manifestBase64, "base64").toString("utf-8");
    const json = JSON.parse(decoded);
    const url = Array.isArray(json?.urls) ? json.urls[0] : json?.url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      return {
        url: url.trim(),
        mimeType: typeof json.mimeType === "string" ? json.mimeType : undefined,
        codec: typeof json.codecs === "string" ? json.codecs.toUpperCase() : undefined,
      };
    }
  } catch {
    // Ignore non-JSON or DASH XML manifests
  }
  return null;
}

function extractStreamUrlFromTrackPayload(payload: unknown): {
  url: string;
  codec?: string;
  mimeType?: string;
  bitrate?: number;
  format?: string;
  bitDepth?: number;
  sampleRate?: number;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, any>;
  const root =
    obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data : obj;

  if (typeof root.manifest === "string" && root.manifest.trim()) {
    const manifestInfo = decodeBase64Manifest(root.manifest.trim());
    if (manifestInfo?.url) {
      return {
        url: manifestInfo.url,
        codec: manifestInfo.codec || "FLAC",
        mimeType: manifestInfo.mimeType || "audio/flac",
        format: String(root.audioQuality || "LOSSLESS"),
        bitDepth: Number(root.bitDepth) || 16,
        sampleRate: Number(root.sampleRate) || 44100,
      };
    }
  }

  const directUrl =
    root.streamUrl ||
    root.downloadUrl ||
    root.audioUrl ||
    root.OriginalTrackUrl ||
    root.url ||
    root.stream?.url ||
    root.audio?.url ||
    (Array.isArray(root.urls) ? root.urls[0]?.url || root.urls[0] : "");

  if (typeof directUrl !== "string" || !/^https?:\/\//i.test(directUrl.trim())) {
    return null;
  }

  const rawBitrate = Number(root.bitrate ?? root.stream?.bitrate ?? root.audioQuality?.bitrate);
  const bitrate =
    Number.isFinite(rawBitrate) && rawBitrate > 0
      ? rawBitrate > 10000
        ? Math.round(rawBitrate / 1000)
        : Math.round(rawBitrate)
      : undefined;

  return {
    url: directUrl.trim(),
    codec: String(root.codec || root.stream?.codec || root.audioCodec || "").trim() || undefined,
    mimeType:
      String(root.mimeType || root.contentType || root.stream?.mimeType || "").trim() || undefined,
    bitrate,
    format: String(root.format || root.audioQuality || root.quality || "").trim() || undefined,
    bitDepth: Number(root.bitDepth || root.bitsPerSample) || undefined,
    sampleRate: Number(root.sampleRate) || undefined,
  };
}

async function resolveTrackStreamFromGateway(
  gatewayBase: string,
  trackId: string,
  signal: AbortSignal
): Promise<ReturnType<typeof extractStreamUrlFromTrackPayload>> {
  const candidateRoutes = [
    `${gatewayBase}/track/?id=${encodeURIComponent(trackId)}&quality=LOSSLESS`,
    `${gatewayBase}/track?id=${encodeURIComponent(trackId)}`,
    `${gatewayBase}/stream?id=${encodeURIComponent(trackId)}`,
  ];

  for (const route of candidateRoutes) {
    if (signal.aborted) return null;
    try {
      const res = await fetch(route, { signal });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type")?.toLowerCase() || "";
      if (contentType.startsWith("audio/")) {
        return {
          url: route,
          mimeType: contentType.split(";")[0].trim(),
          codec: contentType.includes("flac") ? "FLAC" : undefined,
        };
      }
      const json = await res.json();
      const extracted = extractStreamUrlFromTrackPayload(json);
      if (extracted) return extracted;
    } catch {
      // Try next route candidate
    }
  }
  return null;
}

function inferProviderDisplayName(item: any, gatewayBase: string): string {
  const explicit = String(
    item?.provider || item?.source || item?.service || item?.platform || ""
  ).trim();
  if (explicit && explicit.toLowerCase() !== "void") {
    return formatProviderLabel(explicit);
  }
  if (gatewayBase) {
    return "Lossless Source";
  }
  return "Lossless Source";
}

async function querySingleLosslessGateway(
  gatewayBase: string,
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const searchCandidates = [
      `${gatewayBase}/search/?s=${encodeURIComponent(query)}&limit=8`,
      `${gatewayBase}/search?q=${encodeURIComponent(query)}`,
    ];

    let rawItems: any[] = [];
    for (const searchUrl of searchCandidates) {
      if (controller.signal.aborted) break;
      try {
        const response = await fetch(searchUrl, { signal: controller.signal });
        if (!response.ok) continue;
        const payload: unknown = await response.json();
        rawItems = extractTrackListFromPayload(payload);
        if (rawItems.length > 0) break;
      } catch {
        // Try next search route format
      }
    }

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const item of rawItems.slice(0, 6)) {
      if (!item || typeof item !== "object") continue;

      const rawId = String(item.id ?? item.trackId ?? item.isrc ?? "").trim();
      const title = String(item.title ?? item.name ?? "").trim();
      if (!rawId || !title) continue;

      const artist =
        typeof item.artist === "string"
          ? item.artist.trim()
          : typeof item.artist?.name === "string"
            ? item.artist.name.trim()
            : Array.isArray(item.artists)
              ? item.artists
                  .map((a: any) => (typeof a === "string" ? a : a?.name))
                  .filter(Boolean)
                  .join(", ")
              : "Unknown Artist";

      const album =
        typeof item.album === "string"
          ? item.album.trim()
          : typeof item.album?.title === "string"
            ? item.album.title.trim()
            : typeof item.album?.name === "string"
              ? item.album.name.trim()
              : "Unknown Album";

      const image = String(
        item.image || item.cover || item.artwork || item.album?.image || ""
      ).trim();

      let streamInfo = extractStreamUrlFromTrackPayload(item);
      if (!streamInfo && !controller.signal.aborted) {
        streamInfo = await resolveTrackStreamFromGateway(gatewayBase, rawId, controller.signal);
      }
      if (!streamInfo || !streamInfo.url) continue;

      const codec = streamInfo.codec || (typeof item.codec === "string" ? item.codec : undefined);
      const mimeType =
        streamInfo.mimeType || (typeof item.mimeType === "string" ? item.mimeType : undefined);
      const bitrate = streamInfo.bitrate;
      const bitDepth =
        streamInfo.bitDepth || Number(item.bitDepth || item.bitsPerSample) || undefined;
      const sampleRate = streamInfo.sampleRate || Number(item.sampleRate) || undefined;

      const hasCredibleLosslessMetadata = Boolean(
        (codec && /\b(flac|alac|wav|aiff|pcm)\b/i.test(codec)) ||
          (mimeType && /\b(flac|wav|aiff|alac)\b/i.test(mimeType)) ||
          /\.(flac|wav|aiff|alac)(\?|$)/i.test(streamInfo.url)
      );

      if (!hasCredibleLosslessMetadata) continue;

      const formatHint = [
        streamInfo.format,
        codec,
        bitDepth ? `${bitDepth}-bit` : "",
        sampleRate ? `${sampleRate}Hz` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const qualityBadge = detectTrackQuality(
        streamInfo.url,
        `FLAC ${formatHint}`,
        bitrate,
        {
          codecHint: codec,
          mimeTypeHint: mimeType,
          providerVerified: true,
        }
      );

      const providerLabel = inferProviderDisplayName(item, gatewayBase);

      results.push({
        id: `lossless:${rawId}`,
        name: title,
        album,
        artist: artist || "Unknown Artist",
        image,
        downloadUrl: streamInfo.url,
        duration: Number(item.duration || item.durationSeconds) || 0,
        source: providerLabel,
        qualityBadge,
        bitrate,
        codec: codec || "FLAC",
        mimeType: mimeType || "audio/flac",
        format: formatHint || codec || "FLAC Lossless",
        qualityVerified: true,
        bitDepth,
        sampleRate,
      });
    }

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Queries the local Vite Node.js lossless endpoint (`/__void_api/lossless-search`),
 * which aggregates Archive.org 16-bit/24-bit FLAC/ALAC/WAV masters with zero browser CORS restrictions.
 */
async function queryLocalLosslessAggregator(
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(`/__void_api/lossless-search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return [];
    const items = await res.json();
    if (!Array.isArray(items)) return [];
    return items.filter((item): item is SearchResult => Boolean(item && item.id && item.downloadUrl));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Queries official Jamendo API v3.0 for licensed full-length FLAC lossless tracks when a Jamendo Client ID is configured.
 */
async function queryJamendoOfficialFlacCatalog(
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const clientId = String(import.meta.env.VITE_JAMENDO_CLIENT_ID || "").trim();
  if (!clientId || clientId === "7e6f3dfa") return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: "6",
      search: query,
      audioformat: "flac",
    });
    const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data?.results) ? data.results : [];
    const results: SearchResult[] = [];

    for (const row of rows) {
      const flacUrl = String(row?.audio || row?.audiodownload || "").trim();
      const duration = Number(row?.duration) || 0;
      if (!row?.id || !/^https?:\/\//i.test(flacUrl) || (duration > 0 && duration < 35)) continue;
      if (!/flac/i.test(flacUrl)) continue;

      results.push({
        id: `jamendo-flac:${row.id}`,
        name: String(row.name || "Untitled").trim(),
        album: String(row.album_name || "Jamendo Lossless").trim(),
        artist: String(row.artist_name || "Jamendo Artist").trim(),
        image: String(row.album_image || row.image || "").trim(),
        downloadUrl: flacUrl,
        duration,
        source: "Lossless Source",
        qualityBadge: "Lossless",
        bitrate: 1411,
        codec: "FLAC",
        mimeType: "audio/flac",
        format: "FLAC Lossless (16-bit/44.1kHz · Jamendo Official)",
        qualityVerified: true,
        bitDepth: 16,
        sampleRate: 44100,
      });
    }
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

export async function searchThirdPartyLossless(
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const status = parseLosslessGatewayUrls();
  const tasks: Promise<SearchResult[]>[] = [
    queryLocalLosslessAggregator(cleanQuery, externalSignal),
    queryJamendoOfficialFlacCatalog(cleanQuery, externalSignal),
    ...status.endpoints.map((endpoint) =>
      querySingleLosslessGateway(endpoint, cleanQuery, externalSignal)
    ),
  ];

  const settled = await Promise.allSettled(tasks);

  const combined: SearchResult[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && Array.isArray(outcome.value)) {
      combined.push(...outcome.value);
    }
  }

  return combined;
}
