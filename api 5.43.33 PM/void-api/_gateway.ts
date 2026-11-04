import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

let localYtSearch: ((query: string) => Promise<any>) | null = null;
let voidBackendProviders: any = null;
let voidBackendArtwork: any = null;
try {
  localYtSearch = requireFromHere('../../VOID-BACKEND/node_modules/yt-search');
} catch {
  try {
    localYtSearch = requireFromHere('yt-search');
  } catch {
    localYtSearch = null;
  }
}
try {
  voidBackendProviders = requireFromHere('../../VOID-BACKEND/lib/providers.js');
  voidBackendArtwork = requireFromHere('../../VOID-BACKEND/lib/artworkAndMetadata.js');
} catch {
  voidBackendProviders = null;
  voidBackendArtwork = null;
}

interface CachedYtStream {
  url: string;
  mimeType: string;
  codec: string;
  bitrate: number;
  duration: number;
  contentLength?: number;
  userAgent?: string;
  directPlayable?: boolean;
  expiresAt: number;
}

const ytStreamCache = new Map<string, CachedYtStream>();
let cachedVisitorData = '';
let cachedVisitorDataExpiresAt = 0;

async function getYouTubeVisitorData(): Promise<string> {
  if (cachedVisitorData && cachedVisitorDataExpiresAt > Date.now()) {
    return cachedVisitorData;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch('https://www.youtube.com/sw.js_data', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/"(Cgt[a-zA-Z0-9_-]{8,})"/);
      if (match?.[1]) {
        cachedVisitorData = match[1];
        cachedVisitorDataExpiresAt = Date.now() + 30 * 60 * 1000;
        return cachedVisitorData;
      }
    }
  } catch {
    // Ignore
  } finally {
    clearTimeout(timeout);
  }
  return '';
}

async function verifyStreamUrlReachable(url: string, userAgent?: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent || 'VOID-Music-Player/1.0',
        Range: 'bytes=0-1',
      },
      signal: controller.signal,
    });
    if (res.body) {
      void res.body.cancel().catch(() => {});
    }
    return res.ok || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const INNERTUBE_CLIENTS = [
  {
    name: '28',
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.62.27',
        androidSdkVersion: 32,
        osName: 'Android',
        osVersion: '12L',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        userAgent:
          'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
        hl: 'en',
        gl: 'US',
      },
    },
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  },
  {
    name: '5',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '20.10.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.3.2.22D82',
        hl: 'en',
        gl: 'US',
      },
    },
    userAgent:
      'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  },
  {
    name: '85',
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'en',
        gl: 'US',
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com/',
      },
    },
    userAgent:
      'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
  },
  {
    name: '30',
    context: {
      client: {
        clientName: 'ANDROID_TESTSUITE',
        clientVersion: '1.9',
        androidSdkVersion: 34,
        hl: 'en',
        gl: 'US',
      },
    },
    userAgent: 'com.google.android.youtube/1.9 (Linux; U; Android 14) gzip',
  },
];

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
];


async function tryInnerTubeVideoId(videoId: string): Promise<CachedYtStream | null> {
  const visitorData = await getYouTubeVisitorData();

  const tasks = INNERTUBE_CLIENTS.map(async (clientProfile): Promise<CachedYtStream | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2400);
    try {
      const contextPayload = {
        ...clientProfile.context,
        client: {
          ...clientProfile.context.client,
          ...(visitorData ? { visitorData } : {}),
        },
      };

      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': clientProfile.userAgent,
          'X-YouTube-Client-Name': clientProfile.name,
          ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
        },
        body: JSON.stringify({
          videoId,
          context: contextPayload,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) return null;
      const data: any = await res.json();
      const formats: any[] = [
        ...(Array.isArray(data?.streamingData?.adaptiveFormats) ? data.streamingData.adaptiveFormats : []),
        ...(Array.isArray(data?.streamingData?.formats) ? data.streamingData.formats : []),
      ];

      const audioFormats = formats
        .filter((f: any) => typeof f?.url === 'string' && typeof f?.mimeType === 'string' && f.mimeType.startsWith('audio/'))
        .sort((a: any, b: any) => {
          const aMp4 = String(a.mimeType).includes('mp4') ? 1 : 0;
          const bMp4 = String(b.mimeType).includes('mp4') ? 1 : 0;
          if (aMp4 !== bMp4) return bMp4 - aMp4;
          return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
        });

      if (audioFormats.length > 0) {
        const best = audioFormats[0];
        const candidateUrl = String(best.url);
        const reachable = await verifyStreamUrlReachable(candidateUrl, clientProfile.userAgent);
        if (!reachable) return null;

        const rawBitrate = Number(best.averageBitrate || best.bitrate || 160000);
        const kbps = Math.max(128, Math.round(rawBitrate / 1000));
        const rawMime = String(best.mimeType || 'audio/mp4').split(';')[0].trim();
        const codec =
          rawMime.includes('webm') || String(best.mimeType).includes('opus')
            ? 'Opus'
            : 'AAC';
        const duration =
          Number(data?.videoDetails?.lengthSeconds) ||
          Math.round(Number(best.approxDurationMs || 0) / 1000) ||
          0;
        const contentLength = Number(best.contentLength) || undefined;

        return {
          url: candidateUrl,
          mimeType: rawMime,
          codec,
          bitrate: kbps,
          duration,
          contentLength,
          userAgent: clientProfile.userAgent,
          directPlayable: false,
          expiresAt: Date.now() + 30 * 60 * 1000,
        };
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });

  const settled = await Promise.allSettled(tasks);
  for (const item of settled) {
    if (item.status === 'fulfilled' && item.value) {
      return item.value;
    }
  }
  return null;
}

