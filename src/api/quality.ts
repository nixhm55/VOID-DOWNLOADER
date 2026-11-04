/**
 * Shared Audio Quality Detection, Provider Attribution, and SearchResult Normalization
 * for VOID Music Player.
 *
 * Preserves existing HIGH, VERY HIGH, and LOSSLESS sections untouched while adding
 * isolated routing for the 4th section: OG.
 */

export type QualityTier =
  | 'Lossless'
  | 'Very High (320kbps)'
  | 'High (256kbps)'
  | 'High (240kbps)'
  | 'High (192kbps)'
  | 'High (160kbps)'
  | 'Standard (128kbps)'
  | 'Low'
  | 'FLAC Live'
  | 'Live Radio'
  | 'Unknown';

export type QualityCategory = 'very-high' | 'high' | 'standard';

export type CanonicalProviderName =
  | 'JioSaavn'
  | 'Radio Browser'
  | 'Jamendo'
  | 'YouTube'
  | 'Internet Archive'
  | 'Wikimedia Commons'
  | 'MassiveMusic / 7digital'
  | 'Tuned Global'
  | 'AudioSocket'
  | 'Qobuz'
  | 'TIDAL'
  | 'Lossless Source'
  | string;

export interface SearchResult {
  id: string;
  name: string;
  album: string;
  artist: string;
  image: string;
  downloadUrl: string;
  duration: number;
  source?: string;

  qualityBadge?: QualityTier;
  bitrate?: number;
  codec?: string;

  mimeType?: string;
  format?: string;
  qualityVerified?: boolean;
  isLive?: boolean;
  fallbackUrls?: string[];
  qualityUrls?: Partial<Record<QualityCategory, string>>;
  bitDepth?: number;
  sampleRate?: number;
  language?: string;
  label?: string;

  // OG Genuine Lossless section fields (strictly isolated from High / Very High / Lossless)
  category?: 'High' | 'Very High' | 'Lossless' | 'Hi-Res Lossless' | 'OG';
  section?: 'OG';
  isrc?: string | null;
  providerId?: string;
  providerName?: string;
  ogSpecBadge?: string; // e.g., "FLAC · 16-bit · 44.1 kHz" or "FLAC · 24-bit · 96 kHz"
  qualityClassification?: string;
  ogVerified?: boolean;
  ogPlayable?: boolean;
  ogDownloadAllowed?: boolean;
  rights?: {
    licenseType?: string;
    licenseUrl?: string | null;
    territory?: string;
    commercialStreamingAllowed?: boolean;
    downloadAllowed?: boolean;
    attributionText?: string | null;
    sourcePageUrl?: string | null;
  };
  classifications?: {
    technicallyVerifiedLossless: boolean;
    provenanceVerifiedOriginal: boolean;
    provenanceStatus: string;
    rightsClearedPlayable: boolean;
  };
}

export interface QualityDetectionOptions {
  codecHint?: string;
  mimeTypeHint?: string;
  isLive?: boolean;
  providerVerified?: boolean;
  sourceHint?: string;
}

export function getTrackQualityCategory(
  item: Pick<SearchResult, 'qualityBadge' | 'bitrate' | 'isLive'>
): QualityCategory {
  const badge = item.qualityBadge;
  const br = item.bitrate ?? 0;

  if (
    badge === 'Lossless' ||
    badge === 'FLAC Live' ||
    badge === 'Very High (320kbps)' ||
    br >= 280
  ) {
    return 'very-high';
  }

  if (
    badge === 'High (256kbps)' ||
    badge === 'High (240kbps)' ||
    badge === 'High (192kbps)' ||
    badge === 'High (160kbps)' ||
    (br >= 140 && br < 280)
  ) {
    return 'high';
  }

  return 'standard';
}

const PROVIDER_DISPLAY_MAP: Record<string, string> = {
  jiosaavn: 'JioSaavn',
  saavn: 'JioSaavn',
  youtube: 'YouTube',
  yt: 'YouTube',
  jamendo: 'Jamendo',
  'jamendo-flac': 'Jamendo',
  'internet archive': 'Internet Archive',
  internetarchive: 'Internet Archive',
  'internet-archive': 'Internet Archive',
  archive: 'Internet Archive',
  'archive.org': 'Internet Archive',
  ia: 'Internet Archive',
  'wikimedia commons': 'Wikimedia Commons',
  'wikimedia-commons': 'Wikimedia Commons',
  wikimedia: 'Wikimedia Commons',
  massivemusic: 'MassiveMusic / 7digital',
  '7digital': 'MassiveMusic / 7digital',
  'tuned-global': 'Tuned Global',
  'tuned global': 'Tuned Global',
  audiosocket: 'AudioSocket',
  qobuz: 'Qobuz',
  tidal: 'TIDAL',
  'radio browser': 'Radio Browser',
  radiobrowser: 'Radio Browser',
  'radio-browser': 'Radio Browser',
  'lossless source': 'Lossless Source',
  'lossless-gateway': 'Lossless Source',
  lossless: 'Lossless Source',
  spotify: 'Spotify',
  'apple music': 'Apple Music',
  'apple-music': 'Apple Music',
  applemusic: 'Apple Music',
};

export function formatProviderLabel(source?: string | null, trackHint?: any): string {
  const raw = String(source ?? trackHint?.source ?? '').trim();
  if (raw && raw.toLowerCase() !== 'void' && raw.toLowerCase() !== 'local') {
    const mapped = PROVIDER_DISPLAY_MAP[raw.toLowerCase()];
    if (mapped) return mapped;
    return raw;
  }

  const id = String(trackHint?.id ?? '').replace(/^download:/, '');
  const url = String(trackHint?.downloadUrl || trackHint?.audioUrl || trackHint?.src || '').toLowerCase();

  if (url.includes('saavncdn.com') || url.includes('jiosaavn') || id.startsWith('jiosaavn:')) {
    return 'JioSaavn';
  }
  if (url.includes('wikimedia.org') || id.startsWith('og:commons:')) {
    return 'Wikimedia Commons';
  }
  if (url.includes('archive.org') || id.startsWith('ia:') || id.startsWith('og:ia:')) {
    return 'Internet Archive';
  }
  if (url.includes('jamendo.com') || url.includes('audius.co') || id.startsWith('jamendo:') || id.startsWith('og:jamendo:')) {
    return 'Jamendo';
  }
  if (id.startsWith('radio:') || trackHint?.isLive || trackHint?.album === 'Live Radio') {
    return 'Radio Browser';
  }
  if (id.startsWith('lossless:') || url.includes('lossless-stream')) {
    return 'Lossless Source';
  }
  if (
    url.includes('void-backend') ||
    url.includes('yt-stream://') ||
    url.includes('yt-audio') ||
    url.includes('youtube.com') ||
    url.includes('googlevideo.com') ||
    id.startsWith('yt:') ||
    /^(?:api-)?[\w-]{11}$/.test(id)
  ) {
    return 'YouTube';
  }
  if (id.startsWith('api-')) {
    return 'JioSaavn';
  }

  return '';
}

