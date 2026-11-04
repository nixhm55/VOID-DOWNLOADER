'use strict';

/**
 * VOID OG — Independent Configuration, Allowlists & Security Policy
 *
 * Enforces strict separation from HIGH, VERY HIGH, and LOSSLESS sections.
 * Fail-closed allowlist architecture: ONLY native FLAC, ALAC, WAV, and AIFF are permitted.
 */

const ACCEPTED_OG_CODECS = Object.freeze(['FLAC', 'ALAC', 'WAV', 'AIFF']);

const ACCEPTED_OG_MIME_TYPES = Object.freeze([
  'audio/flac',
  'audio/x-flac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/aiff',
  'audio/x-aiff',
  'audio/alac',
  'audio/mp4',
  'audio/x-m4a',
]);

const PROHIBITED_LOSSY_CODECS = Object.freeze([
  'MP3',
  'MPEG',
  'AAC',
  'AAC-LC',
  'HE-AAC',
  'OGG',
  'VORBIS',
  'OPUS',
  'WMA',
  'WEBM',
  'AMR',
  'MP2',
  'AC3',
  'EAC3',
  'MUSEPACK',
]);

const ACCEPTED_SAMPLE_RATES = Object.freeze([
  44100,
  48000,
  88200,
  96000,
  176400,
  192000,
  352800,
  384000,
]);

const ACCEPTED_BIT_DEPTHS = Object.freeze([16, 24, 32]);

/**
 * Trusted delivery domains for OG stream resolution (SSRF protection).
 */
const ALLOWED_OG_STREAM_HOSTS = Object.freeze([
  'archive.org',
  'ia600000.us.archive.org',
  'ia800000.us.archive.org',
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'prod-1.storage.jamendo.com',
  'storage.jamendo.com',
  'api.jamendo.com',
  'stream.svc.7digital.net',
  'api.7digital.com',
  'media.geo.7digital.com',
  'api.tunedglobal.com',
  'stream.tunedglobal.com',
  'api.audiosocket.com',
  'www.qobuz.com',
  'streaming-qobuz-std.akamaized.net',
  'openapi.tidal.com',
]);

/**
 * Approved commercial-safe Creative Commons and Public Domain license URLs
 * for archival / independent providers (Internet Archive, Wikimedia Commons, Jamendo).
 */
const COMMERCIAL_SAFE_LICENSE_PATTERNS = Object.freeze([
  /creativecommons\.org\/publicdomain\/mark\/1\.0/i,
  /creativecommons\.org\/publicdomain\/zero\/1\.0/i,
  /creativecommons\.org\/licenses\/by\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)/i,
  /creativecommons\.org\/licenses\/by-sa\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)/i,
  /\b(cc0|public\s*domain|pd-old|pd-india|pd-us|cc-by-\d|cc\s+by\s+\d|cc-by-sa-\d|cc\s+by-sa\s+\d)\b/i,
]);

/**
 * Explicitly prohibited non-commercial or no-derivatives license patterns for commercial OG playback.
 */
const PROHIBITED_LICENSE_PATTERNS = Object.freeze([
  /creativecommons\.org\/licenses\/by-nc/i,
  /creativecommons\.org\/licenses\/by-nd/i,
  /creativecommons\.org\/licenses\/by-nc-nd/i,
  /creativecommons\.org\/licenses\/by-nc-sa/i,
  /\b(by-nc|cc-by-nc|non-commercial|noncommercial|no-derivatives|noderivs|sampling\+|all\s+rights\s+reserved)\b/i,
]);

/**
 * Reads environment configuration for all OG providers without fabricating credentials.
 */
