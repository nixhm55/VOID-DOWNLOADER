'use strict';

const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const { fetchWithTimeout } = require('./lib/cache');
const {
  resolveOriginalUncroppedArtworkUrl,
  fetchOriginalCoverBytes,
  embedMetadataAndCoverBuffer,
} = require('./lib/artworkAndMetadata');
const { searchMultiSourceMusic } = require('./lib/providers');
const {
  searchOgProviders,
  resolveOgTrack,
  getOgProviderStatusReport,
} = require('./og/services');
const { validateOgStreamUrlSafety } = require('./og/config');

const app = express();
app.use(cors());
app.use(express.json());

const streamCache = new Map();
let cachedVisitorData = '';
let cachedVisitorDataExpiresAt = 0;

function getRequestBaseUrl(req) {
  const host = req.get('host') || `localhost:${process.env.PORT || 4000}`;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol =
    typeof forwardedProto === 'string' && forwardedProto.trim()
      ? forwardedProto.split(',')[0].trim()
      : req.protocol || 'http';
  return `${protocol}://${host}`;
}

function sanitizeFilename(input) {
  return (
    String(input || 'track')
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140) || 'track'
  );
}

async function getYouTubeVisitorData() {
  if (cachedVisitorData && cachedVisitorDataExpiresAt > Date.now()) {
    return cachedVisitorData;
  }
  try {
    const res = await fetchWithTimeout(
      'https://www.youtube.com/sw.js_data',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      },
      1800
    );
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/"(Cgt[a-zA-Z0-9_-]{8,})"/);
      if (match && match[1]) {
        cachedVisitorData = match[1];
        cachedVisitorDataExpiresAt = Date.now() + 30 * 60 * 1000;
        return cachedVisitorData;
      }
    }
  } catch {
    // Ignore
  }
  return '';
}

