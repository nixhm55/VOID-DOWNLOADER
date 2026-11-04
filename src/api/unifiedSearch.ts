/**
 * Unified Multi-Provider Music Search Orchestrator for VOID Downloader.
 *
 * Strictly enforces provider priority order & 4-section category routing:
 * - "High": JioSaavn (#1 priority), Jamendo (#2), YouTube (#3), and remaining open APIs (#4)
 * - "Very High": Spotify (`searchSpotifyTracks`)
 * - "Lossless": Apple Music (`searchAppleMusicTracks`)
 * - "OG": Independent 4-Stage Verified Genuine Lossless (`searchOgSection`)
 */

import { searchJioSaavn } from "./musicApi";
import { searchInternetArchive } from "./internetArchiveApi";
import { searchJamendo } from "./jamendoApi";
import { searchRadioBrowser } from "./radioBrowserApi";
import { searchThirdPartyLossless } from "./losslessGatewayApi";
import { searchYouTube } from "./youtubeApi";
import { searchAppleMusicTracks, searchSpotifyTracks } from "./spotifyAndAppleApi";
import { searchOgSection } from "./ogApi";
import {
  type SearchResult,
  deduplicateAndSortSearchResults,
} from "./quality";

export interface ProviderSearchOutcome {
  provider: string;
  status: "fulfilled" | "rejected";
  count: number;
  error?: string;
}

export interface UnifiedSearchOptions {
  signal?: AbortSignal;
  onPartialResults?: (mergedSoFar: SearchResult[]) => void;
}

interface ProviderDescriptor {
  name: string;
  run: (query: string, signal?: AbortSignal) => Promise<SearchResult[]>;
}

export const PROVIDERS: readonly ProviderDescriptor[] = [
  { name: "JioSaavn", run: searchJioSaavn },
  { name: "Jamendo", run: searchJamendo },
  { name: "YouTube", run: searchYouTube },
  { name: "Spotify", run: searchSpotifyTracks },
  { name: "Apple Music", run: searchAppleMusicTracks },
  { name: "OG Verified Lossless", run: searchOgSection },
  { name: "Third-Party Lossless Gateway", run: searchThirdPartyLossless },
  { name: "Internet Archive", run: searchInternetArchive },
  { name: "Radio Browser", run: searchRadioBrowser },
];

export async function searchAllProviders(
  query: string,
  options?: UnifiedSearchOptions
): Promise<{ results: SearchResult[]; outcomes: ProviderSearchOutcome[] }> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { results: [], outcomes: [] };
  }

  const signal = options?.signal;
  const resultsByProvider: SearchResult[][] = PROVIDERS.map(() => []);
  let jioSaavnSettled = false;

  const getOrderedAccumulated = (): SearchResult[] => {
    const flat: SearchResult[] = [];
    for (let i = 0; i < PROVIDERS.length; i++) {
      if (resultsByProvider[i].length > 0) {
        flat.push(...resultsByProvider[i]);
      }
    }
    return deduplicateAndSortSearchResults(flat, cleanQuery);
  };

  const tasks = PROVIDERS.map(async (provider, providerIdx) => {
    try {
      const items = await provider.run(cleanQuery, signal);
      if (!signal?.aborted && Array.isArray(items) && items.length > 0) {
        resultsByProvider[providerIdx] = items;
        if (providerIdx === 0) {
          jioSaavnSettled = true;
        }
        if (
          options?.onPartialResults &&
          (jioSaavnSettled ||
            providerIdx === 3 ||
            providerIdx === 4 ||
            providerIdx === 5 ||
            providerIdx === 6 ||
            providerIdx === 7)
        ) {
          options.onPartialResults(getOrderedAccumulated());
        }
      } else if (providerIdx === 0) {
        jioSaavnSettled = true;
        if (options?.onPartialResults) {
          const current = getOrderedAccumulated();
          if (current.length > 0) options.onPartialResults(current);
        }
      }
      return { provider: provider.name, items: items || [] };
    } catch (err) {
      if (providerIdx === 0) {
        jioSaavnSettled = true;
        if (options?.onPartialResults) {
          const current = getOrderedAccumulated();
          if (current.length > 0) options.onPartialResults(current);
        }
      }
      throw err;
    }
  });

  const settled = await Promise.allSettled(tasks);

  const outcomes: ProviderSearchOutcome[] = settled.map((entry, idx) => {
    const providerName = PROVIDERS[idx].name;
    if (entry.status === "fulfilled") {
      return {
        provider: providerName,
        status: "fulfilled",
        count: entry.value.items.length,
      };
    }
    return {
      provider: providerName,
      status: "rejected",
      count: 0,
      error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
    };
  });

  if (signal?.aborted) {
    return { results: [], outcomes };
  }

  const finalResults = getOrderedAccumulated();
  return { results: finalResults, outcomes };
}
