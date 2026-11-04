import { memo, useEffect, useState, type CSSProperties } from 'react';
import { Disc3, ListMusic } from 'lucide-react';
import { computeAutoFitCoverScale, getCachedCoverScale, getStickyCoverUrl, isCoverUrlLoaded, isValidCoverUrl, markCoverUrlLoaded, rememberStickyCover, resolveAndLockTrackCover, stickyCoverListeners } from '../song-cover/coverProcessing';

function hueOf(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export const PgCover = memo(function PgCover({ track, fill = false, kind = 'disc' }: { track?: any; fill?: boolean; kind?: 'disc' | 'list' }) {
  const [, setCoverTick] = useState(0);
  useEffect(() => {
    const onCoverLock = () => setCoverTick(t => t + 1);
    stickyCoverListeners.add(onCoverLock);
    return () => { stickyCoverListeners.delete(onCoverLock); };
  }, []);

  const stickyRemoteUrl = track ? getStickyCoverUrl(track) : '';
  const [resolvedRemoteUrl, setResolvedRemoteUrl] = useState<string>('');
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);

  useEffect(() => {
    setFailedUrls([]);
    setResolvedRemoteUrl('');
  }, [track?.id, track?.title, track?.artist]);

  useEffect(() => {
    if (!track) { setBlobSrc(null); return; }
    const rawBlob =
      track.artwork instanceof Blob && track.artwork.size >= 512
        ? track.artwork
        : track.coverBlob instanceof Blob && track.coverBlob.size >= 512 && /^image\//i.test(track.coverBlob.type || '')
          ? track.coverBlob
          : null;
    if (!rawBlob) { setBlobSrc(null); return; }
    let active = true;
    const url = URL.createObjectURL(rawBlob);
    if (active) setBlobSrc(url);
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [track, track?.artwork, track?.coverBlob, track?.id]);

  const directValidImg = track && isValidCoverUrl(track.image) ? String(track.image).trim() : '';
  const candidates = [stickyRemoteUrl, directValidImg, resolvedRemoteUrl, blobSrc].filter(
    (u): u is string => typeof u === 'string' && u.length > 0 && !failedUrls.includes(u)
  );
  const finalSrc = candidates[0] || null;
  const [fitScale, setFitScale] = useState<number>(() => getCachedCoverScale(finalSrc, track));

  useEffect(() => {
    setFitScale(getCachedCoverScale(finalSrc, track));
  }, [finalSrc, track]);

  useEffect(() => {
    if (!track) return;
    if (stickyRemoteUrl && !failedUrls.includes(stickyRemoteUrl)) {
      rememberStickyCover(track, stickyRemoteUrl);
      return;
    }
    if (finalSrc && !failedUrls.includes(finalSrc)) return;
    let active = true;
    void resolveAndLockTrackCover(track).then(url => {
      if (active && url) setResolvedRemoteUrl(url);
    });
    return () => { active = false; };
  }, [track, stickyRemoteUrl, finalSrc, failedUrls]);

  const Glyph = kind === 'list' ? ListMusic : Disc3;
  return (
    <div className={fill ? 'pg-cover pg-cover--fill' : 'pg-cover'} style={{ '--ch': hueOf(String(track?.id ?? 'void')) } as CSSProperties}
      data-testid={fill ? 'cover-artwork' : 'cover-thumbnail'}>
      {finalSrc
        ? <img
            src={finalSrc}
            alt={`${track?.album ?? 'Album'} artwork`}
            className="is-loaded"
            style={{ opacity: 1, transform: fitScale > 1.005 ? `scale(${fitScale})` : undefined }}
            decoding="async"
            onLoad={(e) => {
              if (isValidCoverUrl(finalSrc)) rememberStickyCover(track, finalSrc);
              markCoverUrlLoaded(finalSrc);
              void isCoverUrlLoaded(finalSrc);
              const computed = computeAutoFitCoverScale(e.currentTarget, finalSrc, track, (asyncScale) => {
                setFitScale(prev => (Math.abs(asyncScale - prev) > 0.01 ? asyncScale : prev));
              });
              if (Math.abs(computed - fitScale) > 0.01) setFitScale(computed);
            }}
            onError={() => {
              setFailedUrls(prev => (prev.includes(finalSrc) ? prev : [...prev, finalSrc]));
              if (track) {
                void resolveAndLockTrackCover(track).then(url => {
                  if (url && url !== finalSrc) setResolvedRemoteUrl(url);
                });
              }
            }}
          />
        : <Glyph aria-hidden="true" />}
    </div>
  );
}, (a, b) => a.fill === b.fill && a.kind === b.kind && a.track?.artwork === b.track?.artwork && a.track?.coverBlob === b.track?.coverBlob && a.track?.image === b.track?.image
  && a.track?.id === b.track?.id && a.track?.album === b.track?.album && a.track?.source === b.track?.source);
