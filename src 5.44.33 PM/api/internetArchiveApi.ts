/**
 * Provider B: Internet Archive Audio Search & Metadata Resolution
 * Search endpoint: https://archive.org/advancedsearch.php
 * Metadata endpoint: https://archive.org/metadata/{identifier}
 * Artwork endpoint: https://archive.org/services/img/{identifier}
 */

import { type SearchResult, detectTrackQuality } from "./quality";

const IA_SEARCH_URL = "https://archive.org/advancedsearch.php";
const IA_METADATA_BASE = "https://archive.org/metadata";
const IA_DOWNLOAD_BASE = "https://archive.org/download";

const IA_SEARCH_TIMEOUT_MS = 6500;
const IA_METADATA_TIMEOUT_MS = 5000;
const IA_MAX_ITEMS = 6;

interface IASearchDoc {
  identifier?: string;
  title?: string | string[];
  creator?: string | string[];
  downloads?: number;
  mediatype?: string;
}

interface IAFileEntry {
  name?: string;
  source?: string;
  format?: string;
  bitrate?: string | number;
  length?: string | number;
  size?: string | number;
  title?: string;
  artist?: string;
  creator?: string;
  album?: string;
  private?: string | boolean;
}

interface IAMetadataResponse {
  is_dark?: boolean;
  metadata?: {
    identifier?: string;
    title?: string | string[];
    creator?: string | string[];
    "access-restricted-item"?: string | boolean;
  };
  files?: IAFileEntry[];
}

const metadataCache = new Map<string, SearchResult | null>();

function firstString(val: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(val)) {
    return String(val[0] || fallback).trim() || fallback;
  }
  if (typeof val === "string") {
    return val.trim() || fallback;
  }
  return fallback;
}

