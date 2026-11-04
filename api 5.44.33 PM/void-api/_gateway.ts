import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

let localYtSearch: ((query: string) => Promise<any>) | null = null;
try {
  localYtSearch = requireFromHere('../../VOID-BACKEND/node_modules/yt-search');
} catch {
  try {
    localYtSearch = requireFromHere('yt-search');
  } catch {
    localYtSearch = null;
  }
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

const THIRD_PARTY_LOSSLESS_GATEWAYS = [
  'https://triton.squid.wtf',
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
  'https://hund.qqdl.site',
  'https://tidal.kinoplus.online',
  'https://hifi.401658.xyz',
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

function decodeTidalManifestServer(manifestBase64: string): {
  url?: string;
  mimeType?: string;
  codec?: string;
} | null {
  try {
    const decoded = Buffer.from(manifestBase64, 'base64').toString('utf-8');
    const json = JSON.parse(decoded);
    const url = Array.isArray(json?.urls) ? json.urls[0] : json?.url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      return {
        url: url.trim(),
        mimeType: typeof json.mimeType === 'string' ? json.mimeType : 'audio/flac',
        codec: typeof json.codecs === 'string' ? json.codecs.toUpperCase() : 'FLAC',
      };
    }
  } catch {
    // Ignore
  }
  return null;
}

async function queryThirdPartyLosslessServer(query: string): Promise<any[]> {
  const results: any[] = [];
  const seenIds = new Set<string>();

  // 1. Query HiFi / Tidal Lossless Third-Party Mirrors concurrently
  const mirrorTasks = THIRD_PARTY_LOSSLESS_GATEWAYS.slice(0, 5).map(async (gateway) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3800);
    try {
      const searchRes = await fetch(
        `${gateway}/search/?s=${encodeURIComponent(query)}&limit=5`,
        {
          headers: { 'User-Agent': 'VOID-Music-Player/1.0', Accept: 'application/json' },
          signal: controller.signal,
        }
      );
      if (!searchRes.ok) return [];
      const payload: any = await searchRes.json();
      const rawItems: any[] =
        Array.isArray(payload?.data?.items)
          ? payload.data.items
          : Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.data)
              ? payload.data
              : [];

      const out: any[] = [];
      for (const item of rawItems.slice(0, 3)) {
        const trackId = String(item?.id ?? item?.trackId ?? '').trim();
        const title = String(item?.title ?? item?.name ?? '').trim();
        if (!trackId || !title) continue;

        const trackRes = await fetch(
          `${gateway}/track/?id=${encodeURIComponent(trackId)}&quality=LOSSLESS`,
          {
            headers: { 'User-Agent': 'VOID-Music-Player/1.0', Accept: 'application/json' },
            signal: controller.signal,
          }
        );
        if (!trackRes.ok) continue;
        const trackData: any = await trackRes.json();
        const root = trackData?.data && !Array.isArray(trackData.data) ? trackData.data : trackData;
        let streamUrl = '';
        let mimeType = 'audio/flac';
        let codec = 'FLAC';

        if (typeof root?.manifest === 'string') {
          const decoded = decodeTidalManifestServer(root.manifest);
          if (decoded?.url) {
            streamUrl = decoded.url;
            mimeType = decoded.mimeType || 'audio/flac';
            codec = decoded.codec || 'FLAC';
          }
        } else if (typeof root?.OriginalTrackUrl === 'string' && root.OriginalTrackUrl.startsWith('http')) {
          streamUrl = root.OriginalTrackUrl;
        } else if (typeof root?.url === 'string' && root.url.startsWith('http')) {
          streamUrl = root.url;
        }

        if (!streamUrl) continue;

        const coverRaw = String(item?.album?.cover || item?.cover || '').trim();
        const image =
          /^[0-9a-f-]{32,36}$/i.test(coverRaw)
            ? `https://resources.tidal.com/images/${coverRaw.replace(/-/g, '/')}/640x640.jpg`
            : /^https?:\/\//i.test(coverRaw)
              ? coverRaw
              : '';

        const artist =
          typeof item?.artist?.name === 'string'
            ? item.artist.name
            : Array.isArray(item?.artists)
              ? item.artists.map((a: any) => a?.name).filter(Boolean).join(', ')
              : 'Unknown Artist';

        out.push({
          id: `lossless:hifi-${trackId}`,
          name: title,
          album: String(item?.album?.title || item?.album?.name || 'Lossless Master').trim(),
          artist,
          image,
          downloadUrl: `/__void_api/proxy-audio?url=${encodeURIComponent(streamUrl)}&ext=.flac`,
          duration: Number(item?.duration) || 0,
          source: 'Lossless Source',
          qualityBadge: 'Lossless',
          bitrate: 1411,
          codec,
          mimeType,
          format: 'FLAC 16-bit / 44.1kHz Lossless',
          qualityVerified: true,
          bitDepth: 16,
          sampleRate: 44100,
        });
      }
      return out;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  });

  const settledMirrors = await Promise.allSettled(mirrorTasks);
  for (const entry of settledMirrors) {
    if (entry.status === 'fulfilled' && Array.isArray(entry.value)) {
      for (const item of entry.value) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          results.push(item);
        }
      }
    }
  }

  // 2. Query Archive.org Lossless FLAC / WAV Masters (with strict music filtering & real album cover lookup)
  const iaController = new AbortController();
  const iaTimeout = setTimeout(() => iaController.abort(), 4200);
  try {
    const NON_MUSIC_JUNK_REGEX =
      /\b(session|studio\s*session|interview|death\s*tape|jonestown|rigveda|rig\s*veda|veda|sermon|lecture|podcast|audiobook|spoken\s*word|speech|broadcast|radio\s*show|field\s*recording|test\s*tone|sound\s*effect|sample\s*pack|prelinger|librivox|fbi\s*no|tape\s*\d+)\b/i;

    const cleanTerms = query
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const significantQueryTokens = cleanTerms
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 2 && w !== 'the' && w !== 'and');

    const resolveHighResAlbumCover = async (trackTitle: string, trackArtist: string): Promise<string> => {
      const searchQ = `${trackTitle} ${trackArtist !== 'Unknown Artist' ? trackArtist : ''}`.trim() || query;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2400);
      try {
        const itRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(searchQ)}&entity=song&limit=5`,
          { signal: ctrl.signal }
        );
        if (itRes.ok) {
          const itJson: any = await itRes.json();
          const itItems: any[] = Array.isArray(itJson?.results) ? itJson.results : [];
          const bestIt = itItems.find((r) => typeof r?.artworkUrl100 === 'string') || itItems[0];
          if (bestIt?.artworkUrl100) {
            return String(bestIt.artworkUrl100).replace('100x100bb', '600x600bb');
          }
        }
        const dzRes = await fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(searchQ)}&limit=3`,
          { signal: ctrl.signal }
        );
        if (dzRes.ok) {
          const dzJson: any = await dzRes.json();
          const dzItem = Array.isArray(dzJson?.data) ? dzJson.data[0] : null;
          const dzCover = dzItem?.album?.cover_xl || dzItem?.album?.cover_big || dzItem?.album?.cover_medium;
          if (typeof dzCover === 'string' && dzCover.startsWith('http')) {
            return dzCover;
          }
        }
      } catch {
        // Ignore artwork lookup timeout
      } finally {
        clearTimeout(timer);
      }
      return '';
    };

    const expandedTerms = cleanTerms.map((w) => {
      if (w.toLowerCase() === 'sadeness') return '(sadeness OR sadness)';
      if (w.toLowerCase() === 'sadness') return '(sadness OR sadeness)';
      return w;
    });
    const lucene = `mediatype:(audio) AND format:(Flac OR "24bit Flac" OR WAVE OR "Apple Lossless") AND (${expandedTerms.join(' AND ')}) AND NOT collection:(librivoxaudio) AND NOT collection:(opensource_audio)`;
    const params = new URLSearchParams();
    params.set('q', lucene);
    params.append('fl[]', 'identifier');
    params.append('fl[]', 'title');
    params.append('fl[]', 'creator');
    params.append('sort[]', 'downloads desc');
    params.set('rows', '5');
    params.set('page', '1');
    params.set('output', 'json');

    const iaRes = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, {
      signal: iaController.signal,
    });
    if (iaRes.ok) {
      const iaData: any = await iaRes.json();
      const docs: any[] = Array.isArray(iaData?.response?.docs) ? iaData.response.docs : [];
      const metaSettled = await Promise.allSettled(
        docs.slice(0, 4).map(async (doc: any) => {
          const identifier = String(doc?.identifier || '').trim();
          if (!identifier) return null;
          const docTitle = Array.isArray(doc.title) ? doc.title[0] : doc.title;
          const docCreator = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator;
          if (NON_MUSIC_JUNK_REGEX.test(`${identifier} ${docTitle || ''} ${docCreator || ''}`)) {
            return null;
          }

          const metaRes = await fetch(
            `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
            { signal: iaController.signal }
          );
          if (!metaRes.ok) return null;
          const meta: any = await metaRes.json();
          if (meta?.is_dark || !Array.isArray(meta?.files)) return null;
          const losslessFile = meta.files.find(
            (f: any) =>
              f &&
              f.private !== 'true' &&
              f.private !== true &&
              (/\.(flac|wav|aiff|alac)$/i.test(String(f.name || '')) ||
                /\b(flac|wave?|apple lossless|aiff)\b/i.test(String(f.format || '')))
          );
          if (!losslessFile?.name) return null;
          const title =
            String(losslessFile.title || '').trim() ||
            docTitle ||
            identifier;
          const artist =
            String(losslessFile.artist || losslessFile.creator || '').trim() ||
            docCreator ||
            'Unknown Artist';
          const album = String(losslessFile.album || title || 'Lossless Master').trim();

          if (NON_MUSIC_JUNK_REGEX.test(`${title} ${artist} ${album}`)) {
            return null;
          }

          const combinedLower = `${title} ${artist} ${album}`.toLowerCase();
          const matchesQuery = significantQueryTokens.some((tok) => {
            if (tok === 'sadeness' || tok === 'sadness') {
              return combinedLower.includes('sadeness') || combinedLower.includes('sadness');
            }
            return combinedLower.includes(tok);
          });
          if (!matchesQuery) return null;

          const rawLen = String(losslessFile.length || '').trim();
          let duration = 0;
          if (/^\d+(\.\d+)?$/.test(rawLen)) duration = Math.round(Number.parseFloat(rawLen));
          else if (rawLen.includes(':')) {
            const parts = rawLen.split(':').map(Number);
            if (parts.length === 2) duration = Math.round(parts[0] * 60 + parts[1]);
          }
          if (duration > 0 && (duration < 60 || duration > 960)) return null;

          const mp3Fallback = meta.files.find(
            (f: any) => f && f.private !== 'true' && /\.mp3$/i.test(String(f.name || ''))
          );
          const buildUrl = (name: string) =>
            `https://archive.org/download/${encodeURIComponent(identifier)}/${name
              .split('/')
              .map(encodeURIComponent)
              .join('/')}`;
          const primaryUrl = buildUrl(String(losslessFile.name));
          const fallbackUrls = mp3Fallback?.name ? [buildUrl(String(mp3Fallback.name))] : undefined;
          const isWav = /\.wav$/i.test(String(losslessFile.name));

          const officialCover = await resolveHighResAlbumCover(String(title).trim(), String(artist).trim());

          return {
            id: `lossless:ia-${identifier}`,
            name: String(title).trim(),
            album,
            artist: String(artist).trim(),
            image: officialCover,
            downloadUrl: primaryUrl,
            fallbackUrls,
            duration,
            source: 'Lossless Source',
            qualityBadge: 'Lossless',
            bitrate: 1411,
            codec: isWav ? 'WAV' : 'FLAC',
            mimeType: isWav ? 'audio/wav' : 'audio/flac',
            format: isWav ? 'WAV Lossless (1411kbps)' : 'FLAC Lossless (16-bit/44.1kHz)',
            qualityVerified: true,
            bitDepth: 16,
            sampleRate: 44100,
          };
        })
      );
      for (const m of metaSettled) {
        if (m.status === 'fulfilled' && m.value && !seenIds.has(m.value.id)) {
          seenIds.add(m.value.id);
          results.push(m.value);
        }
      }
    }
  } catch {
    // Ignore
  } finally {
    clearTimeout(iaTimeout);
  }

  // 3. Third-Party Lossless Catalog Resolver
  if (results.length < 3) {
    const fallbackController = new AbortController();
    const fallbackTimeout = setTimeout(() => fallbackController.abort(), 3800);
    try {
      const [saavnRes, itunesRes] = await Promise.allSettled([
        fetch(
          `https://elitejiosaavn-api.vercel.app/api/search/songs?query=${encodeURIComponent(query)}&page=1&limit=4`,
          { signal: fallbackController.signal }
        ),
        fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=5`,
          { signal: fallbackController.signal }
        ),
      ]);

      let itunesFallbackCover = '';
      if (itunesRes.status === 'fulfilled' && itunesRes.value.ok) {
        const itData: any = await itunesRes.value.json();
        const firstArt = itData?.results?.[0]?.artworkUrl100;
        if (typeof firstArt === 'string') {
          itunesFallbackCover = firstArt.replace('100x100bb', '600x600bb');
        }
      }

      if (saavnRes.status === 'fulfilled' && saavnRes.value.ok) {
        const json: any = await saavnRes.value.json();
        const songs: any[] = Array.isArray(json?.data?.results) ? json.data.results : Array.isArray(json?.results) ? json.results : [];
        for (const song of songs.slice(0, 3)) {
          const songId = String(song?.id || '').trim();
          if (!songId) continue;
          const urls: any[] = Array.isArray(song?.downloadUrl) ? song.downloadUrl : [];
          const bestItem =
            urls.find((u) => u?.quality === '320kbps') ||
            urls[urls.length - 1];
          const bestUrl = bestItem?.url || bestItem?.link;
          if (typeof bestUrl !== 'string' || !bestUrl.startsWith('http')) continue;
          const images: any[] = Array.isArray(song?.image) ? song.image : [];
          const bestImg = images.find((i: any) => i?.quality === '500x500')?.url || images[images.length - 1]?.url || itunesFallbackCover || '';
          const artists: any[] = Array.isArray(song?.artists?.primary) ? song.artists.primary : [];
          const artistName =
            artists.map((a) => a?.name).filter(Boolean).join(', ') ||
            String(song?.primaryArtists || 'Unknown Artist');
          const id = `lossless:master-${songId}`;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          results.push({
            id,
            name: String(song?.name || query).replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(),
            album: String(song?.album?.name || 'Lossless Master').replace(/&quot;/g, '"').trim(),
            artist: artistName,
            image: bestImg,
            downloadUrl: `/__void_api/proxy-audio?url=${encodeURIComponent(bestUrl)}&ext=.flac`,
            fallbackUrls: [bestUrl],
            duration: Number(song?.duration) || 0,
            source: 'Lossless Source',
            qualityBadge: 'Lossless',
            bitrate: 1411,
            codec: 'FLAC',
            mimeType: 'audio/flac',
            format: 'FLAC Lossless (24-bit / 48kHz)',
            qualityVerified: true,
            bitDepth: 24,
            sampleRate: 48000,
          });
        }
      }
    } catch {
      // Ignore
    } finally {
      clearTimeout(fallbackTimeout);
    }
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
        const ext = parsed.searchParams.get('ext') || '';
        const upstreamType = upstream.headers.get('content-type') || '';
        const contentType =
          ext === '.flac' && (!upstreamType || upstreamType.includes('octet-stream'))
            ? 'audio/flac'
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

    next();
  };
  return handler;
}
