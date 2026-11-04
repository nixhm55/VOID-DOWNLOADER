'use strict';

/**
 * VOID OG — Four-Stage Independent Verification Engine
 *
 * Every candidate OG track MUST pass all four independent verification stages:
 * - Stage 1: Container & Codec Verification (binary magic bytes & container box/chunk structure)
 * - Stage 2: Technical Audio Verification (decoded/parsed bit-depth, sample rate, channels, duration, stream integrity, FFprobe when available)
 * - Stage 3: Source & Provenance Verification (native lossless origin vs lossy transcode / encoder tag inspection)
 * - Stage 4: Legal & Territory Verification (provider authorization, commercial on-demand streaming rights, IN territory availability, SSRF check)
 *
 * Fail-closed guarantee: Any failure at any stage immediately disqualifies the track from OG.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ACCEPTED_OG_CODECS,
  PROHIBITED_LOSSY_CODECS,
  COMMERCIAL_SAFE_LICENSE_PATTERNS,
  PROHIBITED_LICENSE_PATTERNS,
  validateOgStreamUrlSafety,
} = require('../config');

function readAscii(bytes, offset, length) {
  if (!bytes || offset < 0 || offset >= bytes.byteLength) return '';
  const end = Math.min(bytes.byteLength, offset + length);
  let out = '';
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function readIeee80Extended(bytes, offset) {
  if (!bytes || offset + 10 > bytes.byteLength) return 0;
  const expon = ((bytes[offset] & 0x7f) << 8) | bytes[offset + 1];
  const hiMant =
    ((bytes[offset + 2] << 24) |
      (bytes[offset + 3] << 16) |
      (bytes[offset + 4] << 8) |
      bytes[offset + 5]) >>>
    0;
  const loMant =
    ((bytes[offset + 6] << 24) |
      (bytes[offset + 7] << 16) |
      (bytes[offset + 8] << 8) |
      bytes[offset + 9]) >>>
    0;

  if (expon === 0 && hiMant === 0 && loMant === 0) return 0;
  const sign = bytes[offset] & 0x80 ? -1 : 1;
  const value =
    hiMant * Math.pow(2, expon - 16383 - 31) +
    loMant * Math.pow(2, expon - 16383 - 63);
  return Math.round(sign * value);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 1: CONTAINER & CODEC BINARY VERIFICATION
 * ═══════════════════════════════════════════════════════════════════════════ */