export function getProviderPriorityRank(source?: string | null, trackHint?: any): number {
  const label = formatProviderLabel(source, trackHint);
  if (label === 'JioSaavn') {
    return 1;
  }
  if (label === 'Jamendo') {
    return 2;
  }
  if (label === 'YouTube') {
    return 3;
  }
  return 4;
}

const SPAM_OR_AD_TITLE_REGEX =
  /\b(benefits of investing|investing in professional|how to invest|real estate investing|digital marketing|seo agency|webinar|sponsored ad|podcast episode|business coaching|forex trading|crypto millionaire|make money online|b2b sales|keynote speech)\b/i;

export function isLikelySpamOrAdResult(item: Pick<SearchResult, 'name' | 'artist' | 'album'>): boolean {
  const combined = `${item.name || ''} ${item.artist || ''} ${item.album || ''}`;
  return SPAM_OR_AD_TITLE_REGEX.test(combined);
}

function collapseSpacedLetters(text: string): string {
  return text.replace(/\b(?:[a-zA-Z]\s+){2,}[a-zA-Z]\b/g, (match) => match.replace(/\s+/g, ''));
}

function normalizeSearchTokens(text: string): string {
  return collapseSpacedLetters(String(text || ''))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&amp;/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isOneCharVariantWord(wordA: string, wordB: string): boolean {
  if (wordA === wordB) return true;
  if (wordA.length < 5 || wordB.length < 5) return false;
  if (Math.abs(wordA.length - wordB.length) > 1) return false;
  if (wordA.slice(0, 3) !== wordB.slice(0, 3)) return false;
  if (wordA.slice(-2) !== wordB.slice(-2)) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < wordA.length && j < wordB.length) {
    if (wordA[i] === wordB[j]) {
      i++;
      j++;
    } else {
      edits++;
      if (edits > 1) return false;
      if (wordA.length > wordB.length) i++;
      else if (wordB.length > wordA.length) j++;
      else {
        i++;
        j++;
      }
    }
  }
  if (i < wordA.length || j < wordB.length) edits++;
  return edits <= 1;
}

function extractCoreSongTitle(rawTitle: string, rawArtist: string): string {
  let cleaned = collapseSpacedLetters(String(rawTitle || '').trim());
  const normArtist = normalizeSearchTokens(rawArtist);

  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(/\s+-\s+/);
    if (parts.length >= 2) {
      const firstNorm = normalizeSearchTokens(parts[0]);
      if (normArtist && (firstNorm === normArtist || normArtist.includes(firstNorm) || firstNorm.includes(normArtist))) {
        cleaned = parts.slice(1).join(' - ');
      } else {
        cleaned = parts.slice(1).join(' - ') + ' ' + parts[0];
      }
    }
  }

  const strippedParens = cleaned
    .replace(/\((?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|hd|4k)|full\s*version|high\s*q[uo]ality[^)]*|lyrics?|audio|hd|hq|4k)\)/gi, '')
    .replace(/\[(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|hd|4k)|full\s*version|high\s*q[uo]ality[^\]]*|lyrics?|audio|hd|hq|4k)\]/gi, '');

  return normalizeSearchTokens(strippedParens);
}

function extractPartOrder(title: string): number {
  const lower = String(title || '').toLowerCase();
  const romanMatch = lower.match(/\b(?:part|pt\.?)\s*(i{1,3}|iv|v)\b/i);
  if (romanMatch) {
    const roman = romanMatch[1].toLowerCase();
    if (roman === 'i') return 1;
    if (roman === 'ii') return 2;
    if (roman === 'iii') return 3;
    if (roman === 'iv') return 4;
    if (roman === 'v') return 5;
  }
  const numMatch = lower.match(/\b(?:part|pt\.?)\s*(\d+)\b/i);
  if (numMatch) {
    const n = Number.parseInt(numMatch[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 20) return n;
  }
  return 0;
}

export function getSearchRelevanceScore(
  item: Pick<SearchResult, 'name' | 'artist' | 'album'>,
  query?: string
): { tier: number; exactSpelling: number; partOrder: number } {
  const normQuery = normalizeSearchTokens(query || '');
  if (!normQuery) {
    return { tier: 500, exactSpelling: 1, partOrder: 0 };
  }

  if (isLikelySpamOrAdResult(item)) {
    return { tier: -100, exactSpelling: 0, partOrder: 99 };
  }

  const queryWords = normQuery.split(' ').filter(Boolean);
  const normTitle = normalizeSearchTokens(item.name || '');
  const normArtist = normalizeSearchTokens(item.artist || '');
  const titleWords = normTitle.split(' ').filter(Boolean);
  const artistWords = normArtist.split(' ').filter(Boolean);
  const allWords = [...titleWords, ...artistWords];
  const coreTitle = extractCoreSongTitle(item.name || '', item.artist || '');
  const coreWords = coreTitle.split(' ').filter(Boolean);
  const partOrder = extractPartOrder(item.name || '');

  const hasExactWordInTitle = queryWords.every((qw) => titleWords.includes(qw) || coreWords.includes(qw));
  const hasVariantWordInTitle = queryWords.every((qw) =>
    titleWords.some((tw) => isOneCharVariantWord(qw, tw))
  );
  const hasExactWordInAll = queryWords.every((qw) => allWords.includes(qw));
  const hasVariantWordInAll = queryWords.every((qw) =>
    allWords.some((aw) => isOneCharVariantWord(qw, aw))
  );

  if (normTitle === normQuery || coreTitle === normQuery) {
    return { tier: 1000, exactSpelling: 2, partOrder };
  }
  if (
    queryWords.length === 1 &&
    coreWords.length === 1 &&
    isOneCharVariantWord(queryWords[0], coreWords[0])
  ) {
    return { tier: 980, exactSpelling: 1, partOrder };
  }

  if (
    normTitle.startsWith(normQuery + ' ') ||
    coreTitle.startsWith(normQuery + ' ')
  ) {
    return { tier: 940, exactSpelling: 2, partOrder };
  }
  if (
    queryWords.length === 1 &&
    ((titleWords.length > 0 && isOneCharVariantWord(queryWords[0], titleWords[0])) ||
      (coreWords.length > 0 && isOneCharVariantWord(queryWords[0], coreWords[0])))
  ) {
    return { tier: 910, exactSpelling: 1, partOrder };
  }

  if (hasExactWordInTitle) {
    return { tier: 860, exactSpelling: 2, partOrder };
  }
  if (hasVariantWordInTitle) {
    return { tier: 820, exactSpelling: 1, partOrder };
  }

  if (hasExactWordInAll) {
    return { tier: 720, exactSpelling: 2, partOrder };
  }
  if (hasVariantWordInAll) {
    return { tier: 680, exactSpelling: 1, partOrder };
  }

  if (normTitle.includes(normQuery)) {
    return { tier: 520, exactSpelling: 1, partOrder };
  }
  if (normArtist.includes(normQuery)) {
    return { tier: 450, exactSpelling: 1, partOrder };
  }

  const significantQueryWords = queryWords.filter((w) => w.length >= 4);
  if (
    significantQueryWords.length > 1 &&
    significantQueryWords.some((qw) =>
      titleWords.some((tw) => tw === qw || isOneCharVariantWord(qw, tw))
    )
  ) {
    return { tier: 300, exactSpelling: 0, partOrder };
  }

  return { tier: 0, exactSpelling: 0, partOrder: 99 };
}

const LOSSY_CODECS = /\b(mp3|mpeg|aac|m4a|mp4a|ogg|vorbis|opus|wma|webm|amr)\b/i;
const LOSSLESS_CODECS = /\b(flac|alac|wav|wave|aiff|aif|pcm|ape|wv|wavpack)\b/i;
const LOSSY_EXTENSIONS = /\.(mp3|m4a|aac|ogg|oga|opus|webm|wma)$/i;
const LOSSLESS_EXTENSIONS = /\.(flac|wav|wave|aiff|aif|alac)$/i;

function extractPathExtension(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url, 'https://localhost');
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase();
    const match = pathname.match(/\.[a-z0-9]{2,5}$/);
    return match ? match[0] : '';
  } catch {
    const clean = url.split('?')[0].split('#')[0].toLowerCase();
    const match = clean.match(/\.[a-z0-9]{2,5}$/);
    return match ? match[0] : '';
  }
}

