/**
 * Provider D: Radio Browser Live Station Discovery
 * Endpoints:
 * - https://de1.api.radio-browser.info/json/stations/search
 * - https://fi1.api.radio-browser.info/json/stations/search
 * - https://at1.api.radio-browser.info/json/stations/search
 * - https://all.api.radio-browser.info/json/stations/search
 */

import { type SearchResult, detectTrackQuality } from "./quality";

const RADIO_BROWSER_ENDPOINTS = [
  "https://de1.api.radio-browser.info/json/stations/search",
  "https://fi1.api.radio-browser.info/json/stations/search",
  "https://at1.api.radio-browser.info/json/stations/search",
  "https://all.api.radio-browser.info/json/stations/search",
];
const RADIO_BROWSER_TIMEOUT_MS = 5500;
const RADIO_RESULT_LIMIT = 4;

interface RadioStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  codec?: string;
  bitrate?: number;
  hls?: number;
  lastcheckok?: number;
}

function isValidStreamUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function mapStationsToSearchResults(stations: RadioStation[]): SearchResult[] {
  const results: SearchResult[] = [];
  for (const raw of stations) {
    if (raw.lastcheckok === 0) continue;
    const resolvedUrl = String(raw.url_resolved || raw.url || "").trim();
    if (!isValidStreamUrl(resolvedUrl)) continue;

    const uuid = String(raw.stationuuid || resolvedUrl).trim();
    const name = String(raw.name || "").trim();
    if (!name) continue;

    const codecRaw = String(raw.codec || "").trim().toUpperCase();
    const codec = codecRaw && codecRaw !== "UNKNOWN" ? codecRaw : undefined;
    const bitrate =
      typeof raw.bitrate === "number" && Number.isFinite(raw.bitrate) && raw.bitrate > 0
        ? raw.bitrate
        : undefined;

    const isFlacStream = Boolean(codec && codec.includes("FLAC"));
    const formatHint = isFlacStream
      ? "FLAC Live"
      : bitrate
        ? `Live Radio (${bitrate}kbps ${codec || ""})`.trim()
        : "Live Radio";

    const qualityBadge = detectTrackQuality(resolvedUrl, formatHint, bitrate, {
      codecHint: codec,
      isLive: true,
      providerVerified: Boolean(isFlacStream || bitrate),
    });

    const countryLabel = String(raw.country || raw.countrycode || "").trim();
    const tagSummary = String(raw.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(", ");

    const artistSubtitle =
      [countryLabel, tagSummary].filter(Boolean).join(" · ") || "Live Radio Station";

    results.push({
      id: `radio:${uuid}`,
      name,
      album: "Live Radio",
      artist: artistSubtitle,
      // Use VOID's built-in cover glyph rather than arbitrary third-party HTTP station favicons
      // that frequently time out (`ERR_CONNECTION_TIMED_OUT`) in the browser console.
      image: "",
      downloadUrl: resolvedUrl,
      duration: 0,
      source: "Radio Browser",
      qualityBadge,
      bitrate,
      codec,
      format: codec ? `${codec} Live Stream` : "Live Stream",
      qualityVerified: Boolean(isFlacStream || bitrate),
      isLive: true,
      fallbackUrls:
        raw.url && raw.url !== resolvedUrl && isValidStreamUrl(raw.url)
          ? [raw.url]
          : undefined,
    });
  }
  return results;
}

export async function searchRadioBrowser(
  query: string,
  externalSignal?: AbortSignal
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length < 2) return [];

  for (const endpoint of RADIO_BROWSER_ENDPOINTS) {
    if (externalSignal?.aborted) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RADIO_BROWSER_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      const params = new URLSearchParams({
        name: cleanQuery,
        limit: String(RADIO_RESULT_LIMIT),
        hidebroken: "true",
        order: "clickcount",
        reverse: "true",
      });

      const response = await fetch(`${endpoint}?${params.toString()}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Radio Browser HTTP ${response.status}`);
      }

      const stations: unknown = await response.json();
      let results = Array.isArray(stations)
        ? mapStationsToSearchResults(stations as RadioStation[])
        : [];

      // If no station matches the exact song title by station name (e.g. "sadeness"),
      // try tag/keyword prefix so Radio Browser still provides relevant stations at the bottom.
      if (results.length === 0 && !controller.signal.aborted) {
        const firstWord = cleanQuery.split(/\s+/)[0]?.toLowerCase() || "";
        const fallbackTerm =
          firstWord === "sadeness" || firstWord === "sadness"
            ? "ambient"
            : firstWord.length >= 4
              ? firstWord.slice(0, 4)
              : firstWord;
        if (fallbackTerm) {
          const tagParams = new URLSearchParams({
            tag: fallbackTerm,
            limit: "2",
            hidebroken: "true",
            order: "clickcount",
            reverse: "true",
          });
          const tagRes = await fetch(`${endpoint}?${tagParams.toString()}`, {
            signal: controller.signal,
          });
          if (tagRes.ok) {
            const tagStations: unknown = await tagRes.json();
            if (Array.isArray(tagStations)) {
              results = mapStationsToSearchResults(tagStations as RadioStation[]);
            }
          }
        }
      }

      return results;
    } catch {
      if (externalSignal?.aborted) return [];
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  return [];
}
