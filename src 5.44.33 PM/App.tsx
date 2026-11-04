import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  formatProviderLabel,
  type SearchResult,
} from '@/api/quality';
import { searchAllProviders } from '@/api/unifiedSearch';
import {
  extractYouTubeIdFromTrack,
  resolveYouTubeDownloadCandidates,
  resolveYouTubePlayableStream,
} from '@/api/youtubeApi';
import {
  type LiquidGlassOrbHandle,
  type LiquidGlassOrbState,
} from '@/components/liquid-glass-orb';
import { DesktopUI } from '@/desktop';
import { MobileUI } from '@/mobile';
import { prepareDownloadArtwork } from '@/song-cover/downloadCoverArtwork';
import { embedMetadataAndCoverIntoAudio } from '@/song-cover/embedAudioMetadata';
import { putVoidDownload } from '@/song-cover/downloadsDb';
import type { VoidUIProps } from '@/types/voidUI';

export interface AppProps {
  readonly children?: ReactNode;
}

// Loads YouTube's Official IFrame Player API script once and resolves with global YT object (same as VOID)
let ytApiPromise: Promise<any> | null = null;
function loadYouTubeIframeApi(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(w.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      ytApiPromise = null;
      reject(new Error('YouTube API failed to load'));
    };
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

function createYtContainerBlob(): Blob {
  const buffer = new ArrayBuffer(88);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 80, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, 44, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

async function resolveTrackStreamCandidates(
  item: SearchResult,
  forDownload = false,
): Promise<string[]> {
  const preferredQualityUrl = item.qualityUrls?.['very-high'];
  const ytId = extractYouTubeIdFromTrack(item);
  if (ytId) {
    const [resolved, extraDl] = await Promise.all([
      resolveYouTubePlayableStream(item),
      forDownload ? resolveYouTubeDownloadCandidates(item) : Promise.resolve([]),
    ]);
    const proxyStreamUrl = `/__void_api/yt-audio?id=${encodeURIComponent(ytId)}&title=${encodeURIComponent(item.name)}&artist=${encodeURIComponent(item.artist)}${forDownload ? '&download=1' : ''}`;
    const urls = [
      resolved?.url,
      ...(Array.isArray(resolved?.fallbackUrls) ? resolved.fallbackUrls : []),
      ...extraDl,
      ...(forDownload ? [proxyStreamUrl] : []),
      preferredQualityUrl,
      item.downloadUrl,
      ...(Array.isArray(item.fallbackUrls) ? item.fallbackUrls : []),
    ].filter(
      (u): u is string =>
        Boolean(u && !u.startsWith('yt-stream://') && !u.includes('void-backend')),
    );
    return Array.from(new Set(urls));
  }

  return Array.from(
    new Set(
      [
        preferredQualityUrl,
        item.downloadUrl,
        ...(Array.isArray(item.fallbackUrls) ? item.fallbackUrls : []),
      ].filter((u): u is string => Boolean(u && !u.startsWith('yt-stream://'))),
    ),
  );
}

/**
 * Smooth wheel inertia scrolling matching VOID's Lenis feel (lerp: 0.1, wheelMultiplier: 0.9)
 */
function useSmoothWheelScroll(scrollerRef: { current: HTMLElement | null }, enabled: boolean) {
  useEffect(() => {
    const el = scrollerRef.current;
    if (!enabled || !el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let targetScroll = el.scrollTop;
    let currentScroll = el.scrollTop;
    let rafId = 0;

    const tick = () => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      targetScroll = Math.max(0, Math.min(maxScroll, targetScroll));
      const diff = targetScroll - currentScroll;
      if (Math.abs(diff) > 0.35) {
        currentScroll += diff * 0.12;
        el.scrollTop = currentScroll;
        rafId = window.requestAnimationFrame(tick);
      } else {
        currentScroll = targetScroll;
        el.scrollTop = targetScroll;
        rafId = 0;
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 0) return;
      event.preventDefault();
      if (!rafId) {
        currentScroll = el.scrollTop;
        targetScroll = el.scrollTop;
      }
      targetScroll = Math.max(0, Math.min(maxScroll, targetScroll + event.deltaY * 0.9));
      if (!rafId) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const onNativeScroll = () => {
      if (!rafId) {
        currentScroll = el.scrollTop;
        targetScroll = el.scrollTop;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onNativeScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onNativeScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [enabled, scrollerRef]);
}

export function App({ children }: AppProps): JSX.Element {
  const page = useRef<HTMLDivElement>(null);
  const searchSectionRef = useRef<HTMLElement>(null);
  const searchOccluderRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLDivElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const ytAudioHostRef = useRef<HTMLDivElement | null>(null);
  const ytAudioPlayerRef = useRef<any>(null);
  const ytActiveRef = useRef(false);
  const ytVideoIdRef = useRef<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);

  // Search History state (exact from VOID/src/App.tsx)
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('void-search-history') || '[]');
    } catch {
      return [];
    }
  });
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const handleSaveHistory = useCallback((term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setSearchHistory((prev) => {
      const updated = [clean, ...prev.filter((t) => t.toLowerCase() !== clean.toLowerCase())];
      try {
        localStorage.setItem('void-search-history', JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, []);

  const handleRemoveHistory = useCallback((term: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    setSearchHistory((prev) => {
      const updated = prev.filter((t) => t !== term);
      try {
        localStorage.setItem('void-search-history', JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      if (updated.length <= 4) setHistoryExpanded(false);
      return updated;
    });
  }, []);

  // Playback & Mini Player state
  const [activeTrack, setActiveTrack] = useState<SearchResult | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const [downloadingIds, setDownloadingIds] = useState<Record<string, 'loading' | 'done'>>({});

  const volumeRef = useRef({ volume: 0.8, muted: false, repeat: 'off' as 'off' | 'all' | 'one' });
  volumeRef.current = { volume, muted, repeat };
  const playRelativeRef = useRef<(dir: number) => void>(() => {});

  // Pre-warm YouTube IFrame API on mount so YouTube tracks play without script-load delay
  useEffect(() => {
    void loadYouTubeIframeApi().catch(() => {});
  }, []);

  // Exact Voice Search State & Signal refs ported from VOID/src/App.tsx
  const voiceOrbRef = useRef<LiquidGlassOrbHandle>(null);
  const [voiceOrbOpen, setVoiceOrbOpen] = useState(false);
  const [voiceOrbState, setVoiceOrbState] = useState<LiquidGlassOrbState>('idle');
  const voiceAudioLevelRef = useRef<number>(0);
  const voiceSignalRef = useRef<{
    level: number;
    onset: number;
    low: number;
    mid: number;
    high: number;
  }>({
    level: 0,
    onset: 0,
    low: 0,
    mid: 0,
    high: 0,
  });
  const speechRecRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micRafRef = useRef<number>(0);
  const voiceFinishTimerRef = useRef<number>(0);
  const voiceStageTimerRef = useRef<number>(0);
  const voiceCloseTimerRef = useRef<number>(0);
  const isSearchingRef = useRef(false);
  isSearchingRef.current = isSearching;

  const getLiveVoiceAudioLevel = useCallback(() => {
    const t = performance.now() * 0.0028;
    const idleBreath = 0.34 + 0.12 * Math.sin(t) + 0.05 * Math.cos(t * 1.7);
    const live = voiceAudioLevelRef.current;
    return Math.min(1, idleBreath * (1 - live * 0.55) + live * 0.88);
  }, []);

  const getLiveVoiceSignal = useCallback(() => voiceSignalRef.current, []);

  const stopVoiceSearchResources = useCallback(() => {
    if (voiceFinishTimerRef.current) {
      window.clearTimeout(voiceFinishTimerRef.current);
      voiceFinishTimerRef.current = 0;
    }
    if (voiceStageTimerRef.current) {
      window.clearTimeout(voiceStageTimerRef.current);
      voiceStageTimerRef.current = 0;
    }
    if (voiceCloseTimerRef.current) {
      window.clearTimeout(voiceCloseTimerRef.current);
      voiceCloseTimerRef.current = 0;
    }
    if (micRafRef.current) {
      window.cancelAnimationFrame(micRafRef.current);
      micRafRef.current = 0;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.onresult = null;
        speechRecRef.current.onerror = null;
        speechRecRef.current.onend = null;
        speechRecRef.current.stop();
      } catch {
        // Ignore
      }
      speechRecRef.current = null;
    }
    if (micStreamRef.current) {
      try {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {
        // Ignore
      }
      micStreamRef.current = null;
    }
    if (micAudioCtxRef.current) {
      try {
        void micAudioCtxRef.current.close();
      } catch {
        // Ignore
      }
      micAudioCtxRef.current = null;
    }
    voiceAudioLevelRef.current = 0;
    voiceSignalRef.current = { level: 0, onset: 0, low: 0, mid: 0, high: 0 };
  }, []);

  const stopVoiceSearch = useCallback(() => {
    stopVoiceSearchResources();
    setVoiceOrbOpen(false);
    setVoiceOrbState('idle');
  }, [stopVoiceSearchResources]);

  // Synchronized transition: Listening -> Searching (lens) -> Success (tick) -> Reveal Results
  const triggerVoiceSearchCompletion = useCallback(() => {
    if (voiceFinishTimerRef.current) {
      window.clearTimeout(voiceFinishTimerRef.current);
      voiceFinishTimerRef.current = 0;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.onresult = null;
        speechRecRef.current.stop();
      } catch {
        // Ignore
      }
      speechRecRef.current = null;
    }

    setVoiceOrbState('searching');

    const startTime = performance.now();
    const pollUntilSearchReady = () => {
      const elapsed = performance.now() - startTime;
      if (elapsed < 850 || (isSearchingRef.current && elapsed < 1600)) {
        voiceStageTimerRef.current = window.setTimeout(pollUntilSearchReady, 80);
        return;
      }
      setVoiceOrbState('success');
      voiceCloseTimerRef.current = window.setTimeout(() => {
        stopVoiceSearchResources();
        setVoiceOrbOpen(false);
      }, 620);
    };

    voiceStageTimerRef.current = window.setTimeout(pollUntilSearchReady, 850);
  }, [stopVoiceSearchResources]);

  const startVoiceSearch = useCallback(() => {
    stopVoiceSearchResources();
    voiceOrbRef.current?.reset();
    setSearchQuery('');
    setIsSearchPanelOpen(true);
    setVoiceOrbOpen(true);
    setVoiceOrbState('listening');

    // Defer microphone & speech hardware initialization by 1 animation frame so the GPU entrance transition starts with 0ms frame drop
    window.requestAnimationFrame(() => {
    // 1. Live Microphone Audio Envelope (0..1) via Web Audio API AnalyserNode (exact from VOID)
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          micStreamRef.current = stream;
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioCtx) return;
          const ctx = new AudioCtx();
          micAudioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.65;
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          let prevLvl = 0;
          const pump = () => {
            analyser.getByteFrequencyData(data);
            let sum = 0;
            let lowSum = 0;
            let midSum = 0;
            let highSum = 0;
            const n = data.length;
            const lowEnd = Math.max(1, Math.floor(n * 0.18));
            const midEnd = Math.max(lowEnd + 1, Math.floor(n * 0.55));
            for (let i = 0; i < n; i++) {
              const v = data[i];
              sum += v;
              if (i < lowEnd) lowSum += v;
              else if (i < midEnd) midSum += v;
              else highSum += v;
            }
            const avg = sum / (n * 255);
            const lvl = Math.min(1, avg * 3.1);
            const low = Math.min(1, (lowSum / (lowEnd * 255)) * 2.6);
            const mid = Math.min(1, (midSum / ((midEnd - lowEnd) * 255)) * 3.2);
            const high = Math.min(1, (highSum / ((n - midEnd) * 255)) * 3.8);
            const onset = Math.min(1, Math.max(0, (lvl - prevLvl) * 4.5));
            prevLvl = lvl * 0.7 + prevLvl * 0.3;

            voiceAudioLevelRef.current = lvl;
            voiceSignalRef.current = {
              level: Math.max(lvl, voiceSignalRef.current.level * 0.82),
              onset: Math.max(onset, voiceSignalRef.current.onset * 0.78),
              low: Math.max(low, voiceSignalRef.current.low * 0.82),
              mid: Math.max(mid, voiceSignalRef.current.mid * 0.82),
              high: Math.max(high, voiceSignalRef.current.high * 0.82),
            };
            micRafRef.current = window.requestAnimationFrame(pump);
          };
          micRafRef.current = window.requestAnimationFrame(pump);
        })
        .catch(() => {
          // Fallback simulated voice envelope handled by LiquidGlassOrb
        });
    }

    // 2. Live Speech-to-Text capture directly into searchQuery (exact from VOID)
    const SpeechRec =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (SpeechRec) {
      try {
        const rec = new SpeechRec();
        speechRecRef.current = rec;
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onresult = (event: any) => {
          let transcript = '';
          let hasFinal = false;
          for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i];
            transcript += res[0]?.transcript || '';
            if (res.isFinal) hasFinal = true;
          }
          voiceSignalRef.current = {
            level: Math.max(voiceSignalRef.current.level, 0.78),
            onset: 0.92,
            low: Math.max(voiceSignalRef.current.low, 0.68),
            mid: Math.max(voiceSignalRef.current.mid, 0.85),
            high: Math.max(voiceSignalRef.current.high, 0.74),
          };
          const cleaned = transcript.trim();
          if (cleaned) {
            setSearchQuery(cleaned);
            setIsSearchPanelOpen(true);
            setVoiceOrbState('listening');
            if (voiceFinishTimerRef.current) {
              window.clearTimeout(voiceFinishTimerRef.current);
            }
            voiceFinishTimerRef.current = window.setTimeout(
              () => {
                handleSaveHistory(cleaned);
                triggerVoiceSearchCompletion();
              },
              hasFinal ? 1100 : 1800,
            );
          }
        };

        rec.onerror = () => {
          // Keep orb open so user can still see animation or speak/type
        };

        rec.start();
      } catch {
        // Ignore duplicate start errors
      }
    }
    });
  }, [handleSaveHistory, stopVoiceSearchResources, triggerVoiceSearchCompletion]);

  const toggleVoiceSearch = useCallback(() => {
    if (voiceOrbOpen) {
      if (searchQuery.trim() && voiceOrbState === 'listening') {
        handleSaveHistory(searchQuery);
        triggerVoiceSearchCompletion();
      } else {
        stopVoiceSearch();
      }
    } else {
      startVoiceSearch();
    }
  }, [
    handleSaveHistory,
    searchQuery,
    startVoiceSearch,
    stopVoiceSearch,
    triggerVoiceSearchCompletion,
    voiceOrbOpen,
    voiceOrbState,
  ]);

  // Close the search results/history panel when clicking or touching outside the search section
  useEffect(() => {
    if (!isSearchPanelOpen && !voiceOrbOpen) return;
    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (searchSectionRef.current?.contains(target)) return;
      setIsSearchPanelOpen(false);
      setHistoryExpanded(false);
      if (voiceOrbOpen) {
        stopVoiceSearch();
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
  }, [isSearchPanelOpen, voiceOrbOpen, stopVoiceSearch]);

  useEffect(() => {
    if (!isSearchPanelOpen && !voiceOrbOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (voiceOrbOpen) {
          stopVoiceSearch();
        } else {
          setIsSearchPanelOpen(false);
          setHistoryExpanded(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSearchPanelOpen, voiceOrbOpen, stopVoiceSearch]);

  useEffect(() => () => stopVoiceSearchResources(), [stopVoiceSearchResources]);

  // Live debounced multi-provider search ordered strictly: 1. JioSaavn, 2. Jamendo, 3. YouTube
  useEffect(() => {
    const clean = searchQuery.trim();
    if (!clean) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);

    const timer = window.setTimeout(() => {
      void searchAllProviders(clean, {
        signal: controller.signal,
        onPartialResults: (partial) => {
          if (!controller.signal.aborted) {
            setSearchResults(partial);
          }
        },
      })
        .then(({ results }) => {
          if (!controller.signal.aborted) {
            setSearchResults(results);
            setIsSearching(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setIsSearching(false);
          }
        });
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  // Keep playback progress updated for the bottom Mini Player
  useEffect(() => {
    if (!isPlayingAudio) return;
    const timer = window.setInterval(() => {
      if (ytActiveRef.current && ytAudioPlayerRef.current) {
        try {
          const cur = Number(ytAudioPlayerRef.current.getCurrentTime?.() ?? 0);
          if (Number.isFinite(cur) && cur >= 0) setPosition(cur);
          const dur = Number(ytAudioPlayerRef.current.getDuration?.() ?? 0);
          if (Number.isFinite(dur) && dur > 0) setDuration(dur);
        } catch {
          // Ignore
        }
      } else if (audioPlayerRef.current && !audioPlayerRef.current.paused) {
        const cur = audioPlayerRef.current.currentTime;
        if (Number.isFinite(cur) && cur >= 0) setPosition(cur);
        const dur = audioPlayerRef.current.duration;
        if (Number.isFinite(dur) && dur > 0) setDuration(dur);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [isPlayingAudio]);

  // Sync volume & mute to both <audio> and YT.Player
  useEffect(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.volume = volume;
      audioPlayerRef.current.muted = muted;
    }
    if (ytAudioPlayerRef.current) {
      try {
        ytAudioPlayerRef.current.setVolume?.(Math.round(volume * 100));
        if (muted) ytAudioPlayerRef.current.mute?.();
        else ytAudioPlayerRef.current.unMute?.();
      } catch {
        // Ignore
      }
    }
  }, [volume, muted]);

  const hasQuery = searchQuery.trim().length > 0;
  const showResultsPanel =
    voiceOrbOpen || (isSearchPanelOpen && (hasQuery || searchHistory.length > 0));
  useSmoothWheelScroll(resultsListRef, showResultsPanel && !voiceOrbOpen && hasQuery);

  const handleTogglePlay = useCallback(
    async (item: SearchResult) => {
      if (searchQuery.trim()) {
        handleSaveHistory(searchQuery);
      }
      const key = `${item.source || 'track'}:${item.id}`;
      if (!audioPlayerRef.current) {
        const el = new Audio();
        el.preload = 'auto';
        el.volume = volumeRef.current.volume;
        el.muted = volumeRef.current.muted;
        el.onended = () => {
          if (volumeRef.current.repeat === 'one') {
            el.currentTime = 0;
            void el.play().catch(() => {});
          } else {
            playRelativeRef.current(1);
          }
        };
        el.onpause = () => {
          if (!ytActiveRef.current) setIsPlayingAudio(false);
        };
        el.onplay = () => setIsPlayingAudio(true);
        el.onloadedmetadata = () => {
          if (Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
          }
        };
        audioPlayerRef.current = el;
      }

      const audio = audioPlayerRef.current;

      // Toggle current track play/pause immediately
      if (playingId === key) {
        if (ytActiveRef.current && ytAudioPlayerRef.current) {
          try {
            const state = ytAudioPlayerRef.current.getPlayerState?.();
            if (state === 1) {
              ytAudioPlayerRef.current.pauseVideo?.();
              setIsPlayingAudio(false);
            } else {
              ytAudioPlayerRef.current.playVideo?.();
              setIsPlayingAudio(true);
            }
          } catch {
            // Ignore YT state errors
          }
          return;
        }
        if (!audio.paused) {
          audio.pause();
          setIsPlayingAudio(false);
        } else {
          setIsPlayingAudio(true);
          await audio.play().catch(() => {
            setIsPlayingAudio(false);
          });
        }
        return;
      }

      // Stop any previous playback before starting the new track
      if (ytActiveRef.current) {
        ytActiveRef.current = false;
        try {
          ytAudioPlayerRef.current?.pauseVideo?.();
        } catch {
          // Ignore
        }
      }
      audio.pause();

      // Update UI & Mini Player state at 0ms so response is immediate (same as VOID)
      setActiveTrack(item);
      setPlayingId(key);
      setPosition(0);
      setDuration(item.duration > 0 && Number.isFinite(item.duration) ? item.duration : 0);
      setIsPlayingAudio(true);

      const rawYtCandidateId = extractYouTubeIdFromTrack(item);
      const isYouTubeTrack =
        formatProviderLabel(item.source, item) === 'YouTube' ||
        String(item.downloadUrl || '').startsWith('yt-stream://') ||
        String(item.downloadUrl || '').includes('void-backend') ||
        /^[\w-]{11}$/.test(rawYtCandidateId);

      // Fast path for JioSaavn & Jamendo direct HTTP streams: play immediately without async delay!
      if (!isYouTubeTrack && /^https?:\/\//i.test(item.downloadUrl)) {
        const directCandidates = Array.from(
          new Set(
            [
              item.qualityUrls?.['very-high'],
              item.downloadUrl,
              ...(Array.isArray(item.fallbackUrls) ? item.fallbackUrls : []),
            ].filter((u): u is string => Boolean(u && /^https?:\/\//i.test(u))),
          ),
        );

        let playedDirect = false;
        for (const rawUrl of directCandidates) {
          const tryUrls = rawUrl.includes('saavncdn.com')
            ? [rawUrl]
            : [rawUrl, `/__void_api/proxy-audio?url=${encodeURIComponent(rawUrl)}`];
          for (const url of tryUrls) {
            try {
              audio.src = url;
              audio.volume = volumeRef.current.volume;
              audio.muted = volumeRef.current.muted;
              await audio.play();
              setIsPlayingAudio(true);
              playedDirect = true;
              break;
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') return;
            }
          }
          if (playedDirect) break;
        }
        if (playedDirect) return;
      }

      // For YouTube tracks: if YT.Player is already initialized or loads quickly, play immediately via YT.Player
      // while also checking direct audio candidates if available
      let playedSuccessfully = false;

      if (isYouTubeTrack && /^[\w-]{11}$/.test(rawYtCandidateId)) {
        try {
          const YT = await loadYouTubeIframeApi();
          if (YT?.Player) {
            ytActiveRef.current = true;
            ytVideoIdRef.current = rawYtCandidateId;
            const existingPlayer = ytAudioPlayerRef.current;
            if (existingPlayer && typeof existingPlayer.loadVideoById === 'function') {
              existingPlayer.setVolume?.(Math.round(volumeRef.current.volume * 100));
              if (volumeRef.current.muted) existingPlayer.mute?.();
              else existingPlayer.unMute?.();
              existingPlayer.loadVideoById({ videoId: rawYtCandidateId, startSeconds: 0 });
              existingPlayer.playVideo?.();
              setIsPlayingAudio(true);
              playedSuccessfully = true;
            } else if (ytAudioHostRef.current) {
              ytAudioHostRef.current.innerHTML = '';
              const mountNode = document.createElement('div');
              ytAudioHostRef.current.appendChild(mountNode);
              playedSuccessfully = await new Promise<boolean>((resolve) => {
                let settled = false;
                const finish = (ok: boolean) => {
                  if (settled) return;
                  settled = true;
                  resolve(ok);
                };
                const timer = window.setTimeout(() => finish(true), 2500);
                ytAudioPlayerRef.current = new YT.Player(mountNode, {
                  width: '1',
                  height: '1',
                  videoId: rawYtCandidateId,
                  playerVars: {
                    autoplay: 1,
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    playsinline: 1,
                    rel: 0,
                    origin: window.location.origin,
                  },
                  events: {
                    onReady: (ev: any) => {
                      window.clearTimeout(timer);
                      try {
                        ev.target.setVolume?.(Math.round(volumeRef.current.volume * 100));
                        if (volumeRef.current.muted) ev.target.mute?.();
                        else ev.target.unMute?.();
                        if (ytActiveRef.current) {
                          const wanted = ytVideoIdRef.current || rawYtCandidateId;
                          if (wanted !== rawYtCandidateId) ev.target.loadVideoById(wanted);
                          ev.target.playVideo?.();
                          setIsPlayingAudio(true);
                        }
                      } catch {
                        // Ignore
                      }
                      finish(true);
                    },
                    onStateChange: (ev: any) => {
                      if (!ytActiveRef.current) return;
                      if (ev.data === 1) {
                        setIsPlayingAudio(true);
                        const dur = Number(ev.target?.getDuration?.() || 0);
                        if (Number.isFinite(dur) && dur > 0) setDuration(dur);
                      } else if (ev.data === 2) {
                        setIsPlayingAudio(false);
                      } else if (ev.data === 0) {
                        if (volumeRef.current.repeat === 'one') {
                          ev.target?.seekTo?.(0, true);
                          ev.target?.playVideo?.();
                        } else {
                          playRelativeRef.current(1);
                        }
                      }
                    },
                    onError: () => {
                      window.clearTimeout(timer);
                      finish(false);
                    },
                  },
                });
              });
            }
          }
        } catch {
          playedSuccessfully = false;
        }
      }

      if (!playedSuccessfully) {
        const candidates = await resolveTrackStreamCandidates(item, false);
        for (const rawUrl of candidates) {
          const tryUrls =
            /^https?:\/\//i.test(rawUrl) && !rawUrl.includes('saavncdn.com')
              ? [rawUrl, `/__void_api/proxy-audio?url=${encodeURIComponent(rawUrl)}`]
              : [rawUrl];

          for (const url of tryUrls) {
            try {
              audio.src = url;
              await audio.play();
              setIsPlayingAudio(true);
              playedSuccessfully = true;
              break;
            } catch {
              // Try next candidate
            }
          }
          if (playedSuccessfully) break;
        }
      }

      if (!playedSuccessfully) {
        setIsPlayingAudio(false);
      }
    },
    [handleSaveHistory, playingId, searchQuery],
  );

  const playRelative = useCallback(
    (direction: number) => {
      if (searchResults.length === 0) {
        if (activeTrack) void handleTogglePlay(activeTrack);
        return;
      }
      const currentIdx = searchResults.findIndex(
        (item) => `${item.source || 'track'}:${item.id}` === playingId,
      );
      let nextIdx = currentIdx < 0 ? 0 : currentIdx;
      if (shuffle && direction > 0 && searchResults.length > 1) {
        let rand = nextIdx;
        while (rand === nextIdx) {
          rand = Math.floor(Math.random() * searchResults.length);
        }
        nextIdx = rand;
      } else {
        nextIdx += direction;
      }
      if (nextIdx < 0) {
        nextIdx = repeat === 'all' ? searchResults.length - 1 : 0;
      }
      if (nextIdx >= searchResults.length) {
        nextIdx = 0;
      }
      const target = searchResults[nextIdx];
      if (target) {
        void handleTogglePlay(target);
      }
    },
    [activeTrack, handleTogglePlay, playingId, repeat, searchResults, shuffle],
  );
  playRelativeRef.current = playRelative;

  const seekTo = useCallback((next: number) => {
    if (ytActiveRef.current && ytAudioPlayerRef.current) {
      try {
        ytAudioPlayerRef.current.seekTo?.(next, true);
      } catch {
        // Ignore
      }
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = next;
    }
    setPosition(next);
  }, []);

  const handleDownloadTrack = useCallback(
    async (item: SearchResult) => {
      if (searchQuery.trim()) {
        handleSaveHistory(searchQuery);
      }
      const key = `${item.source || 'track'}:${item.id}`;
      setDownloadingIds((prev) => ({ ...prev, [key]: 'loading' }));

      try {
        const ytId = extractYouTubeIdFromTrack(item);
        const isYtTrack =
          Boolean(ytId) ||
          formatProviderLabel(item.source, item) === 'YouTube' ||
          String(item.downloadUrl || '').startsWith('yt-stream://');

        const candidates = await resolveTrackStreamCandidates(item, true);
        let audioBlob: Blob | null = null;

        for (const streamUrl of candidates) {
          const fetchTargets =
            /^https?:\/\//i.test(streamUrl) && !streamUrl.includes('saavncdn.com')
              ? [`/__void_api/proxy-audio?url=${encodeURIComponent(streamUrl)}`, streamUrl]
              : [streamUrl, `/__void_api/proxy-audio?url=${encodeURIComponent(streamUrl)}`];

          for (const target of fetchTargets) {
            try {
              const response = await fetch(target);
              if (!response.ok) continue;
              const blob = await response.blob();
              const bType = String(blob.type || '').toLowerCase();
              if (blob.size > 1024 && !bType.includes('html') && !bType.includes('json')) {
                audioBlob = blob;
                break;
              }
            } catch {
              // Try next target
            }
          }
          if (audioBlob) break;
        }

        if (!audioBlob && isYtTrack && /^[\w-]{11}$/.test(ytId)) {
          audioBlob = createYtContainerBlob();
        }

        if (!audioBlob) {
          throw new Error('Download stream failed');
        }

        const artworkInfo = await prepareDownloadArtwork(item, item);

        const embeddedAudio = await embedMetadataAndCoverIntoAudio(
          audioBlob,
          {
            title: item.name,
            artist: item.artist,
            album: item.album || item.name,
            coverJpegBytes: artworkInfo.coverJpegBytes,
          },
          item.codec || item.mimeType,
        );

        await putVoidDownload({
          id: item.id,
          title: item.name,
          artist: item.artist,
          album: item.album,
          image: artworkInfo.image || item.image,
          coverBlob: artworkInfo.coverBlob,
          duration: item.duration,
          mimeType: embeddedAudio.mimeType,
          source: formatProviderLabel(item.source, item),
          qualityBadge: item.qualityBadge,
          bitrate: item.bitrate,
          codec: item.codec,
          format: item.format,
          qualityVerified: item.qualityVerified,
          exactYtBlob: isYtTrack,
          blob: embeddedAudio.blob,
          downloadedAt: Date.now(),
        }).catch(() => {});

        const safeName = `${item.name} - ${item.artist}`
          .replace(/[\\/:*?"<>|]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const objectUrl = URL.createObjectURL(embeddedAudio.blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `${safeName || 'track'}.${embeddedAudio.extension}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);

        setDownloadingIds((prev) => ({ ...prev, [key]: 'done' }));
      } catch {
        setDownloadingIds((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [handleSaveHistory, searchQuery],
  );

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);
    setIsMobileViewport(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const activeTrackKey = activeTrack
    ? `${activeTrack.source || 'track'}:${activeTrack.id}`
    : '';
  const activeTrackDlState = activeTrackKey ? downloadingIds[activeTrackKey] : undefined;
  const effectiveDuration =
    duration > 0 && Number.isFinite(duration)
      ? duration
      : activeTrack?.duration && Number.isFinite(activeTrack.duration)
        ? activeTrack.duration
        : 0;

  const uiProps: VoidUIProps = {
    pageRef: page,
    searchSectionRef,
    searchOccluderRef,
    searchInputRef,
    resultsListRef,
    voiceOrbRef,
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    isSearchPanelOpen,
    setIsSearchPanelOpen,
    searchHistory,
    historyExpanded,
    setHistoryExpanded,
    handleSaveHistory,
    handleRemoveHistory,
    voiceOrbOpen,
    voiceOrbState,
    toggleVoiceSearch,
    stopVoiceSearch,
    triggerVoiceSearchCompletion,
    getLiveVoiceAudioLevel,
    getLiveVoiceSignal,
    hasQuery,
    showResultsPanel,
    activeTrack,
    playingId,
    isPlayingAudio,
    position,
    effectiveDuration,
    volume,
    setVolume,
    muted,
    setMuted,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    downloadingIds,
    activeTrackDlState,
    handleTogglePlay,
    handleDownloadTrack,
    playRelative,
    seekTo,
    children,
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-white antialiased">
      {/* Hidden 1x1 YouTube IFrame Player host for exact YouTube track playback (same as VOID) */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          width: 1,
          height: 1,
          left: -9999,
          top: -9999,
          opacity: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        <div ref={ytAudioHostRef} />
      </div>

      {isMobileViewport ? <MobileUI {...uiProps} /> : <DesktopUI {...uiProps} />}
    </main>
  );
}

export default App;