function parseExplicitBitrateFromFormat(formatHint?: string, url?: string): number | undefined {
  const text = `${formatHint || ''} ${url || ''}`;
  const kbpsMatch = text.match(/\b(\d{2,4})\s*k(?:bps|bit\/s|b\/s)?\b/i);
  if (kbpsMatch) {
    const value = Number.parseInt(kbpsMatch[1], 10);
    if (Number.isFinite(value) && value >= 8 && value <= 9600) return value;
  }
  if (url) {
    if (/_320\.(mp4|m4a|mp3)/i.test(url)) return 320;
    if (/_160\.(mp4|m4a|mp3)/i.test(url)) return 160;
    if (/_96\.(mp4|m4a|mp3)/i.test(url)) return 96;
  }
  return undefined;
}

function mapBitrateToTier(kbps: number): QualityTier {
  if (kbps >= 700) return 'Lossless';
  if (kbps >= 280) return 'Very High (320kbps)';
  if (kbps >= 248) return 'High (256kbps)';
  if (kbps >= 215) return 'High (240kbps)';
  if (kbps >= 175) return 'High (192kbps)';
  if (kbps >= 140) return 'High (160kbps)';
  if (kbps >= 96) return 'Standard (128kbps)';
  return 'Low';
}

export function detectTrackQuality(
  url: string,
  formatHint?: string,
  bitrateHint?: number,
  options?: QualityDetectionOptions
): QualityTier {
  const cleanUrl = String(url ?? '').trim();
  const cleanFormat = String(formatHint ?? '').trim();
  const cleanCodec = String(options?.codecHint ?? '').trim();
  const cleanMime = String(options?.mimeTypeHint ?? '').trim().toLowerCase();
  const combinedHint = `${cleanFormat} ${cleanCodec} ${cleanMime}`.trim();
  const ext = extractPathExtension(cleanUrl);

  const numericBitrate =
    typeof bitrateHint === 'number' && Number.isFinite(bitrateHint) && bitrateHint > 0
      ? bitrateHint
      : parseExplicitBitrateFromFormat(cleanFormat, cleanUrl);

  const isLiveStream =
    Boolean(options?.isLive) ||
    /\b(live\s*radio|flac\s*live|icecast|shoutcast|radio\s*stream)\b/i.test(cleanFormat);

  const hasLossyEvidence =
    LOSSY_EXTENSIONS.test(ext) ||
    LOSSY_CODECS.test(combinedHint) ||
    cleanMime === 'audio/mpeg' ||
    cleanMime === 'audio/mp4' ||
    cleanMime === 'audio/aac' ||
    cleanMime === 'audio/ogg' ||
    cleanMime === 'audio/webm' ||
    cleanMime === 'audio/opus';

  const hasLosslessEvidence =
    !hasLossyEvidence &&
    (LOSSLESS_EXTENSIONS.test(ext) ||
      LOSSLESS_CODECS.test(combinedHint) ||
      cleanMime.includes('flac') ||
      cleanMime.includes('wav') ||
      cleanMime.includes('aiff') ||
      cleanMime.includes('alac'));

  if (isLiveStream) {
    if (hasLosslessEvidence || /\bflac\b/i.test(combinedHint)) {
      return 'FLAC Live';
    }
    if (numericBitrate !== undefined) {
      return mapBitrateToTier(numericBitrate);
    }
    return 'Live Radio';
  }

  if (hasLosslessEvidence) {
    return 'Lossless';
  }
  if (!hasLossyEvidence && numericBitrate !== undefined && numericBitrate >= 700) {
    return 'Lossless';
  }

  if (numericBitrate !== undefined && numericBitrate > 0) {
    return mapBitrateToTier(numericBitrate);
  }

  const lowerUrl = cleanUrl.toLowerCase();
  const provider = formatProviderLabel(options?.sourceHint, { downloadUrl: cleanUrl });

  if (lowerUrl.includes('saavncdn.com') || provider === 'JioSaavn') {
    if (lowerUrl.includes('_96.')) return 'Standard (128kbps)';
    if (lowerUrl.includes('_160.')) return 'High (160kbps)';
    return 'Very High (320kbps)';
  }

  if (provider === 'Lossless Source') {
    return 'Lossless';
  }

  if (provider === 'Jamendo' || lowerUrl.includes('jamendo.com')) {
    return 'High (192kbps)';
  }

  if (provider === 'Internet Archive' || lowerUrl.includes('archive.org')) {
    if (/\b(vbr|320)\b/i.test(combinedHint)) return 'Very High (320kbps)';
    return 'High (192kbps)';
  }

  if (
    provider === 'YouTube' ||
    lowerUrl.startsWith('yt-stream://') ||
    lowerUrl.includes('yt-audio') ||
    lowerUrl.includes('googlevideo.com')
  ) {
    if (/\bopus|webm\b/i.test(combinedHint)) return 'High (160kbps)';
    if (/\baac|mp4|m4a\b/i.test(combinedHint)) return 'Standard (128kbps)';
    return 'High (160kbps)';
  }

  if (/\bopus\b/i.test(combinedHint)) return 'High (160kbps)';
  if (/\b(aac|m4a|mp4)\b/i.test(combinedHint)) return 'High (192kbps)';
  if (/\bmp3|mpeg\b/i.test(combinedHint)) return 'High (192kbps)';

  return 'Standard (128kbps)';
}

