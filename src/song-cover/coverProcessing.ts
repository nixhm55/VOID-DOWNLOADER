/**
 * Song-cover selection, persistence, YouTube thumbnail detection and scaling copied from
 * src/api/arabicTrendingCatalog.ts. Arabic/trending catalog logic is intentionally omitted.
 */
import { cleanCanonicalTrackTitle } from '../api/quality';

const STICKY_COVER_STORAGE_KEY = "void-sticky-covers-v9";

function loadJsonMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveJsonMap(key: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* ignore quota errors */
  }
}

export function isValidCoverUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url.trim()) return false;
  const clean = url.trim();
  if (
    clean.includes("fbcdn.net") ||
    clean.includes("archive.org/services/img/") ||
    clean.startsWith("blob:")
  ) {
    return false;
  }
  return /^https?:\/\//i.test(clean) || clean.startsWith("data:image/");
}

const stickyCoverMemoryMap = new Map<string, string>();

export const stickyCoverListeners = new Set<() => void>();

const pendingCoverResolutions = new Map<string, Promise<string>>();

const loadedCoverUrls = new Set<string>();

const preloadedCoverUrls = new Set<string>();

let stickyCoversHydrated = false;

function hydrateStickyCovers(): void {
  if (stickyCoversHydrated || typeof localStorage === "undefined") return;
  stickyCoversHydrated = true;
  const saved = loadJsonMap(STICKY_COVER_STORAGE_KEY);
  let dirty = false;
  for (const [k, v] of Object.entries(saved)) {
    if (isValidCoverUrl(v)) {
      stickyCoverMemoryMap.set(k, v);
    } else {
      dirty = true;
    }
  }
  
  
  if (dirty) {
    persistStickyCoversDeferred();
  }
}

function normalizeTrackKey(track: any): string[] {
  if (!track) return [];
  const keys = new Set<string>();
  const rawId = String(track.id ?? "").trim();
  if (rawId) {
    keys.add(rawId);
    const cleanId = rawId
      .replace(/^download:/i, "")
      .replace(/^api-(?:youtube-|yt-|jiosaavn-|jamendo-|online-)?/i, "")
      .replace(/^yt:/i, "")
      .trim();
    if (cleanId) {
      keys.add(cleanId);
      keys.add(`api-${cleanId}`);
      keys.add(`download:${cleanId}`);
    }
  }
  const rawTitle = String(track.title || track.name || "").trim();
  const rawArtist = String(track.artist || "").trim();
  const lowerTitle = rawTitle.toLowerCase();
  const lowerArtist = rawArtist.toLowerCase();
  if (lowerTitle && lowerArtist) {
    keys.add(`meta:${lowerTitle}|${lowerArtist}`);
  }
  const cleanTitle = cleanCanonicalTrackTitle(rawTitle).toLowerCase();
  const artistParts = rawArtist
    .split(/\s*[·|,;&/]\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const latinArtist =
    artistParts.find((p) => /[a-z]/.test(p) && !/[\u0600-\u06FF\u0900-\u0D7F]/.test(p)) ||
    artistParts[0] ||
    lowerArtist;
  if (cleanTitle && latinArtist) {
    keys.add(`meta:${cleanTitle}|${latinArtist}`);
  }
  if (cleanTitle) {
    keys.add(`title:${cleanTitle}`);
  }
  return Array.from(keys);
}

export function preloadCoverImage(url: string): void {
  if (!isValidCoverUrl(url) || url.startsWith("blob:") || preloadedCoverUrls.has(url)) return;
  if (typeof Image === "undefined") return;
  preloadedCoverUrls.add(url);
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    loadedCoverUrls.add(url);
  };
  img.src = url;
}

export function shouldPreloadCoverImages(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return !window.matchMedia("(max-width: 820px)").matches;
  } catch {
    return window.innerWidth > 820;
  }
}

export function isMobileCatalogViewport(): boolean {
  return !shouldPreloadCoverImages();
}

