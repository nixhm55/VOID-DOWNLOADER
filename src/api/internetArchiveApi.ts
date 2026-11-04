/**
 * Provider B: Internet Archive Multi-Tier Audio Search & Metadata Resolution
 * Search endpoint: https://archive.org/advancedsearch.php
 * Metadata endpoint: https://archive.org/metadata/{identifier}
 * Download endpoint: https://archive.org/download/{identifier}/{filename}
 *
 * Automatic Quality Routing:
 * - Native FLAC, 24-bit FLAC, ALAC, PCM WAV, AIFF -> Routed to `OG` (`category: 'OG'`)
 * - 320kbps MP3 / AAC -> Routed to `Very High` (`category: 'Very High'`, never wasted)
 * - Standard/High MP3 / Ogg / AAC (< 280kbps) -> Routed to `High` (`category: 'High'`, never wasted)
 * - Strictly blocks MP3 from ever entering `OG` or `Lossless`.
 */

import { type SearchResult, detectTrackQuality } from "./quality";

const IA_SEARCH_URL = "https://archive.org/advancedsearch.php";
const IA_METADATA_BASE = "https://archive.org/metadata";
const IA_DOWNLOAD_BASE = "https://archive.org/download";

const IA_SEARCH_TIMEOUT_MS = 6500;
const IA_METADATA_TIMEOUT_MS = 5000;
const IA_MAX_DOCS = 8;

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
  track?: string | number;
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

const docMetadataCache = new Map<string, IAMetadataResponse | null>();

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

const NON_AUDIO_FILE_PATTERN =
  /\.(xml|sqlite|torrent|jpg|jpeg|png|gif|webp|txt|json|afpk|cue|log|md5|ffp|st5|pdf|zip|gz|tar|html|css|js|m3u|accurip)$/i;

interface ScoredIAFile {
  file: IAFileEntry;
  score: number;
  codec: "FLAC" | "ALAC" | "WAV" | "AIFF" | "MP3" | "AAC" | "OGG";
  mimeType: string;
  bitrate: number;
  bitDepth?: number;
  sampleRate?: number;
  duration: number;
  isLossless: boolean;
}