async function tryPipedAndInvidiousServer(videoId: string): Promise<CachedYtStream | null> {
  const tasks: Promise<CachedYtStream | null>[] = [
    ...PIPED_INSTANCES.map(async (base): Promise<CachedYtStream | null> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2200);
      try {
        const res = await fetch(`${base}/streams/${encodeURIComponent(videoId)}`, {
          headers: { 'User-Agent': 'VOID-Music-Player/1.0' },
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data: any = await res.json();
        const streams: any[] = Array.isArray(data?.audioStreams) ? data.audioStreams : [];
        const valid = streams
          .filter((s) => typeof s?.url === 'string' && s.url.startsWith('http'))
          .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
        if (!valid.length) return null;
        const best = valid[0];
        const candidateUrl = String(best.url);
        if (!(await verifyStreamUrlReachable(candidateUrl))) return null;
        const rawBr = Number(best.bitrate || 160000);
        const kbps = rawBr > 1000 ? Math.round(rawBr / 1000) : Math.max(128, rawBr);
        const mimeType = String(best.mimeType || 'audio/mp4').split(';')[0].trim();
        return {
          url: candidateUrl,
          mimeType,
          codec: mimeType.includes('webm') ? 'Opus' : 'AAC',
          bitrate: kbps,
          duration: Number(data?.duration) || 0,
          directPlayable: false,
          expiresAt: Date.now() + 25 * 60 * 1000,
        };
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }),
    ...INVIDIOUS_INSTANCES.map(async (base): Promise<CachedYtStream | null> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2200);
      try {
        const res = await fetch(`${base}/api/v1/videos/${encodeURIComponent(videoId)}`, {
          headers: { 'User-Agent': 'VOID-Music-Player/1.0' },
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data: any = await res.json();
        const formats: any[] = Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : [];
        const valid = formats
          .filter((f) => typeof f?.url === 'string' && String(f?.type || '').startsWith('audio/'))
          .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
        if (!valid.length) return null;
        const best = valid[0];
        const candidateUrl = String(best.url);
        if (!(await verifyStreamUrlReachable(candidateUrl))) return null;
        const rawBr = Number(best.bitrate || 160000);
        const kbps = rawBr > 1000 ? Math.round(rawBr / 1000) : Math.max(128, rawBr);
        const mimeType = String(best.type || 'audio/mp4').split(';')[0].trim();
        return {
          url: candidateUrl,
          mimeType,
          codec: mimeType.includes('webm') ? 'Opus' : 'AAC',
          bitrate: kbps,
          duration: Number(data?.lengthSeconds) || 0,
          directPlayable: false,
          expiresAt: Date.now() + 25 * 60 * 1000,
        };
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }),
  ];

  const settled = await Promise.allSettled(tasks);
  for (const item of settled) {
    if (item.status === 'fulfilled' && item.value) {
      return item.value;
    }
  }
  return null;
}

async function resolveCatalogAudioFallbackServer(
  videoId: string,
  titleHint?: string,
  artistHint?: string
): Promise<CachedYtStream | null> {
  try {
    let rawTitle = (titleHint || '').trim();
    let rawArtist = (artistHint || '').trim();

    if (!rawTitle) {
      const oeCtrl = new AbortController();
      const oeTimer = setTimeout(() => oeCtrl.abort(), 1800);
      try {
        const oeRes = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
          { signal: oeCtrl.signal }
        );
        if (oeRes.ok) {
          const oeData: any = await oeRes.json();
          rawTitle = String(oeData?.title || '').trim();
          if (!rawArtist) rawArtist = String(oeData?.author_name || '').trim();
        }
      } catch {
        // Ignore
      } finally {
        clearTimeout(oeTimer);
      }
    }

    const collapseSpacedLetters = (input: string) =>
      input.replace(/\b([a-zA-Z])(?:\s+([a-zA-Z])){2,}\b/g, (m) => m.replace(/\s+/g, ''));

    const normalizedTitle = collapseSpacedLetters(rawTitle);
    const strippedTitle = normalizedTitle
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(
        /\b(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|hd|4k)|lyric\s*video|lyrics?|full\s*(?:song|video|audio|version)|video\s*song|audio\s*song|hd|4k|hq|remastered|mv|ost|bgm|whatsapp\s*status|status)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();

    // Split titles like "Artist - Song Title | Movie" or "Movie | Song Title | Artist"
    const segments = strippedTitle
      .split(/\s*(?:\||[-–—:])\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);

    const cleanArtist = collapseSpacedLetters(rawArtist)
      .replace(
        /\b(?:official|vevo|topic|music|records|channel|factory|studios|entertainment|series|india|south|malayalam|tamil|hindi|audio|films|media|network)\b/gi,
        ' '
      )
      .replace(/[-–—|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const primarySegment = segments[0] || strippedTitle;
    const secondarySegment = segments.length > 1 ? segments[1] : '';

    const candidateQueries = Array.from(
      new Set(
        [
          strippedTitle.replace(/[|–—-]+/g, ' ').replace(/\s+/g, ' ').trim(),
          secondarySegment ? `${primarySegment} ${secondarySegment}`.trim() : '',
          primarySegment,
          secondarySegment,
          cleanArtist && primarySegment ? `${primarySegment} ${cleanArtist}`.trim() : '',
          normalizedTitle.replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim(),
        ].filter((q) => q && q.length >= 2)
      )
    ).slice(0, 4);

    if (candidateQueries.length === 0) return null;

    // Query JioSaavn and Audius concurrently for the top candidate queries
    const jioPromises = candidateQueries.slice(0, 3).map(async (q): Promise<CachedYtStream | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2600);
      try {
        const jioRes = await fetch(
          `https://elitejiosaavn-api.vercel.app/api/search/songs?query=${encodeURIComponent(q)}&page=1&limit=8`,
          { signal: ctrl.signal }
        );
        if (!jioRes.ok) return null;
        const jioJson: any = await jioRes.json();
        const songs: any[] = Array.isArray(jioJson?.data?.results)
          ? jioJson.data.results
          : Array.isArray(jioJson?.results)
            ? jioJson.results
            : [];

        for (const song of songs) {
          const urls: any[] = Array.isArray(song?.downloadUrl) ? song.downloadUrl : [];
          // Prefer 160kbps or 320kbps stream
          const best =
            urls.find((u: any) => u?.quality === '320kbps') ||
            urls.find((u: any) => u?.quality === '160kbps') ||
            urls[urls.length - 1];
          const streamUrl = String(best?.url || best?.link || '').trim();
          if (streamUrl.startsWith('http')) {
            return {
              url: streamUrl,
              mimeType: 'audio/mp4',
              codec: 'AAC',
              bitrate: best?.quality === '160kbps' ? 160 : 320,
              duration: Number(song?.duration) || 0,
              directPlayable: true,
              expiresAt: Date.now() + 30 * 60 * 1000,
            };
          }
        }
        return null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    });

    const audiusPromise = (async (): Promise<CachedYtStream | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2600);
      try {
        const q = candidateQueries[0];
        const res = await fetch(
          `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=VOID_MUSIC_PLAYER`,
          { signal: ctrl.signal }
        );
        if (!res.ok) return null;
        const json: any = await res.json();
        const item = Array.isArray(json?.data)
          ? json.data.find((t: any) => t?.id && t?.is_streamable !== false)
          : null;
        if (!item?.id) return null;
        return {
          url: `https://api.audius.co/v1/tracks/${encodeURIComponent(String(item.id))}/stream?app_name=VOID_MUSIC_PLAYER`,
          mimeType: 'audio/mpeg',
          codec: 'MP3',
          bitrate: 320,
          duration: Number(item.duration) || 0,
          directPlayable: true,
          expiresAt: Date.now() + 30 * 60 * 1000,
        };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })();

    const settledJio = await Promise.allSettled(jioPromises);
    for (const s of settledJio) {
      if (s.status === 'fulfilled' && s.value) {
        return s.value;
      }
    }

    const audiusRes = await audiusPromise;
    if (audiusRes) return audiusRes;
  } catch {
    // Ignore
  }
  return null;
}

async function resolveYouTubeDirectStreamServer(
  videoId: string,
  titleHint?: string,
  artistHint?: string
): Promise<CachedYtStream | null> {
  const existing = ytStreamCache.get(videoId);
  if (existing && existing.expiresAt > Date.now()) {
    return existing;
  }

  // Run direct YouTube extraction and catalog fallback concurrently so total latency is < 2.5s
  const [directResult, pipedResult, catalogResult] = await Promise.all([
    tryInnerTubeVideoId(videoId),
    tryPipedAndInvidiousServer(videoId),
    resolveCatalogAudioFallbackServer(videoId, titleHint, artistHint),
  ]);

  const resolved = directResult || pipedResult || catalogResult;
  if (resolved) {
    ytStreamCache.set(videoId, resolved);
    return resolved;
  }

  return null;
}


async function queryThirdPartyLosslessServer(query: string): Promise<any[]> {
  const results: any[] = [];
  const seenIds = new Set<string>();

  const iaController = new AbortController();
  const iaTimeout = setTimeout(() => iaController.abort(), 5200);
  try {
    const NON_MUSIC_JUNK_REGEX =
      /\b(death\s*tape|jonestown|rigveda|rig\s*veda|sermon|lecture|podcast|audiobook|spoken\s*word|radio\s*show|field\s*recording|test\s*tone|sound\s*effect|sample\s*pack|prelinger|librivox|fbi\s*no)\b/i;

    const cleanTerms = query
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const significantQueryTokens = cleanTerms
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 2 && w !== 'the' && w !== 'and');

    // 1. Fetch Apple Music / iTunes catalog metadata in parallel to get high-res artwork & canonical artist/album for song queries
    let appleCatalog: any[] = [];
    try {
      const itCtrl = new AbortController();
      const itTimer = setTimeout(() => itCtrl.abort(), 2400);
      const itRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=8`,
        { signal: itCtrl.signal }
      ).finally(() => clearTimeout(itTimer));
      if (itRes.ok) {
        const itJson: any = await itRes.json();
        if (Array.isArray(itJson?.results)) appleCatalog = itJson.results;
      }
    } catch {
      // Ignore iTunes catalog lookup error
    }

    const expandedTerms = cleanTerms.map((w) => {
      if (w.toLowerCase() === 'sadeness') return '(sadeness OR sadness)';
      if (w.toLowerCase() === 'sadness') return '(sadness OR sadeness)';
      return w;
    });

    const formatClause = 'format:(Flac OR "24bit Flac" OR WAVE OR "Apple Lossless" OR AIFF)';
    const notClause = 'AND NOT collection:(librivoxaudio) AND NOT collection:(podcasts) AND NOT collection:(prelinger)';
    const luceneQueries: string[] = [];
    if (expandedTerms.length > 0) {
      luceneQueries.push(`mediatype:(audio) AND ${formatClause} AND (${expandedTerms.join(' AND ')}) ${notClause}`);
    }
    const primaryApple = appleCatalog[0];
    if (primaryApple?.artistName) {
      const artistClean = String(primaryApple.artistName).replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
      if (artistClean) {
        luceneQueries.push(`mediatype:(audio) AND ${formatClause} AND (${artistClean}) ${notClause}`);
      }
    }

    const docsMap = new Map<string, any>();
    for (const lucene of luceneQueries.slice(0, 2)) {
      if (docsMap.size >= 6) break;
      const params = new URLSearchParams();
      params.set('q', lucene);
      params.append('fl[]', 'identifier');
      params.append('fl[]', 'title');
      params.append('fl[]', 'creator');
      params.append('sort[]', 'downloads desc');
      params.set('rows', '6');
      params.set('page', '1');
      params.set('output', 'json');

      const iaRes = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, {
        signal: iaController.signal,
      });
      if (!iaRes.ok) continue;
      const iaData: any = await iaRes.json();
      const docs: any[] = Array.isArray(iaData?.response?.docs) ? iaData.response.docs : [];
      for (const d of docs) {
        if (d?.identifier && !docsMap.has(String(d.identifier))) {
          docsMap.set(String(d.identifier), d);
        }
      }
      if (docsMap.size >= 3) break;
    }

    const cleanTitleFromFilename = (fileName: string): string => {
      const base = fileName.split('/').pop() || fileName;
      return base
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/^\s*\d{1,3}\s*[-._)\s]\s*/, '')
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const metaSettled = await Promise.allSettled(
      Array.from(docsMap.values()).slice(0, 6).map(async (doc: any) => {
        const identifier = String(doc?.identifier || '').trim();
        if (!identifier) return [];
        const docTitle = Array.isArray(doc.title) ? doc.title[0] : doc.title;
        const docCreator = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator;
        if (NON_MUSIC_JUNK_REGEX.test(`${identifier} ${docTitle || ''} ${docCreator || ''}`)) {
          return [];
        }

        const metaRes = await fetch(
          `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
          { signal: iaController.signal }
        );
        if (!metaRes.ok) return [];
        const meta: any = await metaRes.json();
        if (meta?.is_dark || !Array.isArray(meta?.files)) return [];

        const losslessFiles = meta.files.filter(
          (f: any) =>
            f &&
            f.private !== 'true' &&
            f.private !== true &&
            !/_meta\.xml|_files\.xml|spectrogram|\.png$|\.jpg$/i.test(String(f.name || '')) &&
            (/\.(flac|wav|aiff|alac)$/i.test(String(f.name || '')) ||
              /\b(flac|wave?|apple lossless|aiff)\b/i.test(String(f.format || '')))
        );
        if (losslessFiles.length === 0) return [];

        const scoredFiles = losslessFiles
          .map((f: any) => {
            const rawName = String(f.name || '');
            const fTitle = String(f.title || '').trim() || cleanTitleFromFilename(rawName) || String(docTitle || identifier);
            const fArtist = String(f.artist || f.creator || docCreator || 'Unknown Artist').trim();
            const fAlbum = String(f.album || docTitle || 'Lossless Master').trim();
            const haystack = `${fTitle} ${fArtist} ${fAlbum} ${rawName}`.toLowerCase();
            const titleLower = fTitle.toLowerCase();
            let score = /\.flac$/i.test(rawName) ? 100 : /\.alac$/i.test(rawName) ? 96 : 92;
            for (const tok of significantQueryTokens) {
              if (tok === 'sadeness' || tok === 'sadness') {
                if (titleLower.includes('sadeness') || titleLower.includes('sadness')) score += 50;
                else if (haystack.includes('sadeness') || haystack.includes('sadness')) score += 20;
              } else if (titleLower === tok) score += 60;
              else if (titleLower.includes(tok)) score += 35;
              else if (haystack.includes(tok)) score += 15;
            }
            return { f, fTitle, fArtist, fAlbum, score };
          })
          .sort((a: any, b: any) => b.score - a.score);

        const docOut: any[] = [];
        for (const cand of scoredFiles.slice(0, 3)) {
          const losslessFile = cand.f;
          const title = cand.fTitle;
          const artist = cand.fArtist;
          const album = cand.fAlbum;
          if (NON_MUSIC_JUNK_REGEX.test(`${title} ${artist} ${album}`)) continue;

          const rawLen = String(losslessFile.length || '').trim();
          let duration = 0;
          if (/^\d+(\.\d+)?$/.test(rawLen)) duration = Math.round(Number.parseFloat(rawLen));
          else if (rawLen.includes(':')) {
            const parts = rawLen.split(':').map(Number);
            if (parts.length === 2) duration = Math.round(parts[0] * 60 + parts[1]);
            else if (parts.length === 3) duration = Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
          }
          if (duration > 0 && (duration < 35 || duration > 2400)) continue;

          const fileName = String(losslessFile.name);
          const primaryUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${fileName
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`;
          const fmtLower = String(losslessFile.format || '').toLowerCase();
          const is24Bit = fmtLower.includes('24bit') || fmtLower.includes('24-bit') || /24[-_ ]?bit/i.test(fileName);
          const isWav = /\.wav$/i.test(fileName) || fmtLower.includes('wave');
          const isAlac = /\.alac$/i.test(fileName) || fmtLower.includes('apple lossless');
          const codec = isAlac ? 'ALAC' : isWav ? 'WAV' : 'FLAC';
          const bitDepth = is24Bit ? 24 : 16;
          const sampleRate = is24Bit ? 96000 : 44100;
          const byteSize = Number(losslessFile.size) || 0;
          const calcBr = byteSize > 0 && duration > 10 ? Math.round((byteSize * 8) / 1000 / duration) : 0;
          const bitrate = calcBr >= 400 && calcBr <= 9600 ? calcBr : is24Bit ? 2116 : isWav ? 1411 : 950;

          const matchedIt = appleCatalog.find(
            (it) =>
              String(it?.trackName || '').toLowerCase().includes(title.toLowerCase()) ||
              title.toLowerCase().includes(String(it?.trackName || '').toLowerCase())
          ) || appleCatalog[0];
          const officialCover = matchedIt?.artworkUrl100
            ? String(matchedIt.artworkUrl100).replace('100x100bb', '1200x1200.jpg')
            : '';

          const baseKey = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9_-]+/gi, '_');
          docOut.push({
            id: `lossless:ia-${identifier}-${baseKey}`,
            name: String(title).trim(),
            album,
            artist: String(artist).trim(),
            image: officialCover,
            downloadUrl: primaryUrl,
            duration,
            source: 'Lossless Source',
            qualityBadge: 'Lossless',
            bitrate,
            codec,
            mimeType: isAlac ? 'audio/mp4' : isWav ? 'audio/wav' : 'audio/flac',
            format: `${codec} Lossless (${bitDepth}-bit/${sampleRate / 1000}kHz · ${bitrate}kbps · Internet Archive)`,
            qualityVerified: true,
            bitDepth,
            sampleRate,
          });
        }
        return docOut;
      })
    );
    for (const m of metaSettled) {
      if (m.status === 'fulfilled' && Array.isArray(m.value)) {
        for (const item of m.value) {
          if (item && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            results.push(item);
          }
        }
      }
    }
  } catch {
    // Ignore
  } finally {
    clearTimeout(iaTimeout);
  }

  return results;
}

const NON_AUDIO_BLOCK_REGEX =
  /\b(which\s+exam|exam\s+i\s+should|exam\s+prep|exam\s+strategy|exam\s+date|syllabus|coaching|lecture|lectures|tutorial|tutorials|course|class\s*\d|classes|neet|jee|upsc|ssc|ias|ips|ibps|sbi\s*po|bank\s*exam|ca\s*foundation|gate\s*exam|cat\s*exam|board\s*exam|study\s*tips|how\s+to\s+prepare|mock\s*test|previous\s*year\s*question|mcq|aptitude|reasoning|physics\s*wallah|unacademy|byju|vedantu|xylem|eduport|anil\s*aggarwal|vlog|vlogs|unboxing|review|gameplay|walkthrough|let'?s\s*play|patch\s*notes|breaking\s*news|press\s*conference|debate|podcast\s*ep|recipe|cooking|how\s+to\s+make|workout\s*routine|stock\s*market|trading|crypto)\b/i;

async function performYouTubeSearchServer(q: string): Promise<any[]> {
  const hasAudioIntent =
    /\b(song|songs|music|audio|lyrics|lyrical|ost|bgm|remix|slowed|reverb|lofi|cover|instrumental|album|track|jukeb|quran|qur'an|surah|surat|ayah|ayat|tilawat|recitation|qari|nasheed|naat|madh|mappila|ghazal|qawwali|bhajan|dua|azan|adhan)\b/i.test(
      q
    );
  const searchQuery = hasAudioIntent ? q : `${q} song`;

  // 1. Use VOID-BACKEND's yt-search package when available
  if (localYtSearch) {
    try {
      const r = await Promise.race([
        localYtSearch(searchQuery),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2800)),
      ]);
      const videos: any[] = Array.isArray(r?.videos) ? r.videos : [];
      if (videos.length > 0) {
        const mapped = videos
          .filter((v) => v?.videoId && !NON_AUDIO_BLOCK_REGEX.test(`${v.title || ''} ${v.author?.name || ''}`))
          .slice(0, 15)
          .map((v) => ({
            id: v.videoId,
            videoId: v.videoId,
            title: v.title,
            name: v.title,
            album: 'YouTube',
            artist: v.author?.name || 'YouTube',
            image: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            duration: Number(v.seconds) || 0,
            durationFormatted: v.timestamp || '',
            downloadUrl: `/__void_api/yt-audio?id=${encodeURIComponent(v.videoId)}&title=${encodeURIComponent(v.title || '')}&artist=${encodeURIComponent(v.author?.name || '')}`,
          }));
        if (mapped.length > 0) return mapped;
      }
    } catch {
      // Fall through to InnerTube search
    }
  }

  // 2. Fallback to direct InnerTube WEB search
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3200);
  try {
    const ytRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: searchQuery,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20250101.00.00',
            hl: 'en',
            gl: 'US',
          },
        },
      }),
      signal: controller.signal,
    });
    if (ytRes.ok) {
      const data: any = await ytRes.json();
      const items: any[] = [];
      const walk = (node: any) => {
        if (!node || typeof node !== 'object' || items.length >= 15) return;
        if (node.videoRenderer && typeof node.videoRenderer.videoId === 'string') {
          const v = node.videoRenderer;
          const id = v.videoId;
          const title =
            v.title?.runs?.map((r: any) => r?.text).join('') ||
            v.title?.simpleText ||
            q;
          const artist =
            v.ownerText?.runs?.[0]?.text ||
            v.longBylineText?.runs?.[0]?.text ||
            'YouTube';
          const durationText = v.lengthText?.simpleText || '';
          if (NON_AUDIO_BLOCK_REGEX.test(`${title} ${artist}`)) {
            return;
          }
          items.push({
            id,
            videoId: id,
            title,
            name: title,
            artist,
            durationFormatted: durationText,
            image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            downloadUrl: `/__void_api/yt-audio?id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
          });
          return;
        }
        if (Array.isArray(node)) {
          for (const child of node) walk(child);
        } else {
          for (const key of Object.keys(node)) walk(node[key]);
        }
      };
      walk(data?.contents);
      return items;
    }
  } catch {
    // Ignore
  } finally {
    clearTimeout(timeout);
  }
  return [];
}