export function isCoverUrlLoaded(url?: string | null): boolean {
  if (!url) return false;
  return loadedCoverUrls.has(url);
}

export function markCoverUrlLoaded(url?: string | null): void {
  if (url && isValidCoverUrl(url)) {
    loadedCoverUrls.add(url);
  }
}

const coverScaleCache = new Map<string, number>();

const pendingYoutubeScaleProbes = new Map<string, Promise<number>>();

export function isYouTubeCoverOrTrack(
  track?: any,
  url?: string | null,
  img?: HTMLImageElement | null
): boolean {
  const cleanUrl = String(url || track?.image || "").trim();

  // 1. Official 1:1 album cover CDNs (JioSaavn, Apple Music, Deezer, Spotify, Tidal, Wikimedia) are NEVER YouTube
  if (
    /(?:saavncdn\.com|jiosaavn\.com|mzstatic\.com|dzcdn\.net|scdn\.co|tidal\.com|wikimedia\.org|archive\.org|itunes\.apple\.com)/i.test(
      cleanUrl
    )
  ) {
    return false;
  }

  // 2. Explicit YouTube thumbnail domains
  if (/(?:ytimg\.com|youtube\.com|youtu\.be|ggpht\.com)/i.test(cleanUrl)) {
    return true;
  }

  // 3. Explicit non-YouTube track provider labels (e.g. JioSaavn, Lossless Source, Apple Music, Deezer)
  const srcLabel = String(track?.source || "").trim();
  if (
    srcLabel &&
    /(?:jiosaavn|lossless|apple|itunes|deezer|spotify|tidal)/i.test(srcLabel) &&
    !/youtube/i.test(srcLabel)
  ) {
    return false;
  }

  // 4. Explicit YouTube track metadata (including offline downloaded YouTube tracks with blob: covers)
  if (
    /youtube/i.test(srcLabel) ||
    Boolean(track?.exactYtBlob) ||
    /youtube/i.test(String(track?.format || "")) ||
    /(?:ytimg\.com|youtube\.com)/i.test(String(track?.image || "")) ||
    /^(?:yt-stream:\/\/|\/__void_api\/yt-audio)/i.test(
      String(track?.audioUrl || track?.downloadUrl || track?.src || "")
    ) ||
    /^(?:download:|api-)?yt:/i.test(String(track?.id || ""))
  ) {
    return true;
  }

  // 5. Fallback for local/downloaded blob covers where source metadata was omitted:
  // JioSaavn/iTunes/Deezer covers are always 1:1 square (500x500 or 600x600),
  // whereas YouTube thumbnails are landscape (4:3 = 480x360/640x480 or 16:9 = 1280x720/320x180).
  if (
    cleanUrl.startsWith("blob:") &&
    img &&
    img.naturalWidth > 0 &&
    img.naturalHeight > 0
  ) {
    const ratio = img.naturalWidth / img.naturalHeight;
    if (ratio >= 1.24 && ratio <= 1.85) {
      return true;
    }
  }

  return false;
}

export function getCachedCoverScale(url?: string | null, track?: any): number {
  if (!url) return 1;
  if (!isYouTubeCoverOrTrack(track, url, null)) return 1;
  const cached = coverScaleCache.get(url);
  if (cached !== undefined) return cached;
  if (
    /(?:ytimg\.com|youtube\.com)\/vi(?:_webp)?\/[^/]+\/(?:hqdefault|sddefault|0|default)\./i.test(
      url
    )
  ) {
    return 1.35;
  }
  return 1;
}