export function getTrackQualityBadge(track: any): QualityTier | undefined {
  if (!track) return undefined;

  if (track.qualityBadge && track.qualityBadge !== 'Unknown') {
    return track.qualityBadge as QualityTier;
  }

  const url = String(track.downloadUrl || track.audioUrl || track.src || track.fileName || '');
  const formatHint = String(track.format || track.codec || track.mimeType || '');
  let bitrateHint = typeof track.bitrate === 'number' && track.bitrate > 0 ? track.bitrate : undefined;
  const isLive = Boolean(track.isLive || track.album === 'Live Radio');

  const byteSize =
    Number(track.fileSize) ||
    (track.blob instanceof Blob ? track.blob.size : 0) ||
    (track.file instanceof Blob ? track.file.size : 0);
  const durationSec = Number(track.duration) || 0;

  if (!bitrateHint && byteSize > 0 && durationSec > 5) {
    const calculatedKbps = Math.round((byteSize * 8) / 1000 / durationSec);
    if (calculatedKbps >= 24 && calculatedKbps <= 9600) {
      bitrateHint = calculatedKbps;
    }
  }

  const ext = extractPathExtension(track.fileName || url);
  if (LOSSLESS_EXTENSIONS.test(ext) || /flac|wav|aiff|alac/i.test(track.mimeType || '')) {
    return isLive ? 'FLAC Live' : 'Lossless';
  }

  return detectTrackQuality(url, formatHint, bitrateHint, {
    codecHint: track.codec,
    mimeTypeHint: track.mimeType || track.blob?.type || track.file?.type,
    isLive,
    sourceHint: track.source,
  });
}

export function getQualitySortRank(result: Pick<SearchResult, 'qualityBadge' | 'qualityVerified' | 'isLive'>): number {
  const badge = result.qualityBadge ?? 'Standard (128kbps)';
  const verified = Boolean(result.qualityVerified);

  if (result.isLive || badge === 'Live Radio' || badge === 'FLAC Live') {
    if (badge === 'FLAC Live') return verified ? 95 : 88;
    if (badge === 'Very High (320kbps)') return 82;
    if (badge === 'High (256kbps)' || badge === 'High (240kbps)') return 74;
    if (badge === 'High (192kbps)' || badge === 'High (160kbps)') return 66;
    if (badge === 'Standard (128kbps)') return 50;
    return 40;
  }

  switch (badge) {
    case 'Lossless':
      return verified ? 100 : 90;
    case 'Very High (320kbps)':
      return verified ? 84 : 76;
    case 'High (256kbps)':
    case 'High (240kbps)':
      return verified ? 74 : 68;
    case 'High (192kbps)':
    case 'High (160kbps)':
      return verified ? 66 : 60;
    case 'Standard (128kbps)':
      return verified ? 52 : 44;
    case 'Low':
    default:
      return verified ? 32 : 28;
  }
}

export function compareResultsByQuality(a: SearchResult, b: SearchResult, query?: string): number {
  const catA = getTrackSearchCategory(a);
  const catB = getTrackSearchCategory(b);
  const srcA = String(a.source || '').trim().toLowerCase();
  const srcB = String(b.source || '').trim().toLowerCase();

  if (catA === 'Hi-Res Lossless' && catB === 'Hi-Res Lossless') {
    return 0;
  }

  if (catA === 'Lossless' && catB === 'Lossless') {
    if (query) {
      const relA = getSearchRelevanceScore(a, query);
      const relB = getSearchRelevanceScore(b, query);
      if (relB.tier !== relA.tier) return relB.tier - relA.tier;
    }
    const bdDiff = (Number(b.bitDepth) || 16) - (Number(a.bitDepth) || 16);
    if (bdDiff !== 0) return bdDiff;
    const srDiff = (Number(b.sampleRate) || 44100) - (Number(a.sampleRate) || 44100);
    if (srDiff !== 0) return srDiff;
    return 0;
  }

  const rankA = getProviderPriorityRank(a.source, a);
  const rankB = getProviderPriorityRank(b.source, b);
  if (rankA !== rankB) return rankA - rankB;

  if (rankA === 1 || (srcA === srcB && (srcA === 'spotify' || srcA === 'apple music'))) {
    return 0;
  }

  if (query) {
    const relA = getSearchRelevanceScore(a, query);
    const relB = getSearchRelevanceScore(b, query);
    if (relB.tier !== relA.tier) {
      return relB.tier - relA.tier;
    }
    if (relB.exactSpelling !== relA.exactSpelling) {
      return relB.exactSpelling - relA.exactSpelling;
    }
    if (relA.partOrder !== relB.partOrder) {
      if (relA.partOrder > 0 && relB.partOrder > 0) {
        return relA.partOrder - relB.partOrder;
      }
      if (relA.partOrder > 0 && relB.partOrder === 0) return -1;
      if (relB.partOrder > 0 && relA.partOrder === 0) return 1;
    }
  }

  const rankDiff = getQualitySortRank(b) - getQualitySortRank(a);
  if (rankDiff !== 0) return rankDiff;

  const bitrateA = a.bitrate ?? 0;
  const bitrateB = b.bitrate ?? 0;
  if (bitrateB !== bitrateA) return bitrateB - bitrateA;
  return 0;
}

