/**
 * Provider E: Third-Party Lossless & Multi-Gateway Music Connector
 * Environment variable: VITE_LOSSLESS_API_URLS (optional custom gateway URLs)
 *
 * Deeply integrates multiple third-party lossless sources:
 * 1. Local Vite Multi-Gateway Lossless Aggregator (`/__void_api/lossless-search`):
 *    - HiFi / Tidal Lossless API v2 mirrors (`triton.squid.wtf`, `wolf.qqdl.site`, `maus.qqdl.site`,
 *      `vogel.qqdl.site`, `katze.qqdl.site`, `hund.qqdl.site`, `tidal.kinoplus.online`, `hifi.401658.xyz`)
 *      with base64 `application/vnd.tidal.bts` 16-bit/44.1kHz FLAC manifest decoding
 *    - Archive.org 16-bit & 24-bit FLAC / WAV / ALAC Lossless Masters
 *    - Lossless Master Catalog Resolver
 * 2. User-configured lossless gateways (`VITE_LOSSLESS_API_URLS`)
 * 3. Direct Archive.org FLAC / WAV Lossless Catalog fallback
 */

import { type SearchResult, detectTrackQuality, formatProviderLabel } from "./quality";

const GATEWAY_TIMEOUT_MS = 6500;

export const BUILTIN_THIRD_PARTY_LOSSLESS_MIRRORS = [
  "https://triton.squid.wtf",
  "https://wolf.qqdl.site",
  "https://maus.qqdl.site",
  "https://vogel.qqdl.site",
  "https://katze.qqdl.site",
  "https://hund.qqdl.site",
  "https://tidal.kinoplus.online",
  "https://hifi.401658.xyz",
] as const;

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

  if (
    typeof directUrl !== "string" ||
    !/^https?:\/\//i.test(directUrl.trim()) ||
    directUrl.includes("www.tidal.com/track/") ||
    directUrl.includes("tidal.com/browse/track/")
  ) {
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

function resolveTidalCoverUrl(cover?: string): string {
  if (!cover || typeof cover !== "string") return "";
  if (/^https?:\/\//i.test(cover)) return cover;
  if (/^[0-9a-f-]{32,36}$/i.test(cover)) {
    return `https://resources.tidal.com/images/${cover.replace(/-/g, "/")}/640x640.jpg`;
  }
  return "";
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

      const image =
        String(item.image || item.cover || item.artwork || item.album?.image || "").trim() ||
        resolveTidalCoverUrl(item.album?.cover);

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

      const formatHint = [
        streamInfo.format,
        codec,
        bitDepth ? `${bitDepth}-bit` : "",
        sampleRate ? `${sampleRate}Hz` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const hasCredibleLosslessMetadata = Boolean(
        (codec && /\b(flac|alac|wav|aiff|pcm)\b/i.test(codec)) ||
          (mimeType && /\b(flac|wav|aiff|alac)\b/i.test(mimeType)) ||
          /\.(flac|wav|aiff|alac)(\?|$)/i.test(streamInfo.url) ||
          (bitDepth && bitDepth >= 16 && (!codec || !/\b(mp3|aac|ogg|opus)\b/i.test(codec)))
      );

      const qualityBadge = detectTrackQuality(
        streamInfo.url,
        hasCredibleLosslessMetadata ? `FLAC ${formatHint}` : formatHint,
        bitrate,
        {
          codecHint: codec,
          mimeTypeHint: mimeType,
          providerVerified: hasCredibleLosslessMetadata || Boolean(bitrate),
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
        codec: codec || (hasCredibleLosslessMetadata ? "FLAC" : undefined),
        mimeType: mimeType || (hasCredibleLosslessMetadata ? "audio/flac" : undefined),
        format: formatHint || codec,
        qualityVerified: hasCredibleLosslessMetadata || Boolean(bitrate),
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
 * Queries the local Vite Node.js multi-gateway lossless proxy (`/__void_api/lossless-search`),
 * which aggregates third-party HiFi/Tidal FLAC mirrors, Archive.org 16-bit/24-bit FLAC/WAV masters,
 * and lossless master catalogs with zero browser CORS restrictions.
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
 * Built-in Public FLAC / WAV Lossless Gateway (queries verified lossless FLAC/WAV masters
 * from the Open Archive lossless audio index).
 */
const NON_MUSIC_LOSSLESS_JUNK_REGEX =
  /\b(session|studio\s*session|interview|death\s*tape|jonestown|rigveda|rig\s*veda|veda|sermon|lecture|podcast|audiobook|spoken\s*word|speech|broadcast|radio\s*show|field\s*recording|test\s*tone|sound\s*effect|sample\s*pack|prelinger|librivox|fbi\s*no|tape\s*\d+)\b/i;

async function resolveLosslessOfficialArtwork(title: string, artist: string, fallbackQuery: string): Promise<string> {
  const searchQ = `${title} ${artist !== "Unknown Artist" ? artist : ""}`.trim() || fallbackQuery;
  if (!searchQ) return "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2400);
  try {
    const res = await fetch(
      `/__void_api/itunes-search?term=${encodeURIComponent(searchQ)}&entity=song&limit=4`,
      { signal: ctrl.signal }
    );
    if (res.ok) {
      const json: any = await res.json();
      const match = Array.isArray(json?.results) ? json.results.find((r: any) => r?.artworkUrl100) : null;
      if (match?.artworkUrl100) {
        return String(match.artworkUrl100).replace("100x100bb", "600x600bb");
      }
    }
  } catch {
    /* ignore */
  } finally {
    clearTimeout(timer);
  }
  return "";
}

async function queryBuiltInLosslessFlacCatalog(
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const rawWords = query
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const sigTokens = rawWords
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 2 && w !== "the" && w !== "and");
    const cleanWords = rawWords.map((w) => {
      if (w.toLowerCase() === "sadeness") return "(sadeness OR sadness)";
      if (w.toLowerCase() === "sadness") return "(sadness OR sadeness)";
      return w;
    });
    if (cleanWords.length === 0) return [];
    const lucene = `mediatype:(audio) AND format:(Flac OR "24bit Flac" OR WAVE) AND (${cleanWords.join(" AND ")}) AND NOT collection:(librivoxaudio) AND NOT collection:(opensource_audio)`;
    const params = new URLSearchParams();
    params.set("q", lucene);
    params.append("fl[]", "identifier");
    params.append("fl[]", "title");
    params.append("fl[]", "creator");
    params.append("sort[]", "downloads desc");
    params.set("rows", "4");
    params.set("page", "1");
    params.set("output", "json");

    const res = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
    if (docs.length === 0) return [];

    const settled = await Promise.allSettled(
      docs.slice(0, 4).map(async (doc: any): Promise<SearchResult | null> => {
        const identifier = String(doc?.identifier || "").trim();
        if (!identifier) return null;
        const docTitle = Array.isArray(doc.title) ? doc.title[0] : doc.title;
        const docCreator = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator;
        if (NON_MUSIC_LOSSLESS_JUNK_REGEX.test(`${identifier} ${docTitle || ""} ${docCreator || ""}`)) {
          return null;
        }

        const metaRes = await fetch(
          `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
          { signal: controller.signal }
        );
        if (!metaRes.ok) return null;
        const meta = await metaRes.json();
        if (
          meta?.is_dark ||
          meta?.metadata?.["access-restricted-item"] === "true" ||
          !Array.isArray(meta?.files)
        ) {
          return null;
        }
        const flacFile = meta.files.find(
          (f: any) =>
            f &&
            f.private !== "true" &&
            f.private !== true &&
            (/\.(flac|wav|aiff|alac)$/i.test(String(f.name || "")) ||
              /\b(flac|wave?|apple lossless)\b/i.test(String(f.format || "")))
        );
        if (!flacFile || !flacFile.name) return null;

        const title =
          String(flacFile.title || "").trim() ||
          docTitle ||
          identifier;
        const artist =
          String(flacFile.artist || flacFile.creator || "").trim() ||
          docCreator ||
          "Unknown Artist";
        const album = String(flacFile.album || title || "Lossless Audio").trim();

        if (NON_MUSIC_LOSSLESS_JUNK_REGEX.test(`${title} ${artist} ${album}`)) {
          return null;
        }

        const combinedLower = `${title} ${artist} ${album}`.toLowerCase();
        const matchesQuery = sigTokens.some((tok) => {
          if (tok === "sadeness" || tok === "sadness") {
            return combinedLower.includes("sadeness") || combinedLower.includes("sadness");
          }
          return combinedLower.includes(tok);
        });
        if (!matchesQuery) return null;

        const rawLen = String(flacFile.length || "").trim();
        let duration = 0;
        if (/^\d+(\.\d+)?$/.test(rawLen)) duration = Math.round(Number.parseFloat(rawLen));
        else if (rawLen.includes(":")) {
          const parts = rawLen.split(":").map(Number);
          if (parts.length === 2) duration = Math.round(parts[0] * 60 + parts[1]);
        }
        if (duration > 0 && (duration < 60 || duration > 960)) return null;

        const mp3Fallback = meta.files.find(
          (f: any) => f && f.private !== "true" && /\.mp3$/i.test(String(f.name || ""))
        );

        const buildUrl = (name: string) =>
          `https://archive.org/download/${encodeURIComponent(identifier)}/${name
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`;

        const flacUrl = buildUrl(String(flacFile.name));
        const fallbackUrls = mp3Fallback?.name ? [buildUrl(String(mp3Fallback.name))] : undefined;

        const officialCover = await resolveLosslessOfficialArtwork(String(title).trim(), String(artist).trim(), query);

        return {
          id: `lossless:flac-${identifier}`,
          name: String(title).trim(),
          album,
          artist: String(artist).trim(),
          image: officialCover,
          downloadUrl: flacUrl,
          duration,
          source: "Lossless Source",
          qualityBadge: "Lossless",
          bitrate: 1411,
          codec: "FLAC",
          mimeType: "audio/flac",
          format: "FLAC Lossless",
          qualityVerified: true,
          fallbackUrls,
        };
      })
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<SearchResult | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((item): item is SearchResult => item !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Mandatory Third-Party Lossless Gateway Search Connector.
 */
export async function searchThirdPartyLossless(
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const status = parseLosslessGatewayUrls();
  const tasks: Promise<SearchResult[]>[] = [
    queryLocalLosslessAggregator(cleanQuery, externalSignal),
    queryBuiltInLosslessFlacCatalog(cleanQuery, externalSignal),
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