function parseDurationSeconds(raw: string | number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number.parseFloat(trimmed);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
  }
  const parts = trimmed.split(":").map((p) => Number.parseFloat(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  if (parts.length === 2) {
    return Math.round(parts[0] * 60 + parts[1]);
  }
  if (parts.length === 3) {
    return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  return 0;
}

function canBrowserPlayFlac(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const audio = document.createElement("audio");
    return Boolean(audio.canPlayType("audio/flac") || audio.canPlayType("audio/x-flac"));
  } catch {
    return true;
  }
}

const NON_AUDIO_FILE_PATTERN =
  /\.(xml|sqlite|torrent|jpg|jpeg|png|gif|webp|txt|json|afpk|cue|log|md5|ffp|st5|pdf|zip|gz|tar|html|css|js)$/i;

interface ScoredIAFile {
  file: IAFileEntry;
  score: number;
  codec: string;
  mimeType: string;
  bitrate?: number;
  isLossless: boolean;
}

function scoreAndClassifyIAFile(file: IAFileEntry, flacSupported: boolean): ScoredIAFile | null {
  const name = String(file.name || "").trim();
  if (!name || NON_AUDIO_FILE_PATTERN.test(name)) return null;
  if (file.private === true || file.private === "true") return null;

  const ext = name.split(".").pop()?.toLowerCase() || "";
  const format = String(file.format || "").toLowerCase();

  if (
    format.includes("metadata") ||
    format.includes("spectrogram") ||
    format.includes("peaks") ||
    format.includes("png") ||
    format.includes("jpeg") ||
    format.includes("Columbia") ||
    name.endsWith("_meta.xml") ||
    name.endsWith("_files.xml")
  ) {
    return null;
  }

  let rawBitrate =
    typeof file.bitrate === "number"
      ? file.bitrate
      : typeof file.bitrate === "string"
        ? Number.parseFloat(file.bitrate)
        : undefined;
  if (rawBitrate !== undefined && (!Number.isFinite(rawBitrate) || rawBitrate <= 0)) {
    rawBitrate = undefined;
  }
  if (rawBitrate && rawBitrate > 4000) {
    rawBitrate = Math.round(rawBitrate / 1000);
  }
  if (!rawBitrate) {
    const matchKbps = format.match(/(\d{2,3})\s*kbps/i);
    if (matchKbps) rawBitrate = Number.parseInt(matchKbps[1], 10);
  }

  if ((ext === "flac" || format.includes("flac")) && flacSupported) {
    return {
      file,
      score: 100 + (file.source === "original" ? 5 : 0),
      codec: "FLAC",
      mimeType: "audio/flac",
      bitrate: rawBitrate,
      isLossless: true,
    };
  }

  if (ext === "wav" || ext === "wave" || format.includes("wave") || format === "wav") {
    return {
      file,
      score: 92 + (file.source === "original" ? 4 : 0),
      codec: "WAV",
      mimeType: "audio/wav",
      bitrate: rawBitrate,
      isLossless: true,
    };
  }

  if (ext === "alac" || ext === "aiff" || ext === "aif" || format.includes("apple lossless") || format.includes("aiff")) {
    return {
      file,
      score: 88,
      codec: ext.toUpperCase() || "ALAC",
      mimeType: ext === "alac" ? "audio/mp4" : "audio/aiff",
      bitrate: rawBitrate,
      isLossless: true,
    };
  }

  if (ext === "mp3" || format.includes("mp3")) {
    const brBoost = rawBitrate ? Math.min(35, Math.round(rawBitrate / 10)) : format.includes("vbr") ? 20 : 12;
    return {
      file,
      score: 50 + brBoost,
      codec: "MP3",
      mimeType: "audio/mpeg",
      bitrate: rawBitrate,
      isLossless: false,
    };
  }

  if (ext === "m4a" || ext === "aac" || format.includes("aac") || format.includes("mpeg-4 audio")) {
    return {
      file,
      score: 48 + (rawBitrate ? Math.min(30, Math.round(rawBitrate / 10)) : 14),
      codec: "AAC",
      mimeType: "audio/mp4",
      bitrate: rawBitrate,
      isLossless: false,
    };
  }

  if (ext === "ogg" || ext === "oga" || ext === "opus" || format.includes("ogg") || format.includes("vorbis") || format.includes("opus")) {
    const isOpus = ext === "opus" || format.includes("opus");
    return {
      file,
      score: 45 + (rawBitrate ? Math.min(28, Math.round(rawBitrate / 10)) : 12),
      codec: isOpus ? "Opus" : "Vorbis",
      mimeType: "audio/ogg",
      bitrate: rawBitrate,
      isLossless: false,
    };
  }

  return null;
}

function buildSafeArchiveFileUrl(identifier: string, fileName: string): string {
  const cleanId = encodeURIComponent(identifier.trim());
  const encodedPath = fileName
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${IA_DOWNLOAD_BASE}/${cleanId}/${encodedPath}`;
}

const NON_MUSIC_ARCHIVE_PATTERN =
  /\b(session|studio\s*session|interview|death\s*tape|jonestown|rigveda|rig\s*veda|veda|sermon|lecture|podcast|audiobook|spoken\s*word|speech|broadcast|radio\s*show|field\s*recording|test\s*tone|sound\s*effect|sample\s*pack|prelinger|librivox|fbi\s*no|tape\s*\d+)\b/i;

async function resolveOfficialCoverArt(title: string, artist: string): Promise<string> {
  const q = `${title} ${artist !== "Unknown Artist" ? artist : ""}`.trim();
  if (!q) return "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2400);
  try {
    const res = await fetch(
      `/__void_api/itunes-search?term=${encodeURIComponent(q)}&entity=song&limit=4`,
      { signal: ctrl.signal }
    );
    if (res.ok) {
      const json: any = await res.json();
      const item = Array.isArray(json?.results) ? json.results.find((r: any) => r?.artworkUrl100) : null;
      if (item?.artworkUrl100) {
        return String(item.artworkUrl100).replace("100x100bb", "600x600bb");
      }
    }
  } catch {
    /* ignore */
  } finally {
    clearTimeout(timer);
  }
  return "";
}

async function resolveArchiveItem(
  doc: IASearchDoc,
  flacSupported: boolean,
  externalSignal?: AbortSignal
): Promise<SearchResult | null> {
  const identifier = String(doc.identifier || "").trim();
  if (!identifier) return null;

  const rawDocTitle = firstString(doc.title, "");
  const rawDocCreator = firstString(doc.creator, "");
  if (NON_MUSIC_ARCHIVE_PATTERN.test(`${identifier} ${rawDocTitle} ${rawDocCreator}`)) {
    return null;
  }

  if (metadataCache.has(identifier)) {
    return metadataCache.get(identifier) ?? null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IA_METADATA_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(`${IA_METADATA_BASE}/${encodeURIComponent(identifier)}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      metadataCache.set(identifier, null);
      return null;
    }

    const meta: IAMetadataResponse = await response.json();
    if (
      meta.is_dark ||
      meta.metadata?.["access-restricted-item"] === "true" ||
      meta.metadata?.["access-restricted-item"] === true ||
      !Array.isArray(meta.files)
    ) {
      metadataCache.set(identifier, null);
      return null;
    }

    const scoredCandidates = meta.files
      .map((file) => scoreAndClassifyIAFile(file, flacSupported))
      .filter((item): item is ScoredIAFile => item !== null)
      .sort((a, b) => b.score - a.score);

    if (scoredCandidates.length === 0) {
      metadataCache.set(identifier, null);
      return null;
    }

    const best = scoredCandidates[0];
    const selectedFile = best.file;
    const downloadUrl = buildSafeArchiveFileUrl(identifier, String(selectedFile.name));
    const fallbackUrls = scoredCandidates
      .slice(1, 3)
      .map((cand) => buildSafeArchiveFileUrl(identifier, String(cand.file.name)))
      .filter((u) => u !== downloadUrl);

    const itemTitle =
      String(selectedFile.title || "").trim() ||
      firstString(meta.metadata?.title ?? doc.title, identifier);
    const itemArtist =
      String(selectedFile.artist || selectedFile.creator || "").trim() ||
      firstString(meta.metadata?.creator ?? doc.creator, "Unknown Artist");
    const itemAlbum =
      String(selectedFile.album || "").trim() ||
      firstString(meta.metadata?.title ?? doc.title, "Internet Archive");

    if (NON_MUSIC_ARCHIVE_PATTERN.test(`${itemTitle} ${itemArtist} ${itemAlbum}`)) {
      metadataCache.set(identifier, null);
      return null;
    }

    const duration = parseDurationSeconds(selectedFile.length);
    if (duration > 0 && (duration < 60 || duration > 960)) {
      metadataCache.set(identifier, null);
      return null;
    }
    const formatString = String(selectedFile.format || best.codec).trim();

    const qualityBadge = detectTrackQuality(downloadUrl, formatString, best.bitrate, {
      codecHint: best.codec,
      mimeTypeHint: best.mimeType,
      providerVerified: best.isLossless || Boolean(best.bitrate),
    });

    // Never return Archive.org's black-and-white waveform thumbnail (`archive.org/services/img/...`);
    // resolve official Apple Music 600x600 artwork instead.
    const officialCover = await resolveOfficialCoverArt(itemTitle, itemArtist);

    const result: SearchResult = {
      id: `ia:${identifier}`,
      name: itemTitle,
      album: itemAlbum,
      artist: itemArtist,
      image: officialCover,
      downloadUrl,
      duration,
      source: "Internet Archive",
      qualityBadge,
      bitrate: best.bitrate,
      codec: best.codec,
      mimeType: best.mimeType,
      format: formatString,
      qualityVerified: best.isLossless || Boolean(best.bitrate),
      fallbackUrls,
    };

    metadataCache.set(identifier, result);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

export async function searchInternetArchive(
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IA_SEARCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const cleanWords = cleanQuery
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => {
        if (w.toLowerCase() === "sadeness") return "(sadeness OR sadness)";
        if (w.toLowerCase() === "sadness") return "(sadness OR sadeness)";
        return w;
      });
    if (cleanWords.length === 0) return [];
    const luceneQuery = `mediatype:(audio) AND (${cleanWords.join(" AND ")}) AND NOT collection:(librivoxaudio) AND NOT collection:(podcasts)`;
    const params = new URLSearchParams();
    params.set("q", luceneQuery);
    params.append("fl[]", "identifier");
    params.append("fl[]", "title");
    params.append("fl[]", "creator");
    params.append("fl[]", "downloads");
    params.append("fl[]", "mediatype");
    params.append("sort[]", "downloads desc");
    params.set("rows", String(IA_MAX_ITEMS));
    params.set("page", "1");
    params.set("output", "json");

    const response = await fetch(`${IA_SEARCH_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Internet Archive search HTTP ${response.status}`);
    }

    const payload = await response.json();
    const docs: IASearchDoc[] = Array.isArray(payload?.response?.docs)
      ? payload.response.docs
      : [];

    if (docs.length === 0) return [];

    const flacSupported = canBrowserPlayFlac();
    const settled = await Promise.allSettled(
      docs
        .filter((d) => d?.identifier && (!d.mediatype || d.mediatype === "audio" || d.mediatype === "etree"))
        .slice(0, IA_MAX_ITEMS)
        .map((doc) => resolveArchiveItem(doc, flacSupported, controller.signal))
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<SearchResult | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((item): item is SearchResult => item !== null && Boolean(item.downloadUrl));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}
