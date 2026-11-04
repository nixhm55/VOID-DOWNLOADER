import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import type { SearchCategory, SearchResult } from '@/api/quality';
import type {
  LiquidGlassOrbHandle,
  LiquidGlassOrbState,
} from '@/components/liquid-glass-orb';
import {
  SoapBubbleMaterial,
  SoapBubbleSlider,
} from '@/components/soap-bubble';

export const SEARCH_BUBBLE_MATERIAL_PROPS = {
  glass: 0.9,
  iridescence: 0,
  oilOpacity: 0,
  oilCoverage: 0,
  dispersion: 0,
  reflectivity: 0.14,
  mirage: 0.08,
  refraction: 0.04,
  bevel: 8,
  tint: '#050507',
  opacity: 0.94,
  soapHighlightColor: '#ffffff1a',
  soapShadeColor: '#000000',
  keyLight: false,
  windowLight: false,
  windowIntensity: 0,
  glintIntensity: 0,
  windowTwin: false,
  floorLight: 0.06,
  bottomShade: true,
  bottomShadeColor: '#000000cc',
} as const;

export const SLIDER_BUBBLE_MATERIAL_PROPS = {
  iridescence: 0.5,
  oilCoverage: 0.73,
  oilEdgeFade: 2.33,
  clearCenter: 0.57,
  windowLength: 1.3,
  windowMargin: 0.85,
  windowBend: 0.75,
  windowSize: 0.75,
  windowWidth: 0.8,
  windowGradient: 0.96,
  windowHead: 0.7,
  windowTail: 0.6,
  glintSize: 1.65,
  glintIntensity: 0,
  glintDistance: -0.45,
  glintHeight: 0.65,
  windowIntensity: 0.85,
  windowTwin: false,
  bottomShadeColor: '#ffffff',
} as const;

export function VoidGlyph({ playing }: { playing: boolean }): JSX.Element {
  return (
    <svg className="void-glyph" viewBox="0 0 24 24" aria-hidden="true" data-playing={playing}>
      <circle className="g-ring" cx="12" cy="12" r="10" transform="rotate(-19 12 12)" />
      <path className="g-play" d="M10 8.4 L16.4 12 L10 15.6 Z" />
      <g className="g-pause">
        <rect x="9" y="8.6" width="2.1" height="6.8" rx=".8" />
        <rect x="12.9" y="8.6" width="2.1" height="6.8" rx=".8" />
      </g>
    </svg>
  );
}

export function VolumeControl({
  volume,
  muted,
  accentColor = 'rgb(232, 228, 220)',
  onVolume,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  accentColor?: string;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const dragging = useRef(false);
  const silent = muted || volume <= 0;
  const Icon = silent ? VolumeX : volume < 0.4 ? Volume1 : Volume2;

  const clearTimer = () => window.clearTimeout(timer.current);
  const armClose = () => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      if (!dragging.current) setOpen(false);
    }, 1800);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const label = open ? (silent ? 'Unmute' : 'Mute') : 'Volume';
  return (
    <div
      ref={root}
      className="vol"
      data-open={open ? '' : undefined}
      data-silent={silent ? '' : undefined}
      onPointerEnter={clearTimer}
      onPointerLeave={() => {
        if (open) armClose();
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
        }
      }}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          armClose();
        }
      }}
    >
      <div className="vol-pop">
        <SoapBubbleMaterial {...SLIDER_BUBBLE_MATERIAL_PROPS}>
          <SoapBubbleSlider
            className="vol-slider"
            scale={0.62}
            sliderHeight={18}
            trackHeight={3.5}
            hoverOnlyBubble
            from={accentColor}
            min={0}
            max={1}
            step={0.01}
            value={silent ? 0 : volume}
            label="Volume"
            inputTabIndex={open ? 0 : -1}
            onValueChange={(val) => onVolume(val)}
            onDragStateChange={(isDragging) => {
              dragging.current = isDragging;
              if (isDragging) clearTimer();
            }}
          />
        </SoapBubbleMaterial>
      </div>
      <button
        type="button"
        className="icon-button vol-button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => {
          if (open) onToggleMute();
          else setOpen(true);
        }}
      >
        <Icon key={silent ? 'silent' : 'sound'} />
      </button>
    </div>
  );
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—:—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function formatElapsed(seconds: number): string {
  return !Number.isFinite(seconds) || seconds <= 0 ? '0:00' : formatTime(seconds);
}