function getOgEnvConfig(env = process.env) {
  return {
    defaultTerritory: String(env.OG_DEFAULT_TERRITORY || 'IN').trim().toUpperCase(),
    requireCommercialRights:
      String(env.OG_REQUIRE_COMMERCIAL_RIGHTS ?? 'true').toLowerCase() !== 'false',

    // 1. Internet Archive (Rights-Cleared Lossless Archives)
    internetArchive: {
      enabled: String(env.OG_ENABLE_INTERNET_ARCHIVE ?? 'true').toLowerCase() !== 'false',
      accessKey: String(env.INTERNET_ARCHIVE_ACCESS_KEY || '').trim(),
      secretKey: String(env.INTERNET_ARCHIVE_SECRET_KEY || '').trim(),
    },

    // 2. Wikimedia Commons (Rights-Cleared Lossless Archives: CC0 / PD / CC-BY / CC-BY-SA)
    wikimediaCommons: {
      enabled: String(env.OG_ENABLE_WIKIMEDIA_COMMONS ?? 'true').toLowerCase() !== 'false',
      userAgent:
        String(env.OG_WIKIMEDIA_USER_AGENT || '').trim() ||
        'VoidMusicPlayer-OG/1.0 (https://voidmusic.app; og-lossless@voidmusic.app)',
    },

    // 3. Jamendo v3.0 Official FLAC API
    jamendo: {
      clientId: String(env.JAMENDO_CLIENT_ID || env.VITE_JAMENDO_CLIENT_ID || '').trim(),
      commercialLicenseVerified:
        String(env.JAMENDO_COMMERCIAL_LICENSE_VERIFIED || 'false').toLowerCase() === 'true',
    },

    // 4. MassiveMusic / 7digital B2B FLAC API
    massiveMusic: {
      oauthConsumerKey: String(env.MASSIVEMUSIC_CLIENT_ID || env.SEVEN_DIGITAL_CONSUMER_KEY || '').trim(),
      oauthConsumerSecret: String(
        env.MASSIVEMUSIC_CLIENT_SECRET || env.SEVEN_DIGITAL_CONSUMER_SECRET || ''
      ).trim(),
      hdAgreementActive:
        String(env.MASSIVEMUSIC_HD_FLAC_ENABLED || 'false').toLowerCase() === 'true',
      territoryClearedIN:
        String(env.MASSIVEMUSIC_IN_TERRITORY_CLEARED || 'false').toLowerCase() === 'true',
    },

    // 5. Tuned Global B2B HD FLAC API
    tunedGlobal: {
      apiKey: String(env.TUNED_GLOBAL_API_KEY || '').trim(),
      storeId: String(env.TUNED_GLOBAL_STORE_ID || '').trim(),
      baseUrl: String(env.TUNED_GLOBAL_BASE_URL || 'https://api.tunedglobal.com').trim(),
      territoryClearedIN:
        String(env.TUNED_GLOBAL_IN_TERRITORY_CLEARED || 'false').toLowerCase() === 'true',
    },

    // 6. TIDAL (Strictly disabled for shared multi-provider OG playback unless written permission is granted)
    tidal: {
      clientId: String(env.TIDAL_CLIENT_ID || '').trim(),
      clientSecret: String(env.TIDAL_CLIENT_SECRET || '').trim(),
      writtenMultiProviderAuth:
        String(env.TIDAL_OG_WRITTEN_AUTHORIZATION || 'false').toLowerCase() === 'true',
      territoryClearedIN:
        String(env.TIDAL_IN_TERRITORY_CLEARED || 'false').toLowerCase() === 'true',
    },

    // 7. Qobuz Partner API
    qobuz: {
      appId: String(env.QOBUZ_CLIENT_ID || env.QOBUZ_APP_ID || '').trim(),
      appSecret: String(env.QOBUZ_CLIENT_SECRET || env.QOBUZ_APP_SECRET || '').trim(),
      partnerUserAuthToken: String(env.QOBUZ_USER_AUTH_TOKEN || '').trim(),
      commercialB2BLicense:
        String(env.QOBUZ_COMMERCIAL_B2B_LICENSE || 'false').toLowerCase() === 'true',
      territoryClearedIN:
        String(env.QOBUZ_IN_TERRITORY_CLEARED || 'false').toLowerCase() === 'true',
    },

    // 8. AudioSocket MaaS v5 Lossless API
    audioSocket: {
      apiToken: String(env.AUDIOSOCKET_API_TOKEN || '').trim(),
      commercialLicenseActive:
        String(env.AUDIOSOCKET_COMMERCIAL_LICENSE || 'false').toLowerCase() === 'true',
    },

    // 9. Global Distributors (DDEX ERN 4.3 / S3 / B2B Master Feeds)
    distributors: {
      believe: {
        ddexFeedUrl: String(env.BELIEVE_DDEX_FEED_URL || '').trim(),
        apiKey: String(env.BELIEVE_PARTNER_API_KEY || '').trim(),
        commercialDspContract:
          String(env.BELIEVE_COMMERCIAL_DSP_CONTRACT || 'false').toLowerCase() === 'true',
      },
      fuga: {
        apiUrl: String(env.FUGA_API_URL || '').trim(),
        apiToken: String(env.FUGA_API_TOKEN || '').trim(),
        commercialDspContract:
          String(env.FUGA_COMMERCIAL_DSP_CONTRACT || 'false').toLowerCase() === 'true',
      },
      theOrchard: {
        apiKey: String(env.THE_ORCHARD_API_KEY || '').trim(),
        ddexEndpoint: String(env.THE_ORCHARD_DDEX_ENDPOINT || '').trim(),
        commercialDspContract:
          String(env.THE_ORCHARD_COMMERCIAL_DSP_CONTRACT || 'false').toLowerCase() === 'true',
      },
      revelator: {
        bearerToken: String(env.REVELATOR_API_BEARER_TOKEN || '').trim(),
        commercialDspContract:
          String(env.REVELATOR_COMMERCIAL_DSP_CONTRACT || 'false').toLowerCase() === 'true',
      },
    },

    // 10. Indian Music Labels & Regional Aggregators (Malayalam, Tamil, Telugu, Hindi, Kannada, Punjabi, Bengali)
    indianLabels: {
      iprsIntrLicenseActive:
        String(env.IPRS_INDIA_INTR_LICENSE_ACTIVE || 'false').toLowerCase() === 'true',
      pdlIndia: {
        partnerKey: String(env.PDL_INDIA_PARTNER_KEY || '').trim(),
        feedUrl: String(env.PDL_INDIA_FEED_URL || '').trim(),
      },
      saregama: {
        partnerKey: String(env.SAREGAMA_PARTNER_KEY || '').trim(),
        feedUrl: String(env.SAREGAMA_MASTER_FEED_URL || '').trim(),
      },
      timesMusic: {
        partnerKey: String(env.TIMES_MUSIC_PARTNER_KEY || '').trim(),
        feedUrl: String(env.TIMES_MUSIC_MASTER_FEED_URL || '').trim(),
      },
      muzik247: {
        partnerKey: String(env.MUZIK247_PARTNER_KEY || '').trim(),
        feedUrl: String(env.MUZIK247_MASTER_FEED_URL || '').trim(),
      },
      thinkMusic: {
        partnerKey: String(env.THINK_MUSIC_PARTNER_KEY || '').trim(),
        feedUrl: String(env.THINK_MUSIC_MASTER_FEED_URL || '').trim(),
      },
      divo: {
        partnerKey: String(env.DIVO_PARTNER_KEY || '').trim(),
        feedUrl: String(env.DIVO_MASTER_FEED_URL || '').trim(),
      },
    },
  };
}