function cleanTitleFromFilename(fileName: string): string {
  const base = fileName.split("/").pop() || fileName;
  return base
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/^\s*\d{1,3}\s*[-._)\s]\s*/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreAndClassifyIAFile(
  file: IAFileEntry,
  queryTokens: string[],
  docTitle: string,
  docCreator: string
): ScoredIAFile | null {
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
    format.includes("columbia") ||
    name.endsWith("_meta.xml") ||
    name.endsWith("_files.xml")
  ) {
    return null;
  }

  const is24Bit = format.includes("24bit") || format.includes("24-bit") || /24[-_ ]?bit/i.test(name);
  const isFlac = ext === "flac" || format.includes("flac");
  const isAlac = ext === "alac" || format.includes("apple lossless");
  const isWav = ext === "wav" || ext === "wave" || format.includes("wave") || format === "wav";
  const isAiff = ext === "aiff" || ext === "aif" || format.includes("aiff");
  const isLossless = isFlac || isAlac || isWav || isAiff;

  const isMp3 = !isLossless && (ext === "mp3" || format.includes("mp3") || format.includes("mpeg"));
  const isAac = !isLossless && (ext === "m4a" || ext === "aac" || format.includes("aac"));
  const isOgg = !isLossless && (ext === "ogg" || format.includes("ogg") || format.includes("vorbis"));

  if (!isLossless && !isMp3 && !isAac && !isOgg) {
    return null;
  }

  const duration = parseDurationSeconds(file.length);
  if (duration > 0 && (duration < 35 || duration > 2400)) {
    return null;
  }

  const byteSize = Number(file.size) || 0;
  let calculatedBitrate = 0;
  if (byteSize > 0 && duration > 10) {
    calculatedBitrate = Math.round((byteSize * 8) / 1000 / duration);
  }

  const explicitBitrate = Number.parseInt(String(file.bitrate || ""), 10);

  const trackTitle = String(file.title || "").trim() || cleanTitleFromFilename(name);
  const trackArtist = String(file.artist || file.creator || docCreator || "").trim();
  const trackAlbum = String(file.album || docTitle || "").trim();
  const haystack = `${trackTitle} ${trackArtist} ${trackAlbum} ${name}`.toLowerCase();

  let matchBoost = 0;
  const titleLower = trackTitle.toLowerCase();
  for (const tok of queryTokens) {
    if (tok === "sadeness" || tok === "sadness") {
      if (titleLower.includes("sadeness") || titleLower.includes("sadness")) matchBoost += 45;
      else if (haystack.includes("sadeness") || haystack.includes("sadness")) matchBoost += 20;
    } else if (titleLower === tok) {
      matchBoost += 60;
    } else if (titleLower.includes(tok)) {
      matchBoost += 35;
    } else if (haystack.includes(tok)) {
      matchBoost += 15;
    }
  }

  if (isLossless) {
    const bitDepth = is24Bit ? 24 : 16;
    const sampleRate = is24Bit ? 96000 : 44100;
    const defaultBitrate = is24Bit ? 2116 : isWav || isAiff ? 1411 : 950;
    const bitrate =
      calculatedBitrate >= 400 && calculatedBitrate <= 9600 ? calculatedBitrate : defaultBitrate;

    const codec: "FLAC" | "ALAC" | "WAV" | "AIFF" = isAlac
      ? "ALAC"
      : isWav
        ? "WAV"
        : isAiff
          ? "AIFF"
          : "FLAC";
    const mimeType = isAlac
      ? "audio/mp4"
      : isWav
        ? "audio/wav"
        : isAiff
          ? "audio/aiff"
          : "audio/flac";

    const baseCodecScore = isFlac ? 100 : isAlac ? 96 : isWav ? 92 : 88;
    const originalBoost = file.source === "original" ? 5 : 0;

    return {
      file,
      score: baseCodecScore + originalBoost + matchBoost,
      codec,
      mimeType,
      bitrate,
      bitDepth,
      sampleRate,
      duration,
      isLossless: true,
    };
  }

  // Lossy stream (MP3 / AAC / OGG) — never throw away; classify for High or Very High!
  const lossyBitrate =
    Number.isFinite(explicitBitrate) && explicitBitrate >= 64 && explicitBitrate <= 320
      ? explicitBitrate
      : calculatedBitrate >= 64 && calculatedBitrate <= 320
        ? calculatedBitrate
        : /320/i.test(format) || /320/i.test(name)
          ? 320
          : /vbr/i.test(format)
            ? 240
            : 192;

  const lossyCodec: "MP3" | "AAC" | "OGG" = isAac ? "AAC" : isOgg ? "OGG" : "MP3";
  const lossyMime = isAac ? "audio/mp4" : isOgg ? "audio/ogg" : "audio/mpeg";
  const lossyScore = (lossyBitrate >= 280 ? 75 : 60) + matchBoost;

  return {
    file,
    score: lossyScore,
    codec: lossyCodec,
    mimeType: lossyMime,
    bitrate: lossyBitrate,
    duration,
    isLossless: false,
  };
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
  /\b(death\s*tape|jonestown|rigveda|rig\s*veda|sermon|lecture|podcast|audiobook|spoken\s*word|radio\s*show|field\s*recording|test\s*tone|sound\s*effect|sample\s*pack|prelinger|librivox|fbi\s*no)\b/i;

function extractArchiveCoverUrl(identifier: string, files: IAFileEntry[]): string {
  const coverFile = files.find((f) => {
    const name = String(f?.name || "").trim();
    if (!name || /__ia_thumb|spectrogram|\.png$/i.test(name)) return false;
    const fmt = String(f?.format || "").toLowerCase();
    return (
      /\.(jpg|jpeg)$/i.test(name) &&
      (fmt.includes("item image") ||
        fmt.includes("jpeg") ||
        /\b(cover|front|folder|album|art)\b/i.test(name))
    );
  });
  if (coverFile?.name) {
    return buildSafeArchiveFileUrl(identifier, String(coverFile.name));
  }
  return "";
}