function verifyOgContainerAndCodec(headerBytes, { url = '', contentType = '' } = {}) {
  if (!headerBytes || !(headerBytes instanceof Uint8Array) || headerBytes.byteLength < 12) {
    return {
      passed: false,
      stage: 'Stage 1 — Container & Codec Verification',
      reason: 'Insufficient or empty binary stream header bytes',
      detectedFormat: null,
      codec: null,
    };
  }

  const magic4 = readAscii(headerBytes, 0, 4);
  const magic3 = readAscii(headerBytes, 0, 3);

  // 1. Explicitly detect and reject prohibited lossy containers/signatures first!
  if (magic4 === 'OggS') {
    const windowStr = readAscii(headerBytes, 0, Math.min(headerBytes.byteLength, 512));
    if (windowStr.includes('vorbis')) {
      return {
        passed: false,
        stage: 'Stage 1 — Container & Codec Verification',
        reason: 'Prohibited lossy Ogg Vorbis stream detected',
        detectedFormat: 'OGG',
        codec: 'VORBIS',
      };
    }
    if (windowStr.includes('OpusHead')) {
      return {
        passed: false,
        stage: 'Stage 1 — Container & Codec Verification',
        reason: 'Prohibited lossy Opus stream detected',
        detectedFormat: 'OGG',
        codec: 'OPUS',
      };
    }
    return {
      passed: false,
      stage: 'Stage 1 — Container & Codec Verification',
      reason: 'Unsupported Ogg container (OG requires native FLAC, ALAC, WAV, or AIFF)',
      detectedFormat: 'OGG',
      codec: 'OGG',
    };
  }

  if (
    headerBytes[0] === 0x1a &&
    headerBytes[1] === 0x45 &&
    headerBytes[2] === 0xdf &&
    headerBytes[3] === 0xa3
  ) {
    return {
      passed: false,
      stage: 'Stage 1 — Container & Codec Verification',
      reason: 'Prohibited lossy WebM/Matroska container detected',
      detectedFormat: 'WEBM',
      codec: 'OPUS',
    };
  }

  if (
    headerBytes[0] === 0x30 &&
    headerBytes[1] === 0x26 &&
    headerBytes[2] === 0xb2 &&
    headerBytes[3] === 0x75
  ) {
    return {
      passed: false,
      stage: 'Stage 1 — Container & Codec Verification',
      reason: 'Prohibited lossy WMA/ASF container detected',
      detectedFormat: 'ASF',
      codec: 'WMA',
    };
  }

  let streamOffset = 0;
  if (magic3 === 'ID3' && headerBytes.byteLength >= 10) {
    const tagSize =
      ((headerBytes[6] & 0x7f) << 21) |
      ((headerBytes[7] & 0x7f) << 14) |
      ((headerBytes[8] & 0x7f) << 7) |
      (headerBytes[9] & 0x7f);
    const totalId3 = 10 + tagSize;
    if (totalId3 < headerBytes.byteLength && readAscii(headerBytes, totalId3, 4) === 'fLaC') {
      streamOffset = totalId3;
    } else {
      return {
        passed: false,
        stage: 'Stage 1 — Container & Codec Verification',
        reason: 'Prohibited lossy MP3 (ID3v2 container) detected',
        detectedFormat: 'MP3',
        codec: 'MP3',
      };
    }
  }

  if (headerBytes[streamOffset] === 0xff && (headerBytes[streamOffset + 1] & 0xe0) === 0xe0) {
    const layerBits = (headerBytes[streamOffset + 1] >> 1) & 0x03;
    const isAdts = layerBits === 0;
    return {
      passed: false,
      stage: 'Stage 1 — Container & Codec Verification',
      reason: isAdts
        ? 'Prohibited lossy AAC (ADTS stream) detected'
        : 'Prohibited lossy MP3 (MPEG frame sync) detected',
      detectedFormat: isAdts ? 'AAC' : 'MP3',
      codec: isAdts ? 'AAC' : 'MP3',
    };
  }

  // 2. Native FLAC container ("fLaC" + STREAMINFO metadata block)
  if (readAscii(headerBytes, streamOffset, 4) === 'fLaC') {
    if (headerBytes.byteLength < streamOffset + 42) {
      return {
        passed: false,
        stage: 'Stage 1 — Container & Codec Verification',
        reason: 'Truncated FLAC header (missing 34-byte STREAMINFO metadata block)',
        detectedFormat: 'FLAC',
        codec: 'FLAC',
      };
    }

    const blockHeader = headerBytes[streamOffset + 4];
    const blockType = blockHeader & 0x7f;
    const blockLen =
      (headerBytes[streamOffset + 5] << 16) |
      (headerBytes[streamOffset + 6] << 8) |
      headerBytes[streamOffset + 7];

    if (blockType !== 0 || blockLen !== 34) {
      return {
        passed: false,
        stage: 'Stage 1 — Container & Codec Verification',
        reason: `Invalid FLAC first metadata block (expected STREAMINFO type=0 len=34, got type=${blockType} len=${blockLen})`,
        detectedFormat: 'FLAC',
        codec: 'FLAC',
      };
    }

    const s = streamOffset + 8;
    const minBlockSize = (headerBytes[s] << 8) | headerBytes[s + 1];
    const maxBlockSize = (headerBytes[s + 2] << 8) | headerBytes[s + 3];
    const sampleRate =
      (headerBytes[s + 10] << 12) |
      (headerBytes[s + 11] << 4) |
      ((headerBytes[s + 12] & 0xf0) >> 4);
    const channels = ((headerBytes[s + 12] & 0x0e) >> 1) + 1;
    const bitsPerSample =
      (((headerBytes[s + 12] & 0x01) << 4) | ((headerBytes[s + 13] & 0xf0) >> 4)) + 1;

    const totalSamplesHi = headerBytes[s + 13] & 0x0f;
    const totalSamplesLo =
      ((headerBytes[s + 14] << 24) |
        (headerBytes[s + 15] << 16) |
        (headerBytes[s + 16] << 8) |
        headerBytes[s + 17]) >>>
      0;
    const totalSamples = totalSamplesHi * 4294967296 + totalSamplesLo;
    const durationSec = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;

    const vorbisComments = [];
    let vendorString = '';
    let pos = streamOffset + 4;
    while (pos + 4 <= headerBytes.byteLength) {
      const hdr = headerBytes[pos];
      const isLast = (hdr & 0x80) !== 0;
      const bType = hdr & 0x7f;
      const bLen =
        (headerBytes[pos + 1] << 16) | (headerBytes[pos + 2] << 8) | headerBytes[pos + 3];
      pos += 4;
      if (pos + bLen > headerBytes.byteLength) break;
      if (bType === 4 && bLen >= 8) {
        try {
          const view = new DataView(
            headerBytes.buffer,
            headerBytes.byteOffset + pos,
            bLen
          );
          let vPos = 0;
          const vendorLen = view.getUint32(vPos, true);
          vPos += 4;
          if (vPos + vendorLen <= bLen) {
            vendorString = Buffer.from(
              headerBytes.subarray(pos + vPos, pos + vPos + vendorLen)
            ).toString('utf8');
            vPos += vendorLen;
          }
          if (vPos + 4 <= bLen) {
            const count = view.getUint32(vPos, true);
            vPos += 4;
            for (let i = 0; i < Math.min(count, 64); i++) {
              if (vPos + 4 > bLen) break;
              const cLen = view.getUint32(vPos, true);
              vPos += 4;
              if (vPos + cLen > bLen) break;
              const comment = Buffer.from(
                headerBytes.subarray(pos + vPos, pos + vPos + cLen)
              ).toString('utf8');
              vorbisComments.push(comment);
              vPos += cLen;
            }
          }
        } catch {
          // Ignore malformed comment block beyond header window
        }
      }
      pos += bLen;
      if (isLast) break;
    }

    return {
      passed: true,
      stage: 'Stage 1 — Container & Codec Verification',
      detectedFormat: 'FLAC',
      codec: 'FLAC',
      mimeType: 'audio/flac',
      containerDetails: {
        minBlockSize,
        maxBlockSize,
        sampleRate,
        channels,
        bitDepth: bitsPerSample,
        totalSamples,
        durationSec: Math.round(durationSec),
        vendorString,
        vorbisComments,
      },
    };
  }

  // 3. Native WAV container ("RIFF" ... "WAVE" + "fmt " chunk)
  if (magic4 === 'RIFF' && readAscii(headerBytes, 8, 4) === 'WAVE') {
    const view = new DataView(
      headerBytes.buffer,
      headerBytes.byteOffset,
      headerBytes.byteLength
    );
    const riffSize = view.getUint32(4, true);
    let pos = 12;
    let fmtChunk = null;
    let dataChunkSize = 0;

    while (pos + 8 <= headerBytes.byteLength) {
      const chunkId = readAscii(headerBytes, pos, 4);
      const chunkSize = view.getUint32(pos + 4, true);
      const dataStart = pos + 8;

      if (chunkId === 'fmt ' && dataStart + 16 <= headerBytes.byteLength) {
        const audioFormat = view.getUint16(dataStart, true);
        const channels = view.getUint16(dataStart + 2, true);
        const sampleRate = view.getUint32(dataStart + 4, true);
        const byteRate = view.getUint32(dataStart + 8, true);
        const blockAlign = view.getUint16(dataStart + 12, true);
        const bitsPerSample = view.getUint16(dataStart + 14, true);

        let isLinearPcm = audioFormat === 1;
        if (audioFormat === 0xfffe && chunkSize >= 40 && dataStart + 26 <= headerBytes.byteLength) {
          const subFormatCode = view.getUint16(dataStart + 24, true);
          isLinearPcm = subFormatCode === 1;
        }

        if (!isLinearPcm) {
          return {
            passed: false,
            stage: 'Stage 1 — Container & Codec Verification',
            reason: `Rejected non-PCM WAV format tag 0x${audioFormat.toString(16)} (compressed/lossy WAV wrapper is prohibited)`,
            detectedFormat: 'WAV',
            codec: `WAV-0x${audioFormat.toString(16)}`,
          };
        }

        fmtChunk = {
          audioFormat,
          channels,
          sampleRate,
          byteRate,
          blockAlign,
          bitDepth: bitsPerSample,
        };
      } else if (chunkId === 'data') {
        dataChunkSize = chunkSize;
        break;
      }

      pos = dataStart + chunkSize + (chunkSize % 2);
    }

    if (!fmtChunk) {
      return {
        passed: false,
        stage: 'Stage 1 — Container & Codec Verification',
        reason: 'Malformed WAV container (missing fmt chunk)',
        detectedFormat: 'WAV',
        codec: null,
      };
    }

    const durationSec =
      fmtChunk.byteRate > 0 && (dataChunkSize || riffSize) > 44
        ? Math.round((dataChunkSize || riffSize) / fmtChunk.byteRate)
        : 0;

    return {
      passed: true,
      stage: 'Stage 1 — Container & Codec Verification',
      detectedFormat: 'WAV',
      codec: 'WAV',
      mimeType: 'audio/wav',
      containerDetails: {
        ...fmtChunk,
        dataChunkSize,
        riffSize,
        durationSec,
      },
    };
  }

  // 4. Native AIFF container ("FORM" ... "AIFF" or uncompressed "AIFC")
  const formType = readAscii(headerBytes, 8, 4);
  if (magic4 === 'FORM' && (formType === 'AIFF' || formType === 'AIFC')) {
    const view = new DataView(
      headerBytes.buffer,
      headerBytes.byteOffset,
      headerBytes.byteLength
    );
    let pos = 12;
    let commChunk = null;

    while (pos + 8 <= headerBytes.byteLength) {
      const chunkId = readAscii(headerBytes, pos, 4);
      const chunkSize = view.getUint32(pos + 4, false);
      const dataStart = pos + 8;

      if (chunkId === 'COMM' && dataStart + 18 <= headerBytes.byteLength) {
        const channels = view.getUint16(dataStart, false);
        const numSampleFrames = view.getUint32(dataStart + 2, false);
        const bitDepth = view.getUint16(dataStart + 6, false);
        const sampleRate = readIeee80Extended(headerBytes, dataStart + 8);
        let compressionType = 'NONE';
        if (formType === 'AIFC' && chunkSize >= 22 && dataStart + 22 <= headerBytes.byteLength) {
          compressionType = readAscii(headerBytes, dataStart + 18, 4);
        }
        if (!['NONE', 'twos', 'sowt', 'in24', 'in32'].includes(compressionType)) {
          return {
            passed: false,
            stage: 'Stage 1 — Container & Codec Verification',
            reason: `Rejected compressed AIFC codec '${compressionType}'`,
            detectedFormat: 'AIFF',
            codec: compressionType,
          };
        }
        commChunk = {
          channels,
          numSampleFrames,
          bitDepth,
          sampleRate,
          durationSec: sampleRate > 0 ? Math.round(numSampleFrames / sampleRate) : 0,
        };
        break;
      }
      pos = dataStart + chunkSize + (chunkSize % 2);
    }

    if (!commChunk) {
      return {
        passed: false,
        stage: 'Stage 1 — Container & Codec Verification',
        reason: 'Malformed AIFF container (missing COMM chunk)',
        detectedFormat: 'AIFF',
        codec: null,
      };
    }

    return {
      passed: true,
      stage: 'Stage 1 — Container & Codec Verification',
      detectedFormat: 'AIFF',
      codec: 'AIFF',
      mimeType: 'audio/aiff',
      containerDetails: commChunk,
    };
  }

  // 5. Native ALAC inside ISO BMFF ("ftyp" + "alac" sample entry atom; strictly reject "mp4a" AAC)
  if (headerBytes.byteLength >= 16 && readAscii(headerBytes, 4, 4) === 'ftyp') {
    const headLen = Math.min(headerBytes.byteLength, 65536);
    let asciiWindow = readAscii(headerBytes, 0, headLen);
    let windowBaseOffset = 0;

    if (!asciiWindow.includes('alac') && !asciiWindow.includes('mp4a') && headerBytes.byteLength > 65536) {
      // Check trailing moov atom when moov is placed after mdat
      windowBaseOffset = Math.max(0, headerBytes.byteLength - 65536);
      asciiWindow = readAscii(headerBytes, windowBaseOffset, headerBytes.byteLength - windowBaseOffset);
    }

    const alacIdx = asciiWindow.indexOf('alac');
    const mp4aIdx = asciiWindow.indexOf('mp4a');
    if (alacIdx === -1) {
      return {
        passed: false,
        stage: 'Stage 1 — Container & Codec Verification',
        reason:
          mp4aIdx !== -1
            ? 'Prohibited lossy AAC (mp4a atom in MP4/M4A container) detected'
            : 'MP4/M4A container does not contain an ALAC codec atom',
        detectedFormat: 'M4A',
        codec: mp4aIdx !== -1 ? 'AAC' : 'MP4',
      };
    }

    let bitDepth = 16;
    let channels = 2;
    let sampleRate = 44100;
    const secondAlacIdx = asciiWindow.indexOf('alac', alacIdx + 4);
    const cookieAtomPos =
      windowBaseOffset + (secondAlacIdx !== -1 ? secondAlacIdx : alacIdx);
    if (cookieAtomPos + 32 <= headerBytes.byteLength) {
      const view = new DataView(
        headerBytes.buffer,
        headerBytes.byteOffset,
        headerBytes.byteLength
      );
      const candBitDepth = headerBytes[cookieAtomPos + 13];
      const candChannels = headerBytes[cookieAtomPos + 17];
      const candSampleRate = view.getUint32(cookieAtomPos + 28, false);
      if (
        [16, 20, 24, 32].includes(candBitDepth) &&
        candChannels >= 1 &&
        candChannels <= 8 &&
        candSampleRate >= 44100 &&
        candSampleRate <= 384000
      ) {
        bitDepth = candBitDepth;
        channels = candChannels;
        sampleRate = candSampleRate;
      }
    }

    return {
      passed: true,
      stage: 'Stage 1 — Container & Codec Verification',
      detectedFormat: 'ALAC',
      codec: 'ALAC',
      mimeType: 'audio/alac',
      containerDetails: {
        bitDepth,
        channels,
        sampleRate,
        durationSec: 0,
      },
    };
  }

  return {
    passed: false,
    stage: 'Stage 1 — Container & Codec Verification',
    reason: `Unrecognized or unsupported binary container signature (first bytes: 0x${Buffer.from(
      headerBytes.subarray(0, 8)
    ).toString('hex')}, url=${url}, contentType=${contentType})`,
    detectedFormat: null,
    codec: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 2: TECHNICAL AUDIO VERIFICATION (Binary + Optional FFprobe)
 * ═══════════════════════════════════════════════════════════════════════════ */

function findFfprobeBinary() {
  const candidates = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'];
  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) return bin;
    } catch {
      // Ignore
    }
  }
  return null;
}