/**
 * SSRF & Trusted Host Validator for OG Audio Streams.
 */
function validateOgStreamUrlSafety(rawUrl, customAllowedHosts = []) {
  const clean = String(rawUrl || '').trim();
  if (!clean) {
    return { safe: false, reason: 'Empty stream URL' };
  }

  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return { safe: false, reason: 'Invalid URL syntax' };
  }

  if (parsed.protocol !== 'https:') {
    return { safe: false, reason: `Insecure protocol ${parsed.protocol} (HTTPS required for OG)` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject localhost, loopback, link-local, and private IPv4/IPv6 ranges (SSRF protection)
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    /^0\./.test(hostname)
  ) {
    return { safe: false, reason: `Blocked private/loopback host: ${hostname}` };
  }

  const allowedList = [...ALLOWED_OG_STREAM_HOSTS, ...customAllowedHosts];
  const isAllowedHost = allowedList.some(
    (allowed) =>
      hostname === allowed.toLowerCase() ||
      hostname.endsWith(`.${allowed.toLowerCase()}`) ||
      // Internet Archive dynamic storage cluster nodes (e.g. ia800501.us.archive.org)
      /\.archive\.org$/i.test(hostname) ||
      /\.wikimedia\.org$/i.test(hostname)
  );

  if (!isAllowedHost) {
    return {
      safe: false,
      reason: `Host ${hostname} is not on the OG approved lossless delivery allowlist`,
    };
  }

  return { safe: true, url: parsed.toString(), hostname };
}

module.exports = {
  ACCEPTED_OG_CODECS,
  ACCEPTED_OG_MIME_TYPES,
  PROHIBITED_LOSSY_CODECS,
  ACCEPTED_SAMPLE_RATES,
  ACCEPTED_BIT_DEPTHS,
  ALLOWED_OG_STREAM_HOSTS,
  COMMERCIAL_SAFE_LICENSE_PATTERNS,
  PROHIBITED_LICENSE_PATTERNS,
  getOgEnvConfig,
  validateOgStreamUrlSafety,
};