export function extractVersionSignature(title: string): string {
  const lower = String(title || '').toLowerCase();
  const markers: string[] = [];
  const patterns: [RegExp, string][] = [
    [/\b(live|concert|unplugged)\b/, 'live'],
    [/\b(remix|vip|bootleg|flip|mashup|club\s*mix)\b/, 'remix'],
    [/\b(acoustic|stripped)\b/, 'acoustic'],
    [/\b(instrumental|karaoke)\b/, 'instrumental'],
    [/\b(slowed|reverb|sped\s*up|nightcore)\b/, 'altered'],
    [/\b(radio\s*edit|extended\s*mix|extended\s*version)\b/, 'edit'],
    [/\b(cover)\b/, 'cover'],
    [/\b(lofi|lo-fi)\b/, 'lofi'],
  ];
  for (const [regex, tag] of patterns) {
    if (regex.test(lower)) markers.push(tag);
  }
  const partOrder = extractPartOrder(title);
  if (partOrder > 0) {
    markers.push(`part-${partOrder}`);
  }
  return markers.sort().join('|');
}

export function cleanCanonicalTrackTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  let cleaned = String(rawTitle)
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

  const stripTagRegex =
    /\s*(?:\((?:from\s+[^)]+|[^)]*\bsoundtrack\b[^)]*|[^)]*\bost\b[^)]*|[^)]*\bmotion\s*picture\b[^)]*|[^)]*\bfilm\s*version\b[^)]*|[^)]*\bofficial\s*(?:music\s*)?(?:video|audio|lyric\s*video|hd|4k)[^)]*|[^)]*\bfull\s*(?:video|song|audio|version)[^)]*|[^)]*\b(?:video|audio)\s*song\b[^)]*|[^)]*\blyrics?\b[^)]*|[^)]*\bhigh\s*q[uo]ality\b[^)]*|[^)]*\bremaster(?:ed)?(?:\s*\d{4})?\b[^)]*|\b(?:hd|hq|4k|audio|video)\b)\)|\[(?:from\s+[^\]]+|[^\]]*\bsoundtrack\b[^\]]*|[^\]]*\bost\b[^\]]*|[^\]]*\bmotion\s*picture\b[^\]]*|[^\]]*\bfilm\s*version\b[^\]]*|[^\]]*\bofficial\s*(?:music\s*)?(?:video|audio|lyric\s*video|hd|4k)[^\]]*|[^\]]*\bfull\s*(?:video|song|audio|version)[^\]]*|[^\]]*\b(?:video|audio)\s*song\b[^\]]*|[^\]]*\blyrics?\b[^\]]*|[^\]]*\bhigh\s*q[uo]ality\b[^\]]*|[^\]]*\bremaster(?:ed)?(?:\s*\d{4})?\b[^\]]*|\b(?:hd|hq|4k|audio|video)\b)\])/gi;

  cleaned = cleaned.replace(stripTagRegex, '');

  cleaned = cleaned.replace(
    /\s*[-–—|:]\s*(?:from\s+["'“”]?[^-|()[\]]+["'“”]?|original\s+motion\s+picture\s+soundtrack|motion\s+picture\s+soundtrack|soundtrack(?:\s+version)?|ost|official\s*(?:music\s*)?(?:video|audio|lyric\s*video)|full\s*(?:video|song|audio)|remaster(?:ed)?(?:\s*\d{4})?)\s*$/gi,
    ''
  );

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || String(rawTitle).trim();
}

export function normalizeForDedup(text: string): string {
  const canonical = cleanCanonicalTrackTitle(text);
  return canonical
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((?:feat\.?|ft\.?|with|prod\.?\s*by)\s+[^)]*\)/gi, '')
    .replace(/\[(?:feat\.?|ft\.?|with|prod\.?\s*by)\s+[^\]]*\]/gi, '')
    .replace(/\b(?:feat\.?|ft\.?)\s+.*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function getPhoneticSongKey(rawTitle: string): string {
  const base = normalizeForDedup(rawTitle);
  if (!base) return '';
  return base
    .replace(/aa+/g, 'a')
    .replace(/ee+|ii+/g, 'i')
    .replace(/oo+|uu+|ou|ow/g, 'u')
    .replace(/ei|ey/g, 'i')
    .replace(/ay/g, 'ai')
    .replace(/aw/g, 'au')
    .replace(/ph/g, 'f')
    .replace(/q/g, 'k')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzyEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const temp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = temp;
    }
  }
  return dp[a.length];
}

export function normalizePrimaryArtist(artist: string): string {
  const first =
    String(artist || '')
      .split(/(?:,|;|&|·|\||\/|\bfeat\.?\b|\bft\.?\b|\bwith\b)/i)[0]
      ?.trim() || '';
  return normalizeForDedup(first).replace(/\b(?:unknown\s*artist|various\s*artists)\b/gi, '').trim();
}

