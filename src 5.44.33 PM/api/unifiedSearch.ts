/**
 * Unified Multi-Provider Music Search Orchestrator for VOID Downloader.
 *
 * Strictly enforces provider priority order:
 * 1. JioSaavn (`searchJioSaavn`) — Always #1 at the very top of search results
 * 2. Jamendo (`searchJamendo`) — #2 below JioSaavn
 * 3. YouTube (`searchYouTube`) — #3 below Jamendo
 * 4. Remaining fallback APIs (`searchThirdPartyLossless`, `searchInternetArchive`, `searchRadioBrowser`)
 */

import { searchJioSaavn } from "./musicApi";
import { searchInternetArchive } from "./internetArchiveApi";
import { searchJamendo } from "./jamendoApi";
import { searchRadioBrowser } from "./radioBrowserApi";
import { searchThirdPartyLossless } from "./losslessGatewayApi";
import { searchYouTube } from "./youtubeApi";
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
  /**
   * Optional callback invoked as providers resolve so JioSaavn renders at the top immediately
   * while secondary providers append below it.
   */
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
  { name: "Third-Party Lossless Gateway", run: searchThirdPartyLossless },
  { name: "Internet Archive", run: searchInternetArchive },
  { name: "Radio Browser", run: searchRadioBrowser },
];

/**
 * Executes concurrent searches across configured providers, ensuring JioSaavn (#1 priority)
 * always appears at the top of the list, followed by Jamendo (#2), YouTube (#3), and other APIs (#4).
 */
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
        // Only emit partial results once JioSaavn (#1 priority) has settled,
        // so non-JioSaavn songs never flash at the top before JioSaavn arrives.
        if (options?.onPartialResults && jioSaavnSettled) {
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
