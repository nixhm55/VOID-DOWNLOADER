/* Song search and song metadata for JioSaavn (#1 priority provider). */
import {
  type QualityTier,
  type SearchResult,
  cleanCanonicalTrackTitle,
  detectTrackQuality,
  formatProviderLabel,
  getTrackQualityBadge,
} from "./quality";

export type { QualityTier, SearchResult };

export { detectTrackQuality, formatProviderLabel, getTrackQualityBadge };

const JIOSAAVN_MIRRORS = [
  "https://elitejiosaavn-api.vercel.app/api",
  "https://saavn.dev/api",
  "https://jiosaavn-api-privatecvc2.vercel.app",
];

const JIOSAAVN_TIMEOUT_MS = 5500;

type JioArtist = {
  id?: string | number;
  name?: string;
};

type JioImage = {
  quality?: string;
  url?: string;
  link?: string;
};

type JioDownload = {
  quality?: string;
  url?: string;
  link?: string;
};

type JioSong = {
  id?: string | number;
  name?: string;
  title?: string;
  subtitle?: string;
  language?: string;
  label?: string;
  primaryArtists?: string;
  album?: {
    name?: string;
  };
  artists?: {
    primary?: JioArtist[];
  };
  image?: JioImage[];
  downloadUrl?: JioDownload[];
  duration?: number | string;
};

function decodeHtmlEntities(input: string): string {
  if (!input) return "";
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getArtist(song: JioSong): string {
  if (typeof song.primaryArtists === "string" && song.primaryArtists.trim()) {
    return decodeHtmlEntities(song.primaryArtists);
  }
  const artists = song.artists?.primary;

  if (!Array.isArray(artists)) {
    return "Unknown Artist";
  }

  const joined = artists
    .map((artist) => decodeHtmlEntities(String(artist?.name || "")))
    .filter(Boolean)
    .join(", ");

  return joined || "Unknown Artist";
}

function getAlbum(song: JioSong): string {
  return decodeHtmlEntities(String(song.album?.name || "")) || "Unknown Album";
}

function getImage(song: JioSong): string {
  if (!Array.isArray(song.image)) {
    return "";
  }

  const validImages = song.image
    .map((img) => ({ quality: img?.quality, url: img?.url || img?.link || "" }))
    .filter((img) => isValidHttpUrl(img.url));
  const highQuality = validImages.find((image) => image.quality === "500x500");

  return (
    highQuality?.url ||
    validImages[validImages.length - 1]?.url ||
    validImages[0]?.url ||
    ""
  );
}

function parseQualityKbps(qualityLabel?: string): number | undefined {
  if (!qualityLabel) return undefined;
  const match = String(qualityLabel).match(/(\d+)\s*kbps/i);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

interface JioDownloadVariantItem {
  url: string;
  qualityLabel?: string;
  bitrate?: number;
}

function extractValidDownloadVariants(song: JioSong): JioDownloadVariantItem[] {
  if (!Array.isArray(song.downloadUrl)) {
    return [];
  }

  return song.downloadUrl
    .map((item) => ({
      quality: item?.quality,
      url: String(item?.url || item?.link || "").trim(),
    }))
    .filter((item) => isValidHttpUrl(item.url))
    .map((item) => ({
      url: item.url,
      qualityLabel: item.quality ? String(item.quality).trim() : undefined,
      bitrate: parseQualityKbps(item.quality),
    }))
    .sort((a, b) => (b.bitrate ?? -1) - (a.bitrate ?? -1));
}

function parseJioSongsPayload(json: any): SearchResult[] {
  const songs: JioSong[] = Array.isArray(json?.data?.results)
    ? json.data.results
    : Array.isArray(json?.results)
      ? json.results
      : Array.isArray(json?.data)
        ? json.data
        : [];

  if (!Array.isArray(songs)) {
    return [];
  }

  const normalized: SearchResult[] = [];

  for (const song of songs) {
    const id = String(song?.id || "").trim();
    const variants = extractValidDownloadVariants(song);
    if (!id || variants.length === 0) continue;

    const best = variants[0];
    const highVariant = variants.find((v) => v.bitrate && v.bitrate >= 140 && v.bitrate < 280);
    const stdVariant = variants.find((v) => v.bitrate && v.bitrate >= 64 && v.bitrate < 140);

    const fallbackUrls = variants
      .slice(1)
      .map((v) => v.url)
      .filter((url) => url !== best.url);

    const qualityBadge = detectTrackQuality(best.url, best.qualityLabel || "AAC", best.bitrate, {
      codecHint: "AAC",
      mimeTypeHint: "audio/mp4",
      providerVerified: Boolean(best.bitrate),
    });

    const rawSongName = decodeHtmlEntities(String(song.name || song.title || "Unknown Song"));
    const cleanName = cleanCanonicalTrackTitle(rawSongName) || rawSongName;
    const cleanAlbum = cleanCanonicalTrackTitle(getAlbum(song)) || getAlbum(song);

    normalized.push({
      id,
      name: cleanName,
      album: cleanAlbum,
      artist: getArtist(song),
      image: getImage(song),
      downloadUrl: best.url,
      duration: Number(song.duration) || 0,
      source: "JioSaavn",
      qualityBadge,
      bitrate: best.bitrate,
      codec: "AAC",
      mimeType: "audio/mp4",
      format: best.qualityLabel ? `MP4 (${best.qualityLabel})` : "MP4/AAC",
      qualityVerified: Boolean(best.bitrate),
      fallbackUrls,
      qualityUrls: {
        "very-high": best.url,
        high: highVariant?.url || best.url,
        standard: stdVariant?.url || highVariant?.url || best.url,
      },
      language: typeof song.language === "string" ? song.language.toLowerCase().trim() : undefined,
      label: typeof song.label === "string" ? decodeHtmlEntities(song.label) : undefined,
    });
  }

  return normalized;
}

async function fetchJioMirror(
  baseUrl: string,
  cleanQuery: string,
  limit: number,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JIOSAAVN_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  const targetUrl = `${baseUrl}/search/songs?query=${encodeURIComponent(cleanQuery)}&page=1&limit=${limit}`;
  const urlsToTry = [
    targetUrl,
    `/__void_api/proxy?url=${encodeURIComponent(targetUrl)}`,
  ];

  try {
    for (const url of urlsToTry) {
      if (controller.signal.aborted) break;
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) continue;
        const json = await response.json();
        const parsed = parseJioSongsPayload(json);
        if (parsed.length > 0) {
          return parsed;
        }
      } catch {
        // Try proxy or next mirror
      }
    }
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function searchJioSaavn(
  query: string,
  externalSignal?: AbortSignal,
  limit = 40
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  for (const mirror of JIOSAAVN_MIRRORS) {
    if (externalSignal?.aborted) return [];
    const results = await fetchJioMirror(mirror, cleanQuery, limit, externalSignal);
    if (results.length > 0) {
      return results;
    }
  }

  return [];
}

export async function searchMusic(
  query: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  return searchJioSaavn(query, signal);
}