async function verifyReachable(url, userAgent) {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': userAgent || 'VOID-Music-Player/1.0',
          Range: 'bytes=0-1',
        },
      },
      1800
    );
    if (res.body) {
      res.body.cancel().catch(() => {});
    }
    return res.ok || res.status === 206;
  } catch {
    return false;
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

async function tryInnerTubeStream(videoId) {
  const visitorData = await getYouTubeVisitorData();
  const tasks = INNERTUBE_CLIENTS.map(async (clientProfile) => {
    try {
      const contextPayload = {
        ...clientProfile.context,
        client: {
          ...clientProfile.context.client,
          ...(visitorData ? { visitorData } : {}),
        },
      };
      const res = await fetchWithTimeout(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
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
        },
        2400
      );
      if (!res.ok) return null;
      const data = await res.json();
      const formats = [
        ...(Array.isArray(data?.streamingData?.adaptiveFormats)
          ? data.streamingData.adaptiveFormats
          : []),
        ...(Array.isArray(data?.streamingData?.formats) ? data.streamingData.formats : []),
      ];
      const audioFormats = formats
        .filter(
          (f) =>
            typeof f?.url === 'string' &&
            typeof f?.mimeType === 'string' &&
            f.mimeType.startsWith('audio/')
        )
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
      if (audioFormats.length > 0) {
        const best = audioFormats[0];
        if (await verifyReachable(best.url, clientProfile.userAgent)) {
          return {
            url: best.url,
            mimeType: String(best.mimeType || 'audio/mp4').split(';')[0].trim(),
            userAgent: clientProfile.userAgent,
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  });
  const settled = await Promise.allSettled(tasks);
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) return s.value;
  }
  return null;
}

async function tryPipedStream(videoId) {
  const tasks = PIPED_INSTANCES.map(async (instance) => {
    try {
      const res = await fetchWithTimeout(
        `${instance}/streams/${encodeURIComponent(videoId)}`,
        {},
        2200
      );
      if (!res.ok) return null;
      const data = await res.json();
      const audioStreams = Array.isArray(data?.audioStreams) ? data.audioStreams : [];
      if (audioStreams.length > 0) {
        const best =
          audioStreams.find(
            (s) => s?.mimeType?.includes('mp4') || s?.mimeType?.includes('m4a')
          ) || audioStreams[0];
        if (best?.url && (await verifyReachable(best.url))) {
          return {
            url: best.url,
            mimeType: String(best.mimeType || 'audio/mp4').split(';')[0].trim(),
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  });
  const settled = await Promise.allSettled(tasks);
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) return s.value;
  }
  return null;
}

async function tryCatalogStream(videoId, titleHint) {
  try {
    let rawTitle = String(titleHint || '').trim();
    if (!rawTitle) {
      try {
        const oe = await fetchWithTimeout(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
          {},
          1800
        );
        if (oe.ok) {
          const oeData = await oe.json();
          rawTitle = String(oeData?.title || '').trim();
        }
      } catch {
        // Ignore
      }
    }
    const cleaned = rawTitle
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(
        /\b(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|hd|4k)|lyric\s*video|lyrics?|full\s*(?:song|video|audio|version)|video\s*song|audio\s*song|hd|4k|hq|remastered|mv|ost|bgm)\b/gi,
        ' '
      )
      .replace(/[|–—-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return null;

    const jioRes = await fetchWithTimeout(
      `https://elitejiosaavn-api.vercel.app/api/search/songs?query=${encodeURIComponent(cleaned)}&page=1&limit=5`,
      {},
      2600
    );
    if (jioRes.ok) {
      const jioJson = await jioRes.json();
      const songs = Array.isArray(jioJson?.data?.results)
        ? jioJson.data.results
        : Array.isArray(jioJson?.results)
          ? jioJson.results
          : [];
      for (const song of songs) {
        const urls = Array.isArray(song?.downloadUrl) ? song.downloadUrl : [];
        const best =
          urls.find((u) => u?.quality === '320kbps') ||
          urls.find((u) => u?.quality === '160kbps') ||
          urls[urls.length - 1];
        const streamUrl = String(best?.url || best?.link || '').trim();
        if (streamUrl.startsWith('http')) {
          return { url: streamUrl, mimeType: 'audio/mp4' };
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

async function resolveVideoStream(videoId, titleHint, artistHint) {
  const cached = streamCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const [innerTube, piped, catalog] = await Promise.all([
    tryInnerTubeStream(videoId),
    tryPipedStream(videoId),
    tryCatalogStream(videoId, titleHint, artistHint),
  ]);
  const winner = innerTube || piped || catalog;
  if (winner) {
    const entry = { ...winner, expiresAt: Date.now() + 25 * 60 * 1000 };
    streamCache.set(videoId, entry);
    return entry;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ROUTES — EXISTING HIGH / VERY HIGH / LOSSLESS ROUTES PRESERVED UNCHANGED
 * ═══════════════════════════════════════════════════════════════════════════ */

app.get('/', (req, res) => {
  res.status(200).send('VOID Backend is awake and running!');
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'void-backend',
    categories: {
      High: ['JioSaavn', 'Jamendo', 'YouTube'],
      'Very High': ['Spotify'],
      Lossless: ['Apple Music'],
      OG: ['Internet Archive (Rights-Cleared)', 'Wikimedia Commons (Rights-Cleared)', 'Jamendo FLAC', 'B2B Lossless Adapters'],
    },
    lyricsPolicy: 'ignored',
    authConfigured: {
      spotifyWebApi: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
      appleMusicDeveloperToken: Boolean(process.env.APPLE_MUSIC_DEVELOPER_TOKEN),
      jamendoClientId: Boolean(
        process.env.JAMENDO_CLIENT_ID || process.env.VITE_JAMENDO_CLIENT_ID
      ),
    },
    ogProviders: getOgProviderStatusReport(),
  });
});

async function handleMultiSourceSearch(req, res) {
  const query = String(req.query.q || req.query.query || '').trim();
  const limit = Math.min(25, Math.max(1, Number.parseInt(String(req.query.limit || '10'), 10) || 10));
  const country = String(req.query.country || 'us').trim() || 'us';
  const format = String(req.query.format || '').trim().toLowerCase();

  if (!query) {
    if (format === 'legacy') {
      return res.json([]);
    }
    return res.json({
      success: true,
      results: {
        High: [],
        'Very High': [],
        Lossless: [],
      },
    });
  }

  try {
    const baseUrl = getRequestBaseUrl(req);

    if (format === 'legacy') {
      const r = await yts(query);
      const videos = (r.videos || []).slice(0, 15).map((v) => ({
        id: v.videoId,
        name: v.title,
        album: 'YouTube',
        artist: v.author?.name || 'YouTube',
        image: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        downloadUrl: `${baseUrl}/stream?id=${encodeURIComponent(v.videoId)}&title=${encodeURIComponent(v.title || '')}&artist=${encodeURIComponent(v.author?.name || '')}`,
        duration: v.seconds,
      }));
      return res.json(videos);
    }

    const payload = await searchMultiSourceMusic(query, {
      limit,
      country,
      baseUrl,
    });
    return res.json(payload);
  } catch (error) {
    console.error('Multi-source search error:', error);
    return res.status(200).json({
      success: false,
      results: {
        High: [],
        'Very High': [],
        Lossless: [],
      },
    });
  }
}

app.get('/search', handleMultiSourceSearch);
app.get('/api/search', handleMultiSourceSearch);

/* ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDENT OG ROUTES (4-STAGE VERIFIED GENUINE LOSSLESS ONLY)
 * ═══════════════════════════════════════════════════════════════════════════ */

app.get('/og/providers', (req, res) => {
  res.json({
    success: true,
    section: 'OG',
    providers: getOgProviderStatusReport(),
  });
});

app.get('/og/search', async (req, res) => {
  const query = String(req.query.q || req.query.query || '').trim();
  const territory = String(req.query.territory || req.query.country || 'IN').trim().toUpperCase();
  const limit = Math.min(24, Math.max(1, Number.parseInt(String(req.query.limit || '12'), 10) || 12));

  try {
    const result = await searchOgProviders(query, { limit, territory });
    return res.json(result);
  } catch (error) {
    return res.status(200).json({
      success: false,
      section: 'OG',
      query,
      territory,
      tracks: [],
      error: error instanceof Error ? error.message : 'OG search failed closed',
    });
  }
});

app.get('/og/verify', async (req, res) => {
  const streamUrl = String(req.query.url || '').trim();
  const providerId = String(req.query.providerId || 'internet-archive').trim();
  const providerName = String(req.query.providerName || 'Internet Archive').trim();
  const duration = Number(req.query.duration) || 180;
  const territory = String(req.query.territory || 'IN').trim().toUpperCase();

  const check = await resolveOgTrack(
    {
      providerId,
      providerName,
      streamUrl,
      duration,
      rights: {
        licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
        commercialStreamingAllowed: true,
        territory,
      },
    },
    { territory }
  );

  return res.status(check.eligible ? 200 : 403).json(check);
});

app.get('/og/stream', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  const territory = String(req.query.territory || 'IN').trim().toUpperCase();

  const safety = validateOgStreamUrlSafety(targetUrl);
  if (!safety.safe) {
    return res.status(403).json({
      error: `OG stream rejected by security allowlist: ${safety.reason}`,
    });
  }

  const check = await resolveOgTrack(
    {
      providerId: String(req.query.providerId || 'internet-archive'),
      providerName: String(req.query.providerName || 'Internet Archive'),
      streamUrl: safety.url,
      duration: Number(req.query.duration) || 180,
      rights: {
        licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
        commercialStreamingAllowed: true,
        territory,
      },
    },
    { territory }
  );

  if (!check.eligible) {
    return res.status(403).json({
      error: check.reason || 'Stream failed OG 4-stage lossless verification',
    });
  }

  try {
    const headers = { 'User-Agent': 'VoidMusicPlayer-OG/1.0' };
    if (typeof req.headers.range === 'string') {
      headers['Range'] = req.headers.range;
    }
    const upstream = await fetch(safety.url, { headers, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: 'Upstream OG lossless stream unavailable' });
    }

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', check.track.mimeType || 'audio/flac');
    res.setHeader('X-OG-Verified-Codec', check.track.codec);
    res.setHeader('X-OG-Verified-BitDepth', String(check.track.bitDepth));
    res.setHeader('X-OG-Verified-SampleRate', String(check.track.sampleRate));
    res.setHeader('Accept-Ranges', 'bytes');

    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);

    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    req.on('close', () => {
      reader.cancel().catch(() => {});
    });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writableEnded) res.write(Buffer.from(value));
      else break;
    }
    if (!res.writableEnded) res.end();
  } catch {
    if (!res.headersSent) res.status(502).json({ error: 'OG stream proxy error' });
  }
});

app.get('/stream', async (req, res) => {
  let videoId = String(req.query.id || '').trim();
  const videoUrl = String(req.query.url || '').trim();
  const titleHint = String(req.query.title || '').trim();
  const artistHint = String(req.query.artist || '').trim();

  if (!videoId && videoUrl) {
    try {
      const parsedUrl = new URL(videoUrl);
      if (parsedUrl.hostname.includes('youtube.com')) {
        videoId = parsedUrl.searchParams.get('v') || '';
      } else if (parsedUrl.hostname.includes('youtu.be')) {
        videoId = parsedUrl.pathname.slice(1);
      }
    } catch {
      const match = videoUrl.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
      if (match) videoId = match[1];
    }
  }

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).send('Could not extract valid YouTube Video ID');
  }

  try {
    const resolved = await resolveVideoStream(videoId, titleHint, artistHint);
    if (!resolved || !resolved.url) {
      return res.status(502).send('Stream resolution failed');
    }

    const headers = {
      'User-Agent':
        resolved.userAgent ||
        'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    };
    if (typeof req.headers.range === 'string') {
      headers['Range'] = req.headers.range;
    }

    const upstream = await fetch(resolved.url, { headers, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) {
      return res.redirect(resolved.url);
    }

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || resolved.mimeType || 'audio/mp4'
    );
    res.setHeader('Accept-Ranges', 'bytes');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);

    if (!upstream.body) {
      return res.end();
    }
    const reader = upstream.body.getReader();
    req.on('close', () => {
      reader.cancel().catch(() => {});
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
  } catch (error) {
    console.error('Stream proxy error:', error);
    if (!res.headersSent) res.status(500).send('Stream extraction failed');
  }
});

app.get('/artwork', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  const source = String(req.query.source || '').trim();
  const uncroppedUrl = resolveOriginalUncroppedArtworkUrl(rawUrl, source);

  if (!uncroppedUrl || !/^https?:\/\//i.test(uncroppedUrl)) {
    return res.status(400).json({ error: 'Valid artwork URL is required' });
  }

  const cover = await fetchOriginalCoverBytes(uncroppedUrl, 6000);
  if (!cover || !cover.bytes) {
    return res.status(502).json({ error: 'Failed to retrieve original artwork' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', cover.mimeType || 'image/jpeg');
  res.setHeader('Content-Length', String(cover.bytes.byteLength));
  res.setHeader('X-Original-Width', String(cover.width || 0));
  res.setHeader('X-Original-Height', String(cover.height || 0));
  res.send(Buffer.from(cover.bytes));
});

app.get('/download', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  const videoId = String(req.query.id || '').trim();
  const title = String(req.query.title || 'Untitled').trim();
  const artist = String(req.query.artist || 'Unknown Artist').trim();
  const album = String(req.query.album || 'Single').trim();
  const source = String(req.query.source || '').trim();
  const artworkUrl = resolveOriginalUncroppedArtworkUrl(req.query.artwork || '', source);

  try {
    let resolvedStreamUrl = targetUrl;
    let userAgent = 'VOID-Music-Player/1.0';

    if ((!resolvedStreamUrl || resolvedStreamUrl.includes('/stream?')) && /^[\w-]{11}$/.test(videoId)) {
      const ytStream = await resolveVideoStream(videoId, title, artist);
      if (ytStream?.url) {
        resolvedStreamUrl = ytStream.url;
        if (ytStream.userAgent) userAgent = ytStream.userAgent;
      }
    } else if (resolvedStreamUrl.includes('/stream?')) {
      try {
        const parsedStream = new URL(resolvedStreamUrl, 'http://localhost');
        const idFromUrl = parsedStream.searchParams.get('id') || '';
        if (/^[\w-]{11}$/.test(idFromUrl)) {
          const ytStream = await resolveVideoStream(idFromUrl, title, artist);
          if (ytStream?.url) {
            resolvedStreamUrl = ytStream.url;
            if (ytStream.userAgent) userAgent = ytStream.userAgent;
          }
        }
      } catch {
        // Ignore
      }
    }

    if (!resolvedStreamUrl || !/^https?:\/\//i.test(resolvedStreamUrl)) {
      return res.status(400).json({ error: 'Valid authorized audio or preview URL is required' });
    }

    const [audioResponse, coverData] = await Promise.all([
      fetchWithTimeout(
        resolvedStreamUrl,
        {
          headers: { 'User-Agent': userAgent },
          redirect: 'follow',
        },
        15000
      ),
      artworkUrl ? fetchOriginalCoverBytes(artworkUrl, 5000) : Promise.resolve(null),
    ]);

    if (!audioResponse.ok) {
      return res.status(502).json({ error: 'Upstream audio stream unavailable' });
    }

    const rawAudioBytes = new Uint8Array(await audioResponse.arrayBuffer());
    const tagged = embedMetadataAndCoverBuffer(rawAudioBytes, {
      title,
      artist,
      album,
      coverBytes: coverData?.bytes || null,
      coverMimeType: coverData?.mimeType || 'image/jpeg',
      coverWidth: coverData?.width || 0,
      coverHeight: coverData?.height || 0,
    });

    const filename = `${sanitizeFilename(`${title} - ${artist}`)}.${tagged.extension}`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', tagged.mimeType);
    res.setHeader('Content-Length', String(tagged.bytes.byteLength));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(Buffer.from(tagged.bytes));
  } catch (error) {
    console.error('Download & metadata embed error:', error);
    return res.status(500).json({ error: 'Failed to process and tag audio file' });
  }
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`VOID backend running on port ${PORT}`);
  });
}

module.exports = app;