function inspectYouTubeImageCanvas(img: HTMLImageElement, urlKey: string): number | null {
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (w <= 0 || h <= 0) return null;

  const ratio = w / h;
  let scale = 1;

  // 4:3 YouTube thumbnails (480x360 hqdefault / 640x480 sddefault) always have 12.5% top & bottom letterbox bars
  if (
    /(?:ytimg\.com|youtube\.com)\/vi(?:_webp)?\/[^/]+\/(?:hqdefault|sddefault|0|default)\./i.test(
      urlKey
    ) ||
    (ratio >= 1.25 && ratio <= 1.45 && w !== h)
  ) {
    scale = 1.35;
  }

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return scale;

  // Draw the center square (matching CSS object-fit: cover inside a 1:1 container)
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const isUniformOrDarkRow = (y: number, xStart: number, xEnd: number): boolean => {
    const span = xEnd - xStart + 1;
    if (span <= 4) return false;
    let darkCount = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let x = xStart; x <= xEnd; x++) {
      const i = (y * size + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) < 30) darkCount++;
      sumR += r;
      sumG += g;
      sumB += b;
    }
    if (darkCount >= span * 0.85) return true;
    const meanR = sumR / span;
    const meanG = sumG / span;
    const meanB = sumB / span;
    let mad = 0;
    for (let x = xStart; x <= xEnd; x++) {
      const i = (y * size + x) * 4;
      mad +=
        Math.abs(data[i] - meanR) +
        Math.abs(data[i + 1] - meanG) +
        Math.abs(data[i + 2] - meanB);
    }
    return mad / (span * 3) < 6.5;
  };

  const isUniformOrDarkCol = (x: number, yStart: number, yEnd: number): boolean => {
    const span = yEnd - yStart + 1;
    if (span <= 4) return false;
    let darkCount = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let y = yStart; y <= yEnd; y++) {
      const i = (y * size + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) < 30) darkCount++;
      sumR += r;
      sumG += g;
      sumB += b;
    }
    if (darkCount >= span * 0.85) return true;
    const meanR = sumR / span;
    const meanG = sumG / span;
    const meanB = sumB / span;
    let mad = 0;
    for (let y = yStart; y <= yEnd; y++) {
      const i = (y * size + x) * 4;
      mad +=
        Math.abs(data[i] - meanR) +
        Math.abs(data[i + 1] - meanG) +
        Math.abs(data[i + 2] - meanB);
    }
    return mad / (span * 3) < 6.5;
  };

  const maxScan = Math.floor(size * 0.28); // up to 18px out of 64px on each side

  let topBars = 0;
  while (topBars < maxScan && isUniformOrDarkRow(topBars, 6, size - 7)) {
    topBars++;
  }
  let bottomBars = 0;
  while (bottomBars < maxScan && isUniformOrDarkRow(size - 1 - bottomBars, 6, size - 7)) {
    bottomBars++;
  }

  // Require symmetric top & bottom bars so dark artwork on only one side is not over-cropped
  const vBar =
    topBars >= 2 && bottomBars >= 2
      ? Math.abs(topBars - bottomBars) <= 4
        ? Math.max(topBars, bottomBars)
        : Math.min(topBars, bottomBars) + 2
      : 0;

  // Scan left & right pillarbox gaps inside the active vertical region (excluding top/bottom letterbox bars)
  const activeYStart = Math.max(4, topBars + 1);
  const activeYEnd = Math.min(size - 5, size - 1 - bottomBars - 1);

  let leftBars = 0;
  while (leftBars < maxScan && isUniformOrDarkCol(leftBars, activeYStart, activeYEnd)) {
    leftBars++;
  }
  let rightBars = 0;
  while (
    rightBars < maxScan &&
    isUniformOrDarkCol(size - 1 - rightBars, activeYStart, activeYEnd)
  ) {
    rightBars++;
  }

  const hBar =
    leftBars >= 2 && rightBars >= 2
      ? Math.abs(leftBars - rightBars) <= 4
        ? Math.max(leftBars, rightBars)
        : Math.min(leftBars, rightBars) + 2
      : 0;

  const maxBar = Math.max(vBar, hBar);
  if (maxBar >= 2) {
    const barFraction = maxBar / size;
    const needed = 1 / Math.max(0.52, 1 - 2 * barFraction) + 0.02;
    scale = Math.max(scale, Math.min(1.72, Number(needed.toFixed(3))));
  }

  return scale;
}