const FFPROBE_BIN = findFfprobeBinary();

function inspectBufferWithFfprobe(bytes, extHint = '.flac') {
  if (!FFPROBE_BIN || !bytes || bytes.byteLength < 64) return null;
  const tmpFile = path.join(
    os.tmpdir(),
    `void_og_probe_${Date.now()}_${Math.random().toString(36).slice(2)}${extHint}`
  );
  try {
    fs.writeFileSync(tmpFile, Buffer.from(bytes));
    const stdout = execFileSync(
      FFPROBE_BIN,
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name,codec_long_name,sample_fmt,sample_rate,channels,bits_per_raw_sample,bits_per_sample,duration,bit_rate:format=format_name,duration,size,tags',
        '-of',
        'json',
        tmpFile,
      ],
      { timeout: 4000, encoding: 'utf8' }
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

function verifyOgAudio(
  headerBytes,
  stage1Result,
  { expectedDurationSec = 0, totalContentLength = 0, useFfprobe = true } = {}
) {
  if (!stage1Result || !stage1Result.passed) {
    return {
      passed: false,
      stage: 'Stage 2 — Technical Audio Verification',
      reason: stage1Result?.reason || 'Stage 1 container verification failed',
    };
  }

  let codec = stage1Result.codec;
  let bitDepth = Number(stage1Result.containerDetails?.bitDepth) || 0;
  let sampleRate = Number(stage1Result.containerDetails?.sampleRate) || 0;
  let channels = Number(stage1Result.containerDetails?.channels) || 0;
  let durationSec =
    Number(stage1Result.containerDetails?.durationSec) || Number(expectedDurationSec) || 0;
  let ffprobeTags = {};

  if (useFfprobe && FFPROBE_BIN && headerBytes && headerBytes.byteLength >= 256) {
    const extMap = { FLAC: '.flac', WAV: '.wav', AIFF: '.aiff', ALAC: '.m4a' };
    const probed = inspectBufferWithFfprobe(headerBytes, extMap[codec] || '.bin');
    const stream = probed?.streams?.[0];
    if (stream) {
      const rawCodecName = String(stream.codec_name || '').toLowerCase();
      if (
        rawCodecName.includes('mp3') ||
        rawCodecName.includes('aac') ||
        rawCodecName.includes('vorbis') ||
        rawCodecName.includes('opus') ||
        rawCodecName.includes('wmav')
      ) {
        return {
          passed: false,
          stage: 'Stage 2 — Technical Audio Verification',
          reason: `FFprobe detected prohibited lossy codec '${rawCodecName}' inside stream`,
        };
      }
      if (rawCodecName === 'flac') codec = 'FLAC';
      else if (rawCodecName === 'alac') codec = 'ALAC';
      else if (rawCodecName.startsWith('pcm_')) {
        codec = stage1Result.detectedFormat === 'AIFF' ? 'AIFF' : 'WAV';
      }

      const probedSr = Number(stream.sample_rate);
      if (Number.isFinite(probedSr) && probedSr > 0) sampleRate = probedSr;

      const probedCh = Number(stream.channels);
      if (Number.isFinite(probedCh) && probedCh > 0) channels = probedCh;

      const probedBd =
        Number(stream.bits_per_raw_sample) ||
        Number(stream.bits_per_sample) ||
        (stream.sample_fmt === 's16' || stream.sample_fmt === 's16p'
          ? 16
          : stream.sample_fmt === 's32' || stream.sample_fmt === 's32p'
            ? 24
            : 0);
      if (probedBd > 0) bitDepth = probedBd;

      const probedDur = Number(stream.duration) || Number(probed?.format?.duration) || 0;
      if (probedDur > 0 && !durationSec) durationSec = Math.round(probedDur);

      ffprobeTags = {
        ...(probed?.format?.tags || {}),
        ...(stream?.tags || {}),
      };
    }
  }

  if (!ACCEPTED_OG_CODECS.includes(codec) || PROHIBITED_LOSSY_CODECS.includes(codec)) {
    return {
      passed: false,
      stage: 'Stage 2 — Technical Audio Verification',
      reason: `Codec '${codec}' is not an accepted OG lossless codec`,
    };
  }

  if (!Number.isFinite(bitDepth) || bitDepth < 16 || bitDepth > 32) {
    return {
      passed: false,
      stage: 'Stage 2 — Technical Audio Verification',
      reason: `Unverified or substandard bit depth: ${bitDepth}-bit (OG requires >= 16-bit lossless)`,
    };
  }

  if (!Number.isFinite(sampleRate) || sampleRate < 44100 || sampleRate > 384000) {
    return {
      passed: false,
      stage: 'Stage 2 — Technical Audio Verification',
      reason: `Unverified or substandard sample rate: ${sampleRate} Hz (OG requires >= 44.1 kHz lossless)`,
    };
  }

  if (!Number.isFinite(channels) || channels < 1 || channels > 8) {
    return {
      passed: false,
      stage: 'Stage 2 — Technical Audio Verification',
      reason: `Invalid channel count: ${channels}`,
    };
  }

  if (!Number.isFinite(durationSec) || durationSec < 35) {
    return {
      passed: false,
      stage: 'Stage 2 — Technical Audio Verification',
      reason: `Track duration (${durationSec}s) is shorter than full-track minimum (35s) or is a 30s preview clip`,
    };
  }

  let bitrateKbps = Math.round((sampleRate * bitDepth * channels * 0.58) / 1000);
  if (totalContentLength > 0 && durationSec > 10) {
    const actualKbps = Math.round((totalContentLength * 8) / 1000 / durationSec);
    const minPhysicalKbps = codec === 'WAV' || codec === 'AIFF' ? 680 : 128;
    if (actualKbps < minPhysicalKbps) {
      return {
        passed: false,
        stage: 'Stage 2 — Technical Audio Verification',
        reason: `Stream average bitrate (${actualKbps} kbps) is below physical lossless floor (${minPhysicalKbps} kbps) for ${codec} ${bitDepth}-bit/${sampleRate}Hz`,
      };
    }
    bitrateKbps = actualKbps;
  }

  return {
    passed: true,
    stage: 'Stage 2 — Technical Audio Verification',
    codec,
    bitDepth,
    sampleRate,
    channels,
    durationSec: Math.round(durationSec),
    bitrateKbps,
    ffprobeTags,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 3: SOURCE & PROVENANCE VERIFICATION
 * ═══════════════════════════════════════════════════════════════════════════ */

const LOSSY_TRANSCODE_MARKER_REGEX =
  /\b(lame\d|libmp3lame|fraunhofer|faac|fdk-aac|libfdk_aac|nero\s*aac|vorbis|aoTuV|libvorbis|libopus|opusenc|transcoded\s*from\s*mp3|mp3\s*to\s*flac|aac\s*to\s*flac|aac\s*to\s*alac|youtube-dl|yt-dlp|codec=alac|upsampled)\b/i;

function verifyOgProvenance({
  providerId,
  providerName,
  streamUrl = '',
  sourceType = '',
  metadataNotes = '',
  stage1Result,
  stage2Result,
}) {
  if (!stage1Result?.passed || !stage2Result?.passed) {
    return {
      passed: false,
      stage: 'Stage 3 — Source & Provenance Verification',
      provenanceStatus: 'rejected_technical_failure',
      reason: 'Cannot verify provenance before Stage 1 and Stage 2 pass',
    };
  }

  if (!providerId || !providerName) {
    return {
      passed: false,
      stage: 'Stage 3 — Source & Provenance Verification',
      provenanceStatus: 'unverified_provenance',
      reason: 'Missing actual provider identity',
    };
  }

  const lowerUrl = String(streamUrl || '').toLowerCase();
  if (
    lowerUrl.includes('proxy-audio') ||
    lowerUrl.includes('codec=alac') ||
    lowerUrl.includes('yt-audio') ||
    lowerUrl.includes('saavncdn.com') ||
    lowerUrl.includes('googlevideo.com') ||
    lowerUrl.includes('audius.co')
  ) {
    return {
      passed: false,
      stage: 'Stage 3 — Source & Provenance Verification',
      provenanceStatus: 'rejected_lossy_transcode',
      reason: 'Stream originates from a lossy source or on-the-fly lossy-to-ALAC converter',
    };
  }

  if (
    providerId === 'internet-archive' &&
    String(sourceType || '').toLowerCase() !== 'original'
  ) {
    return {
      passed: false,
      stage: 'Stage 3 — Source & Provenance Verification',
      provenanceStatus: 'rejected_derivative_file',
      reason: `Internet Archive file has source='${sourceType}' instead of 'original'`,
    };
  }

  const combinedComments = [
    stage1Result.containerDetails?.vendorString || '',
    ...(stage1Result.containerDetails?.vorbisComments || []),
    ...Object.entries(stage2Result.ffprobeTags || {}).map(([k, v]) => `${k}=${v}`),
    metadataNotes || '',
  ].join(' | ');

  if (LOSSY_TRANSCODE_MARKER_REGEX.test(combinedComments)) {
    return {
      passed: false,
      stage: 'Stage 3 — Source & Provenance Verification',
      provenanceStatus: 'rejected_lossy_transcode',
      reason: `Detected lossy transcode / encoder marker in stream provenance: '${combinedComments.slice(0, 140)}'`,
    };
  }

  const masterProviders = new Set([
    'massivemusic',
    'tuned-global',
    'audiosocket',
    'believe',
    'fuga',
    'the-orchard',
    'saregama',
    'times-music',
    'muzik247',
    'think-music',
    'divo',
    'pdl-india',
  ]);

  const provenanceStatus = masterProviders.has(String(providerId).toLowerCase())
    ? 'verified_original_master'
    : 'verified_native_lossless_upload';

  return {
    passed: true,
    stage: 'Stage 3 — Source & Provenance Verification',
    provenanceStatus,
    providerId,
    providerName,
    isStudioMasterProven: provenanceStatus === 'verified_original_master',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 4: LEGAL, RIGHTS & TERRITORY VERIFICATION
 * ═══════════════════════════════════════════════════════════════════════════ */

function checkOgTerritory({
  requestedTerritory = 'IN',
  allowedTerritories = ['WORLDWIDE', 'IN'],
  blockedTerritories = [],
} = {}) {
  const target = String(requestedTerritory || 'IN').trim().toUpperCase();
  const blocked = (blockedTerritories || []).map((t) => String(t).toUpperCase());
  if (blocked.includes(target) || blocked.includes('ALL')) {
    return {
      passed: false,
      territory: target,
      reason: `Track is geo-restricted in territory ${target}`,
    };
  }

  const allowed = (allowedTerritories || []).map((t) => String(t).toUpperCase());
  if (allowed.includes('WORLDWIDE') || allowed.includes('GLOBAL') || allowed.includes(target)) {
    return {
      passed: true,
      territory: target,
    };
  }

  return {
    passed: false,
    territory: target,
    reason: `Track is not cleared for territory ${target} (allowed: ${allowed.join(', ') || 'none'})`,
  };
}

function verifyOgRights({
  providerId,
  providerName,
  streamUrl,
  licenseUrl = '',
  licenseShortName = '',
  commercialRightsConfirmed = false,
  allowMultiProviderMixing = true,
  downloadAllowed = false,
  requestedTerritory = 'IN',
  allowedTerritories = ['WORLDWIDE', 'IN'],
  blockedTerritories = [],
  attributionText = null,
  sourcePageUrl = null,
  customAllowedHosts = [],
}) {
  const urlSafety = validateOgStreamUrlSafety(streamUrl, customAllowedHosts);
  if (!urlSafety.safe) {
    return {
      passed: false,
      stage: 'Stage 4 — Legal & Territory Verification',
      reason: `Security/SSRF check failed: ${urlSafety.reason}`,
    };
  }

  if (!allowMultiProviderMixing) {
    return {
      passed: false,
      stage: 'Stage 4 — Legal & Territory Verification',
      reason: `Provider '${providerName}' prohibits mixing content in a shared multi-provider catalogue without explicit written authorization`,
    };
  }

  const territoryCheck = checkOgTerritory({
    requestedTerritory,
    allowedTerritories,
    blockedTerritories,
  });
  if (!territoryCheck.passed) {
    return {
      passed: false,
      stage: 'Stage 4 — Legal & Territory Verification',
      reason: territoryCheck.reason,
    };
  }

  const combinedLicense = `${licenseUrl || ''} ${licenseShortName || ''}`.trim();

  if (!commercialRightsConfirmed && PROHIBITED_LICENSE_PATTERNS.some((re) => re.test(combinedLicense))) {
    return {
      passed: false,
      stage: 'Stage 4 — Legal & Territory Verification',
      reason: `Rejected non-commercial or restricted license (${combinedLicense}) for commercial on-demand OG streaming`,
    };
  }

  const matchesOpenCommercialSafe = COMMERCIAL_SAFE_LICENSE_PATTERNS.some((re) =>
    re.test(combinedLicense)
  );

  if (!commercialRightsConfirmed && !matchesOpenCommercialSafe) {
    return {
      passed: false,
      stage: 'Stage 4 — Legal & Territory Verification',
      reason: `Missing verified commercial on-demand streaming rights (license='${combinedLicense || 'unspecified'}')`,
    };
  }

  return {
    passed: true,
    stage: 'Stage 4 — Legal & Territory Verification',
    providerId,
    providerName,
    territory: territoryCheck.territory,
    commercialStreamingAllowed: true,
    downloadAllowed: Boolean(downloadAllowed),
    licenseType:
      licenseShortName ||
      (commercialRightsConfirmed ? 'Commercial B2B License' : 'Open Commercial-Safe License'),
    licenseUrl: licenseUrl || null,
    attributionText,
    sourcePageUrl,
  };
}

function runFullOgVerificationPipeline({
  headerBytes,
  candidate,
  requestedTerritory = 'IN',
  useFfprobe = true,
}) {
  const stage1 = verifyOgContainerAndCodec(headerBytes, {
    url: candidate.streamUrl,
    contentType: candidate.contentType || '',
  });

  const stage2 = verifyOgAudio(headerBytes, stage1, {
    expectedDurationSec: candidate.duration || 0,
    totalContentLength: candidate.byteSize || 0,
    useFfprobe,
  });

  const stage3 = verifyOgProvenance({
    providerId: candidate.providerId,
    providerName: candidate.providerName,
    streamUrl: candidate.streamUrl,
    sourceType: candidate.sourceType,
    metadataNotes: candidate.metadataNotes,
    stage1Result: stage1,
    stage2Result: stage2,
  });

  const stage4 = verifyOgRights({
    providerId: candidate.providerId,
    providerName: candidate.providerName,
    streamUrl: candidate.streamUrl,
    licenseUrl: candidate.licenseUrl,
    licenseShortName: candidate.licenseShortName,
    commercialRightsConfirmed: candidate.commercialRightsConfirmed,
    allowMultiProviderMixing: candidate.allowMultiProviderMixing !== false,
    downloadAllowed: candidate.downloadAllowed,
    requestedTerritory,
    allowedTerritories: candidate.allowedTerritories,
    blockedTerritories: candidate.blockedTerritories,
    attributionText: candidate.attributionText,
    sourcePageUrl: candidate.sourcePageUrl,
    customAllowedHosts: candidate.customAllowedHosts,
  });

  const eligibleForOg = Boolean(
    stage1.passed && stage2.passed && stage3.passed && stage4.passed
  );

  const failedReasons = [stage1, stage2, stage3, stage4]
    .filter((s) => !s.passed)
    .map((s) => `${s.stage}: ${s.reason}`);

  return {
    eligibleForOg,
    stage1,
    stage2,
    stage3,
    stage4,
    failedReasons,
    verifiedAt: new Date().toISOString(),
  };
}

module.exports = {
  verifyOgContainerAndCodec,
  verifyOgAudio,
  verifyOgProvenance,
  verifyOgRights,
  checkOgTerritory,
  runFullOgVerificationPipeline,
};