export function formatMinimalArtist(rawArtist?: string): string {
  const raw = String(rawArtist || '').trim();
  if (!raw) return 'Unknown Artist';
  const parts = raw
    .split(/(?:,|;|&|·|\||\/)/)
    .map((p) => p.replace(/[^\p{L}\p{N}\s'-]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const primary = parts[0] || raw.replace(/[,.;|•]+/g, ' ').replace(/\s+/g, ' ').trim();
  return primary.length > 26 ? `${primary.slice(0, 26).trim()}…` : primary;
}

export const SEARCH_CATEGORIES: readonly SearchCategory[] = [
  'High',
  'Very High',
  'Lossless',
] as const;

export function SearchCategoryTabs({
  activeCategory,
  onSelectCategory,
}: {
  activeCategory: SearchCategory;
  onSelectCategory: (category: SearchCategory) => void;
}): JSX.Element {
  return (
    <div className="search-category-bar" role="tablist" aria-label="Music quality categories">
      {SEARCH_CATEGORIES.map((category, idx) => {
        const isSelected = activeCategory === category;
        const alignClass =
          idx === 0
            ? 'is-left'
            : idx === 1
              ? 'is-center'
              : 'is-right';
        return (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={isSelected}
            data-active={isSelected ? 'true' : 'false'}
            className={`search-category-tab ${alignClass}${isSelected ? ' is-selected' : ' is-faded'}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCategory(category);
            }}
          >
            <span className="search-category-tab-label">{category}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface VoidUIProps {
  pageRef: RefObject<HTMLDivElement>;
  searchSectionRef: RefObject<HTMLElement>;
  searchOccluderRef: RefObject<HTMLDivElement>;
  searchInputRef: RefObject<HTMLInputElement>;
  resultsListRef: RefObject<HTMLDivElement>;
  voiceOrbRef: RefObject<LiquidGlassOrbHandle>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: SearchResult[];
  activeCategory: SearchCategory;
  setActiveCategory: (category: SearchCategory) => void;
  isSearching: boolean;
  isSearchPanelOpen: boolean;
  setIsSearchPanelOpen: (open: boolean) => void;
  searchHistory: string[];
  historyExpanded: boolean;
  setHistoryExpanded: (fn: (prev: boolean) => boolean) => void;
  handleSaveHistory: (term: string) => void;
  handleRemoveHistory: (term: string, e: ReactMouseEvent) => void;
  voiceOrbOpen: boolean;
  voiceOrbState: LiquidGlassOrbState;
  toggleVoiceSearch: () => void;
  stopVoiceSearch: () => void;
  triggerVoiceSearchCompletion: () => void;
  getLiveVoiceAudioLevel: () => number;
  getLiveVoiceSignal: () => {
    level: number;
    onset: number;
    low: number;
    mid: number;
    high: number;
  };
  hasQuery: boolean;
  showResultsPanel: boolean;
  activeTrack: SearchResult | null;
  playingId: string | null;
  isPlayingAudio: boolean;
  position: number;
  effectiveDuration: number;
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  setMuted: (fn: boolean | ((prev: boolean) => boolean)) => void;
  shuffle: boolean;
  setShuffle: (fn: (prev: boolean) => boolean) => void;
  repeat: 'off' | 'all' | 'one';
  setRepeat: (fn: (prev: 'off' | 'all' | 'one') => 'off' | 'all' | 'one') => void;
  downloadingIds: Record<string, 'loading' | 'done'>;
  activeTrackDlState?: 'loading' | 'done';
  handleTogglePlay: (item: SearchResult) => Promise<void>;
  handleDownloadTrack: (item: SearchResult) => Promise<void>;
  playRelative: (dir: number) => void;
  seekTo: (val: number) => void;
  children?: ReactNode;
}
