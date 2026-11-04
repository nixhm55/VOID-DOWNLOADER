import { memo, type CSSProperties } from 'react';
import {
  type QualityTier,
  formatProviderLabel,
  getTrackQualityBadge,
} from '@/api/quality';

interface QualityBadgeProps {
  tier?: QualityTier | string;
  track?: any;
  compact?: boolean;
  className?: string;
}

const BADGE_STYLES: Record<string, CSSProperties> = {
  Lossless: {
    color: '#f87171',
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: 'rgba(239, 68, 68, 0.42)',
  },
  'Very High (320kbps)': {
    color: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.11)',
    borderColor: 'rgba(168, 85, 247, 0.32)',
  },
  'High (256kbps)': {
    color: '#4ade80',
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderColor: 'rgba(74, 222, 128, 0.36)',
  },
  'High (240kbps)': {
    color: '#4ade80',
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderColor: 'rgba(74, 222, 128, 0.36)',
  },
  'High (192kbps)': {
    color: '#4ade80',
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderColor: 'rgba(74, 222, 128, 0.36)',
  },
  'High (160kbps)': {
    color: '#4ade80',
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderColor: 'rgba(74, 222, 128, 0.36)',
  },
  'Standard (128kbps)': {
    color: 'hsl(var(--foreground) / 0.72)',
    backgroundColor: 'hsl(var(--foreground) / 0.05)',
    borderColor: 'hsl(var(--foreground) / 0.12)',
  },
  Low: {
    color: 'hsl(var(--muted-foreground) / 0.72)',
    backgroundColor: 'hsl(var(--foreground) / 0.03)',
    borderColor: 'hsl(var(--foreground) / 0.09)',
  },
  'FLAC Live': {
    color: '#f87171',
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: 'rgba(239, 68, 68, 0.42)',
  },
  'Live Radio': {
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.11)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
};

export const QualityBadge = memo(function QualityBadge({
  tier,
  track,
  compact = false,
  className = '',
}: QualityBadgeProps) {
  const rawTier =
    tier && tier !== 'Unknown'
      ? tier
      : track
        ? getTrackQualityBadge(track)
        : 'Standard (128kbps)';

  const resolvedTier =
    !rawTier || rawTier === 'Unknown'
      ? track
        ? getTrackQualityBadge({ ...track, qualityBadge: undefined })
        : 'Standard (128kbps)'
      : rawTier;

  if (!resolvedTier) return null;

  const palette = BADGE_STYLES[resolvedTier] || BADGE_STYLES['Standard (128kbps)'];
  const isLiveBadge = resolvedTier === 'Live Radio' || resolvedTier === 'FLAC Live';

  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: compact ? '1px 6px' : '2px 7px',
    fontSize: compact ? 10 : 10.5,
    fontWeight: 500,
    lineHeight: 1.35,
    letterSpacing: '0.01em',
    borderRadius: 999,
    border: '1px solid',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    ...palette,
  };

  return (
    <span
      className={`void-quality-badge${className ? ` ${className}` : ''}`}
      data-quality={resolvedTier}
      style={baseStyle}
      title={resolvedTier}
    >
      {isLiveBadge && (
        <span
          aria-hidden="true"
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            backgroundColor: 'currentColor',
            display: 'inline-block',
          }}
        />
      )}
      {resolvedTier}
    </span>
  );
});

export const ProviderSourceLabel = memo(function ProviderSourceLabel({
  source,
  track,
  className = '',
}: {
  source?: string;
  track?: any;
  className?: string;
}) {
  const label = formatProviderLabel(source, track);
  if (!label) return null;
  return (
    <span
      className={className}
      data-provider={label}
      style={{
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
});