export function createVoidGatewayHandler() {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const rawUrl = req.url || '';

    if (!rawUrl.startsWith('/__void_api/')) {
      next();
      return;
    }

    const parsed = new URL(rawUrl, 'http://localhost');

    if (parsed.pathname === '/__void_api/lossless-search') {
      const q = parsed.searchParams.get('q')?.trim() || '';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (!q) {
        res.statusCode = 200;
        res.end('[]');
        return;
      }
      const items = await queryThirdPartyLosslessServer(q);
      res.statusCode = 200;
      res.end(JSON.stringify(items));
      return;
    }

    if (parsed.pathname === '/__void_api/proxy-audio') {
      const targetUrl = parsed.searchParams.get('url')?.trim() || '';
      if (!/^https?:\/\//i.test(targetUrl)) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const wantedCodec = (parsed.searchParams.get('codec') || '').toLowerCase();
      const ext = (parsed.searchParams.get('ext') || '').toLowerCase();

      // If ALAC Lossless (.m4a) is requested, use local FFmpeg to output genuine Apple Lossless (codec_name=alac, 16-bit/44.1kHz)
      if (wantedCodec === 'alac' || ext === '.alac') {
        try {
          const fs = requireFromHere('node:fs');
          const os = requireFromHere('node:os');
          const path = requireFromHere('node:path');
          const { execFileSync } = requireFromHere('node:child_process');
          const ffmpegBin = fs.existsSync('/opt/homebrew/bin/ffmpeg')
            ? '/opt/homebrew/bin/ffmpeg'
            : fs.existsSync('/usr/local/bin/ffmpeg')
              ? '/usr/local/bin/ffmpeg'
              : 'ffmpeg';

          const upRes = await fetch(targetUrl, {
            headers: { 'User-Agent': 'VOID-Music-Player/1.0' },
            redirect: 'follow',
          });
          if (upRes.ok) {
            const rawBytes = Buffer.from(await upRes.arrayBuffer());
            const tmpPrefix = path.join(
              os.tmpdir(),
              `void_alac_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            );
            const inPath = `${tmpPrefix}.in`;
            const outPath = `${tmpPrefix}.m4a`;
            try {
              fs.writeFileSync(inPath, rawBytes);
              execFileSync(
                ffmpegBin,
                [
                  '-y',
                  '-v',
                  'error',
                  '-i',
                  inPath,
                  '-vn',
                  '-c:a',
                  'alac',
                  '-sample_fmt',
                  's16p',
                  '-ar',
                  '44100',
                  '-ac',
                  '2',
                  outPath,
                ],
                { timeout: 15000 },
              );
              const alacBuf = fs.readFileSync(outPath);
              res.statusCode = 200;
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'audio/alac');
              res.setHeader('Content-Length', String(alacBuf.byteLength));
              res.end(alacBuf);
              return;
            } finally {
              try {
                fs.rmSync(inPath, { force: true });
              } catch {}
              try {
                fs.rmSync(outPath, { force: true });
              } catch {}
            }
          }
        } catch {
          // Fall through to standard proxy stream if ffmpeg is unavailable
        }
      }

      try {
        const headers: Record<string, string> = {
          'User-Agent': 'VOID-Music-Player/1.0',
        };
        if (typeof req.headers.range === 'string') {
          headers['Range'] = req.headers.range;
        }
        const upstream = await fetch(targetUrl, { headers, redirect: 'follow' });
        if (!upstream.ok && upstream.status !== 206) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.statusCode = upstream.status;
        res.setHeader('Access-Control-Allow-Origin', '*');
        const lowerTarget = targetUrl.toLowerCase();
        const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
        const contentType =
          ext === '.flac' || /\.flac(\?|$)/i.test(lowerTarget) || upstreamType.includes('flac')
            ? 'audio/flac'
            : ext === '.wav' || /\.wav(\?|$)/i.test(lowerTarget) || upstreamType.includes('wav')
              ? 'audio/wav'
              : ext === '.aiff' || /\.(aiff|aif)(\?|$)/i.test(lowerTarget) || upstreamType.includes('aiff')
                ? 'audio/aiff'
                : /\.mp3(\?|$)/i.test(lowerTarget) || upstreamType.includes('mpeg')
                  ? 'audio/mpeg'
                  : upstreamType.startsWith('audio/') || upstreamType.includes('mp4')
                    ? upstreamType
                    : 'audio/mp4';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        const contentLength = upstream.headers.get('content-length');
        if (contentLength) res.setHeader('Content-Length', contentLength);
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) res.setHeader('Content-Range', contentRange);

        if (!upstream.body) {
          res.end();
          return;
        }
        const reader = upstream.body.getReader();
        req.on('close', () => {
          void reader.cancel().catch(() => {});
        });
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.writableEnded) {
            res.write(Buffer.from(value));
          } else {
            break;
          }
        }
        if (!res.writableEnded) res.end();
      } catch {
        if (!res.headersSent) res.statusCode = 404;
        if (!res.writableEnded) res.end();
      }
      return;
    }

    if (parsed.pathname === '/__void_api/yt-search') {
      const q = parsed.searchParams.get('q')?.trim() || '';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (!q) {
        res.statusCode = 200;
        res.end('[]');
        return;
      }
      const items = await performYouTubeSearchServer(q);
      res.statusCode = 200;
      res.end(JSON.stringify(items));
      return;
    }

    if (parsed.pathname === '/__void_api/yt-info') {
      const id = parsed.searchParams.get('id')?.trim() || '';
      const titleHint = parsed.searchParams.get('title')?.trim() || '';
      const artistHint = parsed.searchParams.get('artist')?.trim() || '';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (!/^[\w-]{11}$/.test(id)) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: false }));
        return;
      }

      const info = await resolveYouTubeDirectStreamServer(id, titleHint, artistHint);
      if (!info) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: false }));
        return;
      }

      const querySuffix = [
        `id=${encodeURIComponent(id)}`,
        titleHint ? `title=${encodeURIComponent(titleHint)}` : '',
        artistHint ? `artist=${encodeURIComponent(artistHint)}` : '',
      ]
        .filter(Boolean)
        .join('&');

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: true,
          id,
          streamUrl: `/__void_api/yt-audio?${querySuffix}`,
          directUrl: info.directPlayable ? info.url : undefined,
          mimeType: info.mimeType,
          codec: info.codec,
          bitrate: info.bitrate,
          duration: info.duration,
        }),
      );
      return;
    }

    if (parsed.pathname === '/__void_api/yt-audio') {
      const id = parsed.searchParams.get('id')?.trim() || '';
      const titleHint = parsed.searchParams.get('title')?.trim() || '';
      const artistHint = parsed.searchParams.get('artist')?.trim() || '';
      if (!/^[\w-]{11}$/.test(id)) {
        res.statusCode = 400;
        res.end();
        return;
      }

      let info = await resolveYouTubeDirectStreamServer(id, titleHint, artistHint);
      if (!info) {
        res.statusCode = 404;
        res.end();
        return;
      }

      try {
        const buildHeaders = (ua?: string): Record<string, string> => {
          const h: Record<string, string> = {
            'User-Agent':
              ua ||
              'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
          };
          if (typeof req.headers.range === 'string') {
            h['Range'] = req.headers.range;
          }
          return h;
        };

        let upstream = await fetch(info.url, {
          headers: buildHeaders(info.userAgent),
          redirect: 'follow',
        });
        if (!upstream.ok && upstream.status !== 206) {
          ytStreamCache.delete(id);
          info = await resolveYouTubeDirectStreamServer(id, titleHint, artistHint);
          if (info) {
            upstream = await fetch(info.url, {
              headers: buildHeaders(info.userAgent),
              redirect: 'follow',
            });
          }
        }

        if (!upstream.ok && upstream.status !== 206) {
          res.statusCode = 404;
          res.end();
          return;
        }

        res.statusCode = upstream.status;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', upstream.headers.get('content-type') || info?.mimeType || 'audio/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        const contentLength = upstream.headers.get('content-length');
        if (contentLength) res.setHeader('Content-Length', contentLength);
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) res.setHeader('Content-Range', contentRange);

        if (!upstream.body) {
          res.end();
          return;
        }

        const reader = upstream.body.getReader();
        req.on('close', () => {
          void reader.cancel().catch(() => {});
        });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.writableEnded) {
            res.write(Buffer.from(value));
          } else {
            break;
          }
        }
        if (!res.writableEnded) res.end();
      } catch {
        if (!res.headersSent) res.statusCode = 502;
        if (!res.writableEnded) res.end();
      }
      return;
    }

    if (parsed.pathname === '/__void_api/proxy') {
      const target = parsed.searchParams.get('url')?.trim() || '';
      if (!/^https?:\/\//i.test(target)) {
        res.statusCode = 400;
        res.end();
        return;
      }
      try {
        const upstream = await fetch(target, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
          redirect: 'follow',
        });
        if (!upstream.ok) {
          res.statusCode = upstream.status || 502;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Access-Control-Allow-Origin', '*');
        const ct = upstream.headers.get('content-type');
        if (ct) res.setHeader('Content-Type', ct);
        const cl = upstream.headers.get('content-length');
        if (cl) res.setHeader('Content-Length', cl);
        if (!upstream.body) {
          res.end();
          return;
        }
        const reader = upstream.body.getReader();
        req.on('close', () => {
          void reader.cancel().catch(() => {});
        });
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.writableEnded) res.write(Buffer.from(value));
          else break;
        }
        if (!res.writableEnded) res.end();
      } catch {
        if (!res.headersSent) res.statusCode = 502;
        if (!res.writableEnded) res.end();
      }
      return;
    }

    if (parsed.pathname === '/__void_api/itunes-search') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const term = parsed.searchParams.get('term')?.trim() || '';
      const country = parsed.searchParams.get('country')?.trim() || 'us';
      const entity = 'song';
      const limit = Math.min(200, Math.max(1, Number(parsed.searchParams.get('limit')) || 25));

      if (!term) {
        res.statusCode = 200;
        res.end(JSON.stringify({ resultCount: 0, results: [] }));
        return;
      }

      const globalObj = globalThis as any;
      if (!globalObj.__voidItunesCache) {
        globalObj.__voidItunesCache = new Map<string, { ts: number; payload: string }>();
      }
      if (!globalObj.__voidItunesInFlight) {
        globalObj.__voidItunesInFlight = new Map<string, Promise<string>>();
      }
      const cache: Map<string, { ts: number; payload: string }> = globalObj.__voidItunesCache;
      const inFlight: Map<string, Promise<string>> = globalObj.__voidItunesInFlight;

      const cacheKey = `${term.toLowerCase()}|${country.toLowerCase()}|${entity.toLowerCase()}|${limit}`;
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.ts < 1000 * 60 * 30) {
        res.statusCode = 200;
        res.end(cached.payload);
        return;
      }

      let task = inFlight.get(cacheKey);
      if (!task) {
        task = (async () => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 3800);
            const itunesRes = await fetch(
              `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&entity=${encodeURIComponent(entity)}&limit=${limit}`,
              {
                signal: ctrl.signal,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                  Accept: 'application/json',
                },
              }
            ).finally(() => clearTimeout(t));

            if (itunesRes.ok) {
              const json = (await itunesRes.json()) as any;
              if (Array.isArray(json?.results) && json.results.length > 0) {
                const payload = JSON.stringify({ resultCount: json.results.length, results: json.results });
                cache.set(cacheKey, { ts: Date.now(), payload });
                return payload;
              }
            }
          } catch {}

          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 3800);
            const dzEndpoint =
              `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=${limit}`;
            const dzRes = await fetch(dzEndpoint, { signal: ctrl.signal }).finally(() => clearTimeout(t));
            if (dzRes.ok) {
              const dzJson = (await dzRes.json()) as any;
              const rows: any[] = Array.isArray(dzJson?.data) ? dzJson.data : [];
              const mapped =
                rows.map((r: any) => {
                  const cover = String(
                    r?.album?.cover_xl || r?.album?.cover_big || r?.album?.cover_medium || r?.artist?.picture_xl || ''
                  ).trim();
                  return {
                    trackId: r?.id,
                    artistName: String(r?.artist?.name || term).trim(),
                    trackName: String(r?.title || r?.title_short || '').trim(),
                    collectionName: String(r?.album?.title || r?.title || '').trim(),
                    artworkUrl100: cover,
                    artworkUrl600: cover,
                    trackTimeMillis: (Number(r?.duration) || 210) * 1000,
                    releaseDate: '2024-01-01T00:00:00Z',
                    previewUrl: String(r?.preview || '').trim(),
                  };
                });
              const payload = JSON.stringify({ resultCount: mapped.length, results: mapped });
              cache.set(cacheKey, { ts: Date.now(), payload });
              return payload;
            }
          } catch {}

          const emptyPayload = JSON.stringify({ resultCount: 0, results: [] });
          cache.set(cacheKey, { ts: Date.now(), payload: emptyPayload });
          return emptyPayload;
        })();
        inFlight.set(cacheKey, task);
      }

      try {
        const resultPayload = await task;
        res.statusCode = 200;
        res.end(resultPayload);
      } catch {
        res.statusCode = 200;
        res.end(JSON.stringify({ resultCount: 0, results: [] }));
      } finally {
        inFlight.delete(cacheKey);
      }
      return;
    }

    if (
      (parsed.pathname === '/__void_api/search' ||
        parsed.pathname === '/__void_api/music-search') &&
      voidBackendProviders?.searchMultiSourceMusic
    ) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const q = (parsed.searchParams.get('q') || parsed.searchParams.get('query') || '').trim();
      const limit = Math.min(
        25,
        Math.max(1, Number.parseInt(parsed.searchParams.get('limit') || '10', 10) || 10)
      );
      const country = (parsed.searchParams.get('country') || 'us').trim() || 'us';
      try {
        const payload = await voidBackendProviders.searchMultiSourceMusic(q, {
          limit,
          country,
          baseUrl: '/__void_api',
        });
        res.statusCode = 200;
        res.end(JSON.stringify(payload));
      } catch {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: false,
            results: { High: [], 'Very High': [], Lossless: [] },
          })
        );
      }
      return;
    }

    if (parsed.pathname === '/__void_api/artwork' && voidBackendArtwork) {
      const rawArtworkUrl = (parsed.searchParams.get('url') || '').trim();
      const source = (parsed.searchParams.get('source') || '').trim();
      const uncroppedUrl = voidBackendArtwork.resolveOriginalUncroppedArtworkUrl(
        rawArtworkUrl,
        source
      );
      if (!uncroppedUrl) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Valid artwork URL is required' }));
        return;
      }
      const cover = await voidBackendArtwork.fetchOriginalCoverBytes(uncroppedUrl, 5000);
      if (!cover?.bytes) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'Failed to retrieve original artwork' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', cover.mimeType || 'image/jpeg');
      res.setHeader('Content-Length', String(cover.bytes.byteLength));
      res.end(Buffer.from(cover.bytes));
      return;
    }

    next();
  };
  return handler;
}