async function resolveArchiveItems(
  doc: IASearchDoc,
  queryTokens: string[],
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const identifier = String(doc.identifier || "").trim();
  if (!identifier) return [];

  const rawDocTitle = firstString(doc.title, "");
  const rawDocCreator = firstString(doc.creator, "");
  if (NON_MUSIC_ARCHIVE_PATTERN.test(`${identifier} ${rawDocTitle} ${rawDocCreator}`)) {
    return [];
  }

  let meta = docMetadataCache.get(identifier);
  if (meta === undefined) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IA_METADATA_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(`${IA_METADATA_BASE}/${encodeURIComponent(identifier)}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        docMetadataCache.set(identifier, null);
        return [];
      }
      meta = (await response.json()) as IAMetadataResponse;
      docMetadataCache.set(identifier, meta);
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  if (
    !meta ||
    meta.is_dark ||
    meta.metadata?.["access-restricted-item"] === "true" ||
    meta.metadata?.["access-restricted-item"] === true ||
    !Array.isArray(meta.files)
  ) {
    return [];
  }

  const docTitle = firstString(meta.metadata?.title ?? doc.title, identifier);
  const docCreator = firstString(meta.metadata?.creator ?? doc.creator, "Unknown Artist");

  const scoredCandidates = meta.files
    .map((file) => scoreAndClassifyIAFile(file, queryTokens, docTitle, docCreator))
    .filter((item): item is ScoredIAFile => item !== null)
    .sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) {
    return [];
  }

  const archiveCover = extractArchiveCoverUrl(identifier, meta.files);
  const out: SearchResult[] = [];
  const seenFileNames = new Set<string>();

  for (const cand of scoredCandidates.slice(0, 4)) {
    const selectedFile = cand.file;
    const rawName = String(selectedFile.name || "").trim();
    const baseKey = rawName.replace(/\.[a-z0-9]{2,5}$/i, "").toLowerCase();
    if (!rawName || seenFileNames.has(baseKey)) continue;
    seenFileNames.add(baseKey);

    const downloadUrl = buildSafeArchiveFileUrl(identifier, rawName);
    const itemTitle =
      String(selectedFile.title || "").trim() ||
      cleanTitleFromFilename(rawName) ||
      docTitle;
    const itemArtist =
      String(selectedFile.artist || selectedFile.creator || "").trim() ||
      docCreator;
    const itemAlbum =
      String(selectedFile.album || "").trim() ||
      docTitle ||
      "Internet Archive";

    if (NON_MUSIC_ARCHIVE_PATTERN.test(`${itemTitle} ${itemArtist} ${itemAlbum}`)) {
      continue;
    }

    if (cand.isLossless) {
      const bitDepth = cand.bitDepth || 16;
      const sampleRate = cand.sampleRate || 44100;
      const khz = sampleRate / 1000;
      const khzText = Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1)} kHz`;
      const ogSpecBadge = `${cand.codec} · ${bitDepth}-bit · ${khzText}`;
      const formatLabel = `${cand.codec} Lossless (${bitDepth}-bit/${khz}kHz · ${cand.bitrate}kbps)`;

      out.push({
        id: `og:ia:${identifier}:${baseKey.replace(/[^a-z0-9_-]+/gi, "_")}`,
        name: itemTitle,
        album: itemAlbum,
        artist: itemArtist,
        image: archiveCover,
        downloadUrl,
        duration: cand.duration,
        source: "Internet Archive",
        category: "OG",
        section: "OG",
        qualityBadge: "Lossless",
        bitrate: cand.bitrate,
        codec: cand.codec,
        mimeType: cand.mimeType,
        format: formatLabel,
        ogSpecBadge,
        ogVerified: true,
        ogPlayable: true,
        ogDownloadAllowed: true,
        qualityVerified: true,
        bitDepth,
        sampleRate,
      });
    } else {
      // Lossy MP3/AAC/OGG track -> Route automatically to 'Very High' (>=280kbps) or 'High' (<280kbps)
      const isVeryHigh = cand.bitrate >= 280;
      const formatLabel = `${cand.codec} (${cand.bitrate}kbps · Internet Archive)`;
      const qualityBadge = detectTrackQuality(downloadUrl, formatLabel, cand.bitrate, {
        codecHint: cand.codec,
        mimeTypeHint: cand.mimeType,
        providerVerified: true,
        sourceHint: "Internet Archive",
      });

      out.push({
        id: `ia:${identifier}:${baseKey.replace(/[^a-z0-9_-]+/gi, "_")}`,
        name: itemTitle,
        album: itemAlbum,
        artist: itemArtist,
        image: archiveCover,
        downloadUrl,
        duration: cand.duration,
        source: "Internet Archive",
        category: isVeryHigh ? "Very High" : "High",
        qualityBadge,
        bitrate: cand.bitrate,
        codec: cand.codec,
        mimeType: cand.mimeType,
        format: formatLabel,
        qualityVerified: true,
      });
    }
  }

  return out;
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
    const rawWords = cleanQuery
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (rawWords.length === 0) return [];

    const queryTokens = rawWords
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 2 && w !== "the" && w !== "and");

    const cleanWords = rawWords.map((w) => {
      if (w.toLowerCase() === "sadeness") return "(sadeness OR sadness)";
      if (w.toLowerCase() === "sadness") return "(sadness OR sadeness)";
      return w;
    });

    const formatClause = `format:(Flac OR "24bit Flac" OR WAVE OR "Apple Lossless" OR AIFF)`;
    const notClause = `AND NOT collection:(librivoxaudio) AND NOT collection:(podcasts) AND NOT collection:(prelinger)`;

    const luceneQueries = [
      `mediatype:(audio) AND ${formatClause} AND (${cleanWords.join(" AND ")}) ${notClause}`,
      ...(cleanWords.length > 1
        ? [`mediatype:(audio) AND ${formatClause} AND (${cleanWords.join(" OR ")}) ${notClause}`]
        : []),
    ];

    const docsMap = new Map<string, IASearchDoc>();

    for (const luceneQuery of luceneQueries) {
      if (controller.signal.aborted || docsMap.size >= IA_MAX_DOCS) break;
      const params = new URLSearchParams();
      params.set("q", luceneQuery);
      params.append("fl[]", "identifier");
      params.append("fl[]", "title");
      params.append("fl[]", "creator");
      params.append("fl[]", "downloads");
      params.append("fl[]", "mediatype");
      params.append("sort[]", "downloads desc");
      params.set("rows", String(IA_MAX_DOCS));
      params.set("page", "1");
      params.set("output", "json");

      const response = await fetch(`${IA_SEARCH_URL}?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok) continue;

      const payload = await response.json();
      const docs: IASearchDoc[] = Array.isArray(payload?.response?.docs)
        ? payload.response.docs
        : [];
      for (const d of docs) {
        if (d?.identifier && !docsMap.has(d.identifier)) {
          docsMap.set(d.identifier, d);
        }
      }
      if (docsMap.size >= 3) break;
    }

    if (docsMap.size === 0) return [];

    const settled = await Promise.allSettled(
      Array.from(docsMap.values())
        .slice(0, IA_MAX_DOCS)
        .map((doc) => resolveArchiveItems(doc, queryTokens, controller.signal))
    );

    const combined: SearchResult[] = [];
    for (const entry of settled) {
      if (entry.status === "fulfilled" && Array.isArray(entry.value)) {
        combined.push(...entry.value);
      }
    }
    return combined;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}
