import {
  computeAutoFitCoverScale,
  getStickyCoverUrl,
  isValidCoverUrl,
  rememberStickyCover,
  resolveAndLockTrackCover,
} from './coverProcessing';

/**
 * Renders any loaded cover image (or generates a sleek fallback cover when no remote artwork exists)
 * onto a 600x600 1:1 square JPEG canvas (cropping YouTube 16:9 / 4:3 letterbox bars automatically)
 * so every downloaded song file gets a standard baseline JPEG embedded directly into its audio container.
 */
async function renderSquareJpegCover(
  img: HTMLImageElement | ImageBitmap | null,
  track: any,
  sourceUrl?: string,
): Promise<{ blob: Blob; bytes: Uint8Array } | null> {
  if (typeof document === 'undefined') return null;
  const size = 600;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, size, size);

  if (img) {
    const w = 'naturalWidth' in img ? img.naturalWidth || img.width : img.width;
    const h = 'naturalHeight' in img ? img.naturalHeight || img.height : img.height;
    if (w > 0 && h > 0) {
      const scale =
        img instanceof HTMLImageElement
          ? computeAutoFitCoverScale(img, sourceUrl, track)
          : 1;
      const side = Math.min(w, h) / Math.max(1, scale);
      const sx = (w - side) * 0.5;
      const sy = (h - side) * 0.5;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    }
  } else {
    // Sleek dark vinyl cover fallback so a downloaded song is never blank in Finder
    const grad = ctx.createRadialGradient(size * 0.35, size * 0.3, 20, size * 0.5, size * 0.5, size * 0.75);
    grad.addColorStop(0, '#272a36');
    grad.addColorStop(0.55, '#12141c');
    grad.addColorStop(1, '#07080c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const title = String(track?.name || track?.title || 'VOID Track').trim().slice(0, 32);
    const artist = String(track?.artist || 'VOID').trim().slice(0, 36);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '600 34px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, size / 2, size / 2 - 8, size - 80);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = '500 22px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(artist, size / 2, size / 2 + 34, size - 100);
  }

  return new Promise((resolve) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const buf = await blob.arrayBuffer();
        resolve({ blob, bytes: new Uint8Array(buf) });
      },
      'image/jpeg',
      0.92,
    );
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = window.setTimeout(() => resolve(null), 6500);
    img.onload = () => {
      window.clearTimeout(timer);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve(img);
      else resolve(null);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Resolves the track's cover artwork and converts it into a standard 600x600 square JPEG
 * (`coverBlob` + `coverJpegBytes`) ready to be embedded directly inside the downloaded audio file.
 */
export async function prepareDownloadArtwork(
  workingTrack: any,
  sourceTrack: any,
): Promise<{ image?: string; coverBlob?: Blob; coverJpegBytes?: Uint8Array }> {
  let coverSourceUrl =
    (isValidCoverUrl(workingTrack?.image) ? String(workingTrack.image).trim() : '') ||
    (isValidCoverUrl(sourceTrack?.image) ? String(sourceTrack.image).trim() : '') ||
    getStickyCoverUrl(workingTrack) ||
    getStickyCoverUrl(sourceTrack);

  if (!coverSourceUrl) {
    coverSourceUrl = await resolveAndLockTrackCover(workingTrack || sourceTrack);
  }
  if (coverSourceUrl) {
    rememberStickyCover(workingTrack || sourceTrack, coverSourceUrl);
  }

  // Upgrade JioSaavn 150x150 / 50x50 URLs to 500x500 HD cover art automatically
  if (coverSourceUrl && /saavncdn\.com/i.test(coverSourceUrl)) {
    coverSourceUrl = coverSourceUrl.replace(/-(?:50x50|150x150)\./i, '-500x500.');
  }

  if (coverSourceUrl && !String(coverSourceUrl).includes('fbcdn.net')) {
    const candidates = /^https?:\/\//i.test(coverSourceUrl)
      ? [
          `/__void_api/proxy?url=${encodeURIComponent(coverSourceUrl)}`,
          `https://wsrv.nl/?url=${encodeURIComponent(coverSourceUrl)}&w=600&h=600&fit=cover&output=jpg`,
          coverSourceUrl,
        ]
      : [coverSourceUrl];

    for (const candidateUrl of candidates) {
      const loadedImg = await loadImageElement(candidateUrl);
      if (loadedImg) {
        const rendered = await renderSquareJpegCover(
          loadedImg,
          workingTrack || sourceTrack,
          coverSourceUrl,
        );
        if (rendered && rendered.bytes.byteLength >= 512) {
          return {
            image: coverSourceUrl,
            coverBlob: rendered.blob,
            coverJpegBytes: rendered.bytes,
          };
        }
      }

      // Direct fetch fallback if HTMLImageElement decoding was blocked
      try {
        const res = await fetch(candidateUrl, { mode: 'cors' });
        if (res.ok) {
          const rawBlob = await res.blob();
          if (rawBlob.size >= 512 && /^image\//i.test(rawBlob.type || '')) {
            if (typeof createImageBitmap === 'function') {
              try {
                const bmp = await createImageBitmap(rawBlob);
                const rendered = await renderSquareJpegCover(
                  bmp,
                  workingTrack || sourceTrack,
                  coverSourceUrl,
                );
                bmp.close?.();
                if (rendered && rendered.bytes.byteLength >= 512) {
                  return {
                    image: coverSourceUrl,
                    coverBlob: rendered.blob,
                    coverJpegBytes: rendered.bytes,
                  };
                }
              } catch {
                // Fall through to raw bytes if already JPEG
              }
            }
            if (/jpeg|jpg/i.test(rawBlob.type)) {
              const buf = await rawBlob.arrayBuffer();
              return {
                image: coverSourceUrl,
                coverBlob: rawBlob,
                coverJpegBytes: new Uint8Array(buf),
              };
            }
          }
        }
      } catch {
        // Try next candidate
      }
    }
  }

  // Fallback generated cover so no downloaded track ever has a blank icon
  const fallbackRendered = await renderSquareJpegCover(null, workingTrack || sourceTrack);
  return {
    image: coverSourceUrl || undefined,
    coverBlob: fallbackRendered?.blob,
    coverJpegBytes: fallbackRendered?.bytes,
  };
}