function probeYouTubeCoverScaleViaProxy(
  url: string,
  onAsyncUpdate?: (scale: number) => void
): void {
  if (!url || !/^https?:\/\//i.test(url)) return;
  const existing = pendingYoutubeScaleProbes.get(url);
  if (existing) {
    if (onAsyncUpdate) {
      void existing.then((s) => onAsyncUpdate(s));
    }
    return;
  }

  const promise = new Promise<number>((resolve) => {
    const probeImg = new Image();
    probeImg.crossOrigin = "anonymous";
    probeImg.decoding = "async";
    probeImg.onload = () => {
      try {
        const computed = inspectYouTubeImageCanvas(probeImg, url) ?? 1;
        coverScaleCache.set(url, computed);
        resolve(computed);
      } catch {
        const fallback = getCachedCoverScale(url, { source: "YouTube", image: url });
        coverScaleCache.set(url, fallback);
        resolve(fallback);
      }
    };
    probeImg.onerror = () => {
      const fallback = getCachedCoverScale(url, { source: "YouTube", image: url });
      resolve(fallback);
    };
    probeImg.src = `/__void_api/proxy?url=${encodeURIComponent(url)}`;
  });

  pendingYoutubeScaleProbes.set(url, promise);
  if (onAsyncUpdate) {
    void promise.then((s) => onAsyncUpdate(s));
  }
}

export function computeAutoFitCoverScale(
  img: HTMLImageElement | null,
  url?: string | null,
  track?: any,
  onAsyncUpdate?: (scale: number) => void
): number {
  const key = String(url || img?.src || "").trim();

  // Strictly only detect & adjust YouTube covers; all JioSaavn / standard album covers stay at 1
  if (!isYouTubeCoverOrTrack(track, key, img)) {
    return 1;
  }

  if (key && coverScaleCache.has(key)) {
    return coverScaleCache.get(key)!;
  }

  if (!img) return getCachedCoverScale(key, track);

  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (w <= 0 || h <= 0) return getCachedCoverScale(key, track);

  const ratio = w / h;
  const initialScale =
    /(?:ytimg\.com|youtube\.com)\/vi(?:_webp)?\/[^/]+\/(?:hqdefault|sddefault|0|default)\./i.test(
      key
    ) ||
    (ratio >= 1.25 && ratio <= 1.45 && w !== h)
      ? 1.35
      : 1;

  if (key) {
    coverScaleCache.set(key, initialScale);
    if (/^https?:\/\//i.test(key)) {
      probeYouTubeCoverScaleViaProxy(key, onAsyncUpdate);
    }
  }
  return initialScale;
}

let saveStickyTimer: number | undefined;

function persistStickyCoversDeferred(): void {
  if (typeof window === "undefined") return;
  window.clearTimeout(saveStickyTimer);
  saveStickyTimer = window.setTimeout(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of stickyCoverMemoryMap.entries()) {
      if (isValidCoverUrl(v) && !v.startsWith("blob:")) {
        obj[k] = v;
      }
    }
    saveJsonMap(STICKY_COVER_STORAGE_KEY, obj);
  }, 400);
}

export function rememberStickyCover(
  track: any,
  explicitUrl?: string,
  preload = shouldPreloadCoverImages(),
  notifyListeners = true
): void {
  hydrateStickyCovers();
  const url = explicitUrl || track?.remoteImage || track?.image;
  if (!isValidCoverUrl(url)) return;
  const cleanUrl = url.trim();
  const keys = normalizeTrackKey(track);
  let changed = false;
  for (const key of keys) {
    if (stickyCoverMemoryMap.get(key) !== cleanUrl) {
      stickyCoverMemoryMap.set(key, cleanUrl);
      changed = true;
    }
  }
  if (preload) preloadCoverImage(cleanUrl);
  if (changed) {
    persistStickyCoversDeferred();
    if (notifyListeners) stickyCoverListeners.forEach((fn) => fn());
  }
}