function getPhoneticArtistKey(artist: string): string {
  const norm = normalizePrimaryArtist(artist);
  if (!norm) return '';
  return norm
    .replace(/aa+/g, 'a')
    .replace(/ee+|ii+/g, 'i')
    .replace(/oo+|uu+|ou/g, 'u')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function areArtistsCompatibleForDedup(artistA?: string, artistB?: string): boolean {
  const rawA = String(artistA || '').toLowerCase();
  const rawB = String(artistB || '').toLowerCase();
  const a = getPhoneticArtistKey(artistA || '');
  const b = getPhoneticArtistKey(artistB || '');
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const splitAll = (raw: string) =>
    raw
      .split(/(?:,|;|&|·|\||\/|\bfeat\.?\b|\bft\.?\b|\bwith\b|\band\b)/i)
      .map(part => getPhoneticArtistKey(part))
      .filter(part => part.length >= 3);

  const listA = splitAll(rawA);
  const listB = splitAll(rawB);
  for (const itemA of listA) {
    for (const itemB of listB) {
      if (itemA === itemB || itemA.includes(itemB) || itemB.includes(itemA)) return true;
      if (Math.min(itemA.length, itemB.length) >= 5 && fuzzyEditDistance(itemA, itemB) <= 1) return true;
    }
  }

  if (Math.min(a.length, b.length) >= 5 && fuzzyEditDistance(a, b) <= 2) return true;
  return false;
}

export function areSongsFuzzyDuplicates(
  titleA: string,
  titleB: string,
  artistA?: string,
  artistB?: string,
  ignoreArtist = false
): boolean {
  const verA = extractVersionSignature(titleA);
  const verB = extractVersionSignature(titleB);
  if (verA !== verB) return false;

  const normA = normalizeForDedup(titleA);
  const normB = normalizeForDedup(titleB);
  if (!normA || !normB) return false;

  const phonA = getPhoneticSongKey(titleA);
  const phonB = getPhoneticSongKey(titleB);

  let titlesMatch = false;
  if (normA === normB || (phonA && phonA === phonB)) {
    titlesMatch = true;
  } else {
    const wordsA = phonA.split(' ').filter(Boolean);
    const wordsB = phonB.split(' ').filter(Boolean);
    if (wordsA.length === wordsB.length && wordsA.length >= 1 && Math.min(phonA.length, phonB.length) >= 5) {
      const dists = wordsA.map((wa, idx) => {
        const wb = wordsB[idx];
        if (wa === wb) return 0;
        if (wa.length >= 4 && wb.length >= 4 && wa[0] === wb[0]) {
          return fuzzyEditDistance(wa, wb);
        }
        return 99;
      });
      const maxWordDist = Math.max(...dists);
      const totalDist = dists.reduce((sum, d) => sum + d, 0);
      if (maxWordDist <= 1 && totalDist <= (phonA.length >= 10 ? 2 : 1)) {
        titlesMatch = true;
      }
    }
  }

  if (!titlesMatch) return false;
  if (ignoreArtist) return true;

  if (areArtistsCompatibleForDedup(artistA, artistB)) {
    return true;
  }

  const wordCount = phonA.split(' ').filter(Boolean).length;
  if (wordCount >= 3 && phonA.length >= 10) {
    return true;
  }

  return false;
}

export function scoreCanonicalTitleCleanliness(rawTitle: string): number {
  const raw = String(rawTitle || '').trim();
  if (!raw) return 0;
  let score = 100;
  if (/\bfrom\b|\bsoundtrack\b|\bost\b|\bmotion\s*picture\b/i.test(raw)) score -= 45;
  if (/\bofficial\b|\blyric\b|\bvideo\b|\bfull\s*song\b|\baudio\b/i.test(raw)) score -= 35;
  if (/[()[\]]/.test(raw)) score -= 10;
  return score;
}

export function deduplicateTrackCollection<T extends Record<string, any>>(
  items: T[],
  options?: { ignoreArtist?: boolean; cleanTitles?: boolean }
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const ignoreArtist = Boolean(options?.ignoreArtist);
  const cleanTitles = options?.cleanTitles !== false;
  const deduped: T[] = [];

  for (const rawItem of items) {
    if (!rawItem) continue;
    const rawTitle = String(rawItem.title ?? rawItem.name ?? '').trim();
    const cleanedTitle = cleanTitles ? cleanCanonicalTrackTitle(rawTitle) : rawTitle;
    const item: T =
      cleanTitles && cleanedTitle && cleanedTitle !== rawTitle
        ? ({
            ...rawItem,
            ...(rawItem.title !== undefined ? { title: cleanedTitle } : {}),
            ...(rawItem.name !== undefined ? { name: cleanedTitle } : {}),
          } as T)
        : rawItem;

    if (item.isLive || item.qualityBadge === 'Live Radio' || item.qualityBadge === 'FLAC Live') {
      deduped.push(item);
      continue;
    }

    const candTitle = String(item.title ?? item.name ?? '');
    const candArtist = String(item.artist ?? '');

    const dupIdx = deduped.findIndex((existing) => {
      if (existing.isLive || existing.qualityBadge === 'Live Radio' || existing.qualityBadge === 'FLAC Live') {
        return false;
      }
      const exTitle = String(existing.title ?? existing.name ?? '');
      const exArtist = String(existing.artist ?? '');
      return areSongsFuzzyDuplicates(candTitle, exTitle, candArtist, exArtist, ignoreArtist);
    });

    if (dupIdx === -1) {
      deduped.push(item);
    } else {
      const existing = deduped[dupIdx];
      const candHasOffline = Boolean(item.offlineAvailable || String(item.id || '').startsWith('download:'));
      const exHasOffline = Boolean(existing.offlineAvailable || String(existing.id || '').startsWith('download:'));
      const candHasDirect = Boolean(
        typeof (item.audioUrl || item.downloadUrl) === 'string' &&
          String(item.audioUrl || item.downloadUrl).startsWith('http')
      );
      const exHasDirect = Boolean(
        typeof (existing.audioUrl || existing.downloadUrl) === 'string' &&
          String(existing.audioUrl || existing.downloadUrl).startsWith('http')
      );

      const candScore =
        (candHasOffline ? 500 : 0) +
        (item.favorite ? 250 : 0) +
        (candHasDirect ? 120 : 0) +
        (item.image ? 40 : 0) +
        scoreCanonicalTitleCleanliness(rawTitle) +
        getQualitySortRank(item as any);

      const exScore =
        (exHasOffline ? 500 : 0) +
        (existing.favorite ? 250 : 0) +
        (exHasDirect ? 120 : 0) +
        (existing.image ? 40 : 0) +
        scoreCanonicalTitleCleanliness(String(existing.title ?? existing.name ?? '')) +
        getQualitySortRank(existing as any);

      if (candScore > exScore) {
        deduped[dupIdx] = {
          ...existing,
          ...item,
          favorite: Boolean(item.favorite || existing.favorite),
          image: item.image || existing.image,
          offlineAvailable: Boolean(item.offlineAvailable || existing.offlineAvailable),
        };
      } else {
        deduped[dupIdx] = {
          ...existing,
          favorite: Boolean(existing.favorite || item.favorite),
          image: existing.image || item.image,
          offlineAvailable: Boolean(existing.offlineAvailable || item.offlineAvailable),
        };
      }
    }
  }

  return deduped;
}

/**
 * The four quality sections in Void:
 * 1. 'High'
 * 2. 'Very High'
 * 3. 'Lossless'
 * 4. 'Hi-Res Lossless' (All Apple Music tracks)
 */
export type SearchCategory = 'High' | 'Very High' | 'Lossless' | 'Hi-Res Lossless';

/**
 * Clean & Authentic Quality & Category Router:
 * - Apple Music -> 'Hi-Res Lossless'
 * - Genuine Lossless (FLAC, ALAC, WAV, AIFF, Internet Archive FLAC, Jamendo FLAC, Lossless Gateways) -> 'Lossless'
 * - 320kbps streams (Spotify and high-bitrate masters) -> 'Very High'
 * - Standard/High streams (JioSaavn, Jamendo, YouTube) -> 'High'
 */
export function getTrackSearchCategory(item: SearchResult): SearchCategory {
  const src = String(item?.source || '').trim().toLowerCase();
  const codec = String(item?.codec || '').trim().toUpperCase();
  const mime = String(item?.mimeType || '').trim().toLowerCase();
  const url = String(item?.downloadUrl || '').trim().toLowerCase();

  // 1. Apple Music tracks -> 'Hi-Res Lossless'
  if (src === 'apple music' || item?.category === 'Hi-Res Lossless') {
    return 'Hi-Res Lossless';
  }

  // 2. Genuine Lossless streams (only genuine FLAC, ALAC, WAV, AIFF - never MP3/AAC)
  const isLosslessCodec =
    /\b(flac|alac|wav|wave|aiff|pcm)\b/i.test(codec) ||
    /\.(flac|alac|wav|wave|aiff)(\?|$)/i.test(url) ||
    mime.includes('flac') ||
    mime.includes('alac') ||
    mime.includes('wav');

  const isLossyFormat =
    codec === 'MP3' ||
    codec === 'OPUS' ||
    codec === 'VORBIS' ||
    codec === 'OGG' ||
    codec === 'AAC' ||
    codec === 'AAC-LC' ||
    mime.includes('mpeg') ||
    mime.includes('mp3') ||
    mime.includes('mp4') ||
    mime.includes('aac') ||
    mime.includes('ogg') ||
    mime.includes('webm') ||
    url.includes('audius.co') ||
    url.includes('yt-audio') ||
    url.includes('yt-stream://') ||
    /\.(mp3|m4a|aac|ogg|opus|webm)(\?|$)/i.test(url);

  if (!isLossyFormat && (isLosslessCodec || item?.qualityBadge === 'Lossless' || src === 'lossless source' || src === 'wikimedia commons')) {
    return 'Lossless';
  }

  // 3. Spotify or 320kbps full tracks -> 'Very High'
  if (
    src === 'spotify' ||
    item?.category === 'Very High' ||
    ((item?.bitrate ?? 0) >= 280 && src !== 'jiosaavn' && src !== 'youtube' && src !== 'jamendo')
  ) {
    return 'Very High';
  }

  // 4. All other catalog songs (JioSaavn, Jamendo, YouTube) -> 'High'
  return 'High';
}

export function deduplicateAndSortSearchResults(results: SearchResult[], query?: string): SearchResult[] {
  const byExactId = new Map<string, SearchResult>();

  for (const item of results) {
    if (!item || !item.id || !item.downloadUrl) continue;
    if (isLikelySpamOrAdResult(item)) continue;
    const exactKey = `${getTrackSearchCategory(item)}:${(item.source || '').toLowerCase()}:${item.id}`;
    const existing = byExactId.get(exactKey);
    if (!existing || compareResultsByQuality(item, existing, query) < 0) {
      byExactId.set(exactKey, item);
    }
  }

  const uniqueById = Array.from(byExactId.values());
  const merged: SearchResult[] = [];

  for (const rawCandidate of uniqueById) {
    const candidateCategory = getTrackSearchCategory(rawCandidate);

    if (candidateCategory === 'Hi-Res Lossless') {
      merged.push(rawCandidate);
      continue;
    }

    const cleanedName = cleanCanonicalTrackTitle(rawCandidate.name) || rawCandidate.name;
    const candidate: SearchResult =
      cleanedName !== rawCandidate.name ? { ...rawCandidate, name: cleanedName } : rawCandidate;

    if (candidate.isLive || candidate.qualityBadge === 'Live Radio' || candidate.qualityBadge === 'FLAC Live') {
      const dupStationIdx = merged.findIndex(
        existing =>
          (existing.isLive || existing.qualityBadge === 'Live Radio' || existing.qualityBadge === 'FLAC Live') &&
          (existing.downloadUrl === candidate.downloadUrl ||
            (normalizeForDedup(existing.name) === normalizeForDedup(candidate.name) &&
              existing.bitrate === candidate.bitrate))
      );
      if (dupStationIdx === -1) {
        merged.push(candidate);
      } else if (compareResultsByQuality(candidate, merged[dupStationIdx], query) < 0) {
        merged[dupStationIdx] = candidate;
      }
      continue;
    }

    const candTitle = normalizeForDedup(candidate.name);
    if (!candTitle) {
      merged.push(candidate);
      continue;
    }

    const dupIdx = merged.findIndex(existing => {
      if (existing.isLive || existing.qualityBadge === 'Live Radio' || existing.qualityBadge === 'FLAC Live') {
        return false;
      }
      if (getTrackSearchCategory(existing) !== candidateCategory) {
        return false;
      }
      return areSongsFuzzyDuplicates(candidate.name, existing.name, candidate.artist, existing.artist, false);
    });

    if (dupIdx === -1) {
      merged.push(candidate);
    } else {
      const existing = merged[dupIdx];
      const candidateWins = compareResultsByQuality(candidate, existing, query) < 0;
      const winner = candidateWins ? candidate : existing;
      const loser = candidateWins ? existing : candidate;
      const combinedFallbacks = [
        ...(Array.isArray(winner.fallbackUrls) ? winner.fallbackUrls : []),
        loser.downloadUrl,
        ...(Array.isArray(loser.fallbackUrls) ? loser.fallbackUrls : []),
      ].filter((url, idx, arr) => Boolean(url) && url !== winner.downloadUrl && arr.indexOf(url) === idx);

      merged[dupIdx] = {
        ...winner,
        image:
          scoreCoverAuthenticity(winner) >= scoreCoverAuthenticity(loser)
            ? winner.image || loser.image
            : loser.image || winner.image,
        qualityUrls: {
          ...(loser.qualityUrls || {}),
          ...(winner.qualityUrls || {}),
        },
        fallbackUrls: combinedFallbacks.length > 0 ? combinedFallbacks : winner.fallbackUrls,
      };
    }
  }

  // Enrich Spotify ('Very High') tracks with full-length 320kbps audio streams
  // when the catalog only provided a 30s preview URL. Never touch 'Lossless' or 'OG'!
  const highTracks = merged.filter(t => getTrackSearchCategory(t) === 'High' && !t.isLive);
  for (let i = 0; i < merged.length; i++) {
    const item = merged[i];
    const cat = getTrackSearchCategory(item);
    if (cat !== 'Very High') continue;
    const isPreviewUrl = /p\.scdn\.co|audio-ssl\.itunes\.apple\.com|preview/i.test(item.downloadUrl);
    if (!isPreviewUrl) continue;
    const match = highTracks.find(h =>
      areSongsFuzzyDuplicates(item.name, h.name, item.artist, h.artist, true)
    );
    if (match && match.downloadUrl) {
      const fallbacks = [
        ...(Array.isArray(match.fallbackUrls) ? match.fallbackUrls : []),
        item.downloadUrl,
        ...(Array.isArray(item.fallbackUrls) ? item.fallbackUrls : []),
      ].filter((url, idx, arr) => Boolean(url) && url !== match.downloadUrl && arr.indexOf(url) === idx);
      merged[i] = {
        ...item,
        downloadUrl: match.downloadUrl,
        fallbackUrls: fallbacks,
        qualityUrls: {
          ...(item.qualityUrls || {}),
          ...(match.qualityUrls || {}),
        },
        duration: match.duration || item.duration,
      };
    }
  }

  const sorted = merged.sort((a, b) => compareResultsByQuality(a, b, query));
  return harmonizeCanonicalSongCovers(sorted);
}

const COMPILATION_ALBUM_REGEX =
  /\b(one\s*hit\s*wonders?|hit\s*wonders?|top\s*\d+|best\s*of|greatest\s*hits|mega\s*hits|super\s*hits|party\s*hits|club\s*hits|dance\s*hits|house\s*tracks|age\s*of\s*the|time\s*to\s*have|peaceful|relaxing|chillout|chill\s*out|workout|fitness|lounge|now\s*that'?s\s*what|bravo\s*hits|ministry\s*of\s*sound|various\s*artists|compilation|anthology|collection|classics|retro|throwback|\d{2,4}s\s+(?:hits|music|pop|rock|dance|club|one\s*hit)|volume\s*\d+|vol\.?\s*\d+|hits\s*of|essential|ultimate\s+hits|pure\s+\w+|100\s*%|non\s*stop|dj\s+mix|chart\s*hits|summer\s*hits|winter\s*hits|love\s*songs|sad\s*songs)\b/i;

export function extractBaseSongHeadline(rawTitle: string): string {
  const clean = cleanCanonicalTrackTitle(rawTitle);
  const stripped = clean
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s*\[[^\]]*\]/g, ' ')
    .replace(/\s*[-–—/]\s*(?:pt\.?\s*\d+|part\s*(?:[ivx]+|\d+)|radio\s*edit|extended.*|remix.*|mix.*|version.*|edit.*|remaster.*)$/i, '')
    .trim();
  return normalizeForDedup(stripped || clean);
}