export function getStickyCoverUrl(track: any): string {
  if (!track) return "";
  hydrateStickyCovers();
  const directCandidate = track.remoteImage || track.image;
  if (isValidCoverUrl(directCandidate)) {
    rememberStickyCover(track, directCandidate, false, false);
    return directCandidate.trim();
  }
  const keys = normalizeTrackKey(track);
  for (const key of keys) {
    const found = stickyCoverMemoryMap.get(key);
    if (found && isValidCoverUrl(found)) {
      return found;
    }
  }
  return "";
}

export async function resolveAndLockTrackCover(track: any): Promise<string> {
  if (!track) return "";
  const existing = getStickyCoverUrl(track);
  if (existing) return existing;

  const rawTitle = String(track.title || track.name || "").trim();
  const rawArtist = String(track.artist || "").trim();
  const rawAlbum = String(track.album || "").trim();
  const cleanTitle = cleanCanonicalTrackTitle(rawTitle);
  const artistParts = rawArtist
    .split(/\s*[·|,;&/]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const primaryArtist =
    artistParts.find((p) => /[A-Za-z]/.test(p) && !/[\u0600-\u06FF\u0900-\u0D7F]/.test(p)) ||
    artistParts[0] ||
    rawArtist;

  const probeKey = `${cleanTitle.toLowerCase()}|${primaryArtist.toLowerCase()}`;
  if (!cleanTitle) return "";

  const inflight = pendingCoverResolutions.get(probeKey);
  if (inflight) return inflight;

  const promise = (async (): Promise<string> => {
    try {
      const queries = Array.from(
        new Set(
          [
            primaryArtist ? `${cleanTitle} ${primaryArtist}`.trim() : "",
            rawAlbum && !/unknown/i.test(rawAlbum) ? `${cleanTitle} ${rawAlbum}`.trim() : "",
            cleanTitle,
          ].filter((q) => q.length >= 2)
        )
      );

      // 1. Query JioSaavn 500x500 official album art
      for (const q of queries) {
        try {
          const res = await fetch(
            `https://elitejiosaavn-api.vercel.app/api/search/songs?query=${encodeURIComponent(q)}&page=1&limit=6`
          );
          if (res.ok) {
            const json: any = await res.json();
            const songs: any[] = Array.isArray(json?.data?.results)
              ? json.data.results
              : Array.isArray(json?.results)
                ? json.results
                : [];
            for (const song of songs) {
              const images: any[] = Array.isArray(song?.image) ? song.image : [];
              const hiRes =
                images.find((img: any) => img?.quality === "500x500") || images[images.length - 1];
              const imgUrl = String(hiRes?.url || hiRes?.link || song?.image || "").trim();
              if (isValidCoverUrl(imgUrl)) {
                rememberStickyCover(track, imgUrl);
                return imgUrl;
              }
            }
          }
        } catch {}
      }

      // 2. Query iTunes 600x600 official album art via local proxy
      for (const q of queries) {
        try {
          const res = await fetch(
            `/__void_api/itunes-search?term=${encodeURIComponent(q)}&country=us&entity=song&limit=5`
          );
          if (res.ok) {
            const json: any = await res.json();
            const results: any[] = Array.isArray(json?.results) ? json.results : [];
            for (const item of results) {
              const rawArt = String(item?.artworkUrl100 || "").trim();
              if (rawArt) {
                const hiRes = rawArt.replace("100x100bb", "600x600bb");
                if (isValidCoverUrl(hiRes)) {
                  rememberStickyCover(track, hiRes);
                  return hiRes;
                }
              }
            }
          }
        } catch {}
      }
    } finally {
      pendingCoverResolutions.delete(probeKey);
    }
    return "";
  })();

  pendingCoverResolutions.set(probeKey, promise);
  return promise;
}