export function isCompilationOrMismatchedAlbum(
  albumName?: string,
  songTitle?: string,
  artistName?: string
): boolean {
  const album = String(albumName || '').trim();
  if (!album || /^unknown/i.test(album) || /^youtube\b/i.test(album)) return true;
  if (COMPILATION_ALBUM_REGEX.test(album)) return true;

  const title = String(songTitle || '').trim();
  const artist = String(artistName || '').trim();
  const hasCjkInAlbum = /[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(album);
  const hasCjkInMeta = /[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(`${title} ${artist}`);
  if (hasCjkInAlbum && !hasCjkInMeta) return true;

  return false;
}

export function scoreCoverAuthenticity(item: {
  name?: string;
  title?: string;
  album?: string;
  artist?: string;
  image?: string;
  source?: string;
}): number {
  const img = String(item?.image || '').trim();
  if (!img || !/^https?:\/\//i.test(img)) return -200;

  const title = String(item?.name || item?.title || '').trim();
  const album = String(item?.album || '').trim();
  const artist = String(item?.artist || '').trim();
  const source = String(item?.source || '').toLowerCase();

  if (isCompilationOrMismatchedAlbum(album, title, artist)) {
    return -100;
  }

  let score = 20;
  if (/(?:saavncdn\.com|mzstatic\.com|dzcdn\.net|scdn\.co)/i.test(img)) {
    score += 25;
  } else if (source.includes('youtube') || /ytimg\.com/i.test(img)) {
    score -= 15;
  }

  const baseTitle = extractBaseSongHeadline(title);
  const baseAlbum = extractBaseSongHeadline(album);
  const normAlbum = normalizeForDedup(album);

  if (baseTitle && baseAlbum) {
    if (baseAlbum === baseTitle || normAlbum === baseTitle) {
      score += 80;
    } else if (baseAlbum.startsWith(baseTitle + ' ') || normAlbum.startsWith(baseTitle + ' ')) {
      score += 65;
    } else if (normAlbum.includes(baseTitle)) {
      score += 45;
    }
  }

  return score;
}

export function harmonizeCanonicalSongCovers(results: SearchResult[]): SearchResult[] {
  if (!Array.isArray(results) || results.length <= 1) return results;

  const bestByGroup = new Map<
    string,
    { image: string; album: string; score: number }
  >();

  for (const item of results) {
    if (!item || !item.image) continue;
    const baseTitle = extractBaseSongHeadline(item.name);
    const primaryArtist = getPhoneticArtistKey(item.artist);
    if (!baseTitle || !primaryArtist) continue;
    const partOrder = extractPartOrder(item.name);
    const partGroup = partOrder >= 2 ? partOrder : 1;
    const groupKey = `${baseTitle}|${primaryArtist}|${partGroup}`;

    const score = scoreCoverAuthenticity(item);
    const existing = bestByGroup.get(groupKey);
    if (!existing || score > existing.score) {
      bestByGroup.set(groupKey, {
        image: item.image,
        album: item.album,
        score,
      });
    }
  }

  return results.map((item) => {
    if (getTrackSearchCategory(item) === 'Hi-Res Lossless') return item;
    const baseTitle = extractBaseSongHeadline(item.name);
    const primaryArtist = getPhoneticArtistKey(item.artist);
    if (!baseTitle || !primaryArtist) return item;

    const partOrder = extractPartOrder(item.name);
    const partGroup = partOrder >= 2 ? partOrder : 1;
    const groupKey = `${baseTitle}|${primaryArtist}|${partGroup}`;
    const best = bestByGroup.get(groupKey);
    if (!best || best.score < 35) return item;

    const ownScore = scoreCoverAuthenticity(item);
    if (ownScore < 0 || (best.score >= 85 && ownScore < 50 && item.image !== best.image)) {
      return {
        ...item,
        image: best.image,
      };
    }
    return item;
  });
}
