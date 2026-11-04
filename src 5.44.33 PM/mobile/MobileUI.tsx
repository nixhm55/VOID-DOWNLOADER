import type { CSSProperties, JSX } from 'react';
import {
  ChevronDown,
  Clock3,
  Pause,
  Play,
  X,
} from 'lucide-react';
import { Cover } from '@/components/cover-renderers/AppCover';
import { LightRays } from '@/components/effects';
import { LiquidGlassOrb } from '@/components/liquid-glass-orb';
import ShinyText from '@/components/ShinyText';
import { SilverDustBackdrop } from '@/components/SilverDustBackdrop';
import StarBorder from '@/components/StarBorder';
import SwarmCursor from '@/components/SwarmCursor';
import {
  SoapBubbleMaterial,
  SoapBubbleSearch,
  SoapBubbleSurface,
} from '@/components/soap-bubble';
import { DgReveal } from '@/motion';
import {
  SEARCH_BUBBLE_MATERIAL_PROPS,
  VoidGlyph,
  formatDuration,
  formatMinimalArtist,
  type VoidUIProps,
} from '@/types/voidUI';
import './mobile.css';

export function MobileUI({
  pageRef,
  searchSectionRef,
  searchOccluderRef,
  searchInputRef,
  resultsListRef,
  voiceOrbRef,
  searchQuery,
  setSearchQuery,
  searchResults,
  isSearching,
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
  downloadingIds,
  activeTrackDlState,
  handleTogglePlay,
  handleDownloadTrack,
  children,
}: VoidUIProps): JSX.Element {
  return (
    <div
      ref={pageRef}
      className="relative h-full w-full overflow-hidden"
      data-theme="dark"
      data-ui-mode="mobile"
      style={{
        background: '#000000',
        color: '#e5e7eb',
      }}
    >
      <div className="pointer-events-none absolute inset-0 z-0 h-full w-full">
        <LightRays
          raysOrigin="top-center"
          raysColor="#ffffff"
          raysSpeed={1}
          lightSpread={0.5}
          rayLength={3}
          glow={0.6}
          haze={0.25}
          followMouse
          mouseInfluence={0.1}
          occluderRef={searchOccluderRef}
        />
      </div>

      <SwarmCursor
        count={650}
        size={2.5}
        spread={76}
        swirl={0.6}
        clickEffect="burst"
        className="void-mobile-stage relative z-10"
      >
        <div className="void-center-brand-wrap">
          <div className="void-center-brand" data-swarm-target="">
            <ShinyText
              text="VOID"
              color="#b5b5b5"
              shineColor="#ffffff"
              speed={2}
              shineWidth={68}
              softness={0.9}
              trigger="loop"
              followPointer
            />
          </div>
        </div>

        <section
          ref={searchSectionRef}
          className="void-mobile-search-section relative z-10 mx-auto w-full"
        >
          <SoapBubbleMaterial {...SEARCH_BUBBLE_MATERIAL_PROPS}>
            <div
              ref={searchOccluderRef}
              className="search-occluder-wrap"
              data-swarm-target=""
            >
              <SoapBubbleSearch
                ref={searchInputRef}
                placeholder={voiceOrbOpen ? 'Listening…' : 'Search'}
                value={searchQuery}
                onFocus={() => setIsSearchPanelOpen(true)}
                onClick={() => setIsSearchPanelOpen(true)}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setIsSearchPanelOpen(true);
                  if (voiceOrbOpen) {
                    stopVoiceSearch();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (searchQuery.trim()) {
                      handleSaveHistory(searchQuery);
                    }
                    if (voiceOrbOpen) {
                      if (searchQuery.trim()) {
                        triggerVoiceSearchCompletion();
                      } else {
                        stopVoiceSearch();
                      }
                    }
                  }
                }}
                micActive={voiceOrbOpen}
                onMicClick={toggleVoiceSearch}
              />
            </div>
          </SoapBubbleMaterial>

          {showResultsPanel && (
            <StarBorder
              as="div"
              className={`search-results-panel${voiceOrbOpen ? ' is-voice-orb-open' : ''}`}
              role="region"
              aria-label={voiceOrbOpen ? 'Voice search' : 'Search results'}
              color="#94a3b8"
              trailColor="#94a3b8"
              duration={9.5}
              direction="clockwise"
              stars={1}
              trailLength={0.4}
              thickness={2}
              radius={22}
              glow={0.75}
              active={
                voiceOrbOpen ||
                !hasQuery ||
                (isSearching && searchResults.length === 0)
              }
              hover="none"
              sparkle={false}
              clickPulse={false}
              theme="dark"
            >
              {voiceOrbOpen ? (
                <div className="voice-orb-persistent-wrap is-active">
                  <SilverDustBackdrop
                    active={true}
                    getVoiceSignal={getLiveVoiceSignal}
                  />
                  <div
                    className="palette-voice-orb-stage"
                    onClick={() => {
                      if (searchQuery.trim() && voiceOrbState === 'listening') {
                        handleSaveHistory(searchQuery);
                        triggerVoiceSearchCompletion();
                      } else {
                        stopVoiceSearch();
                      }
                    }}
                  >
                    <LiquidGlassOrb
                      ref={voiceOrbRef}
                      baseColor="#ffffff"
                      colorA="#000000"
                      colorB="#4d4d4d"
                      colorC="#a9a9a9"
                      seed={145}
                      startTime={18}
                      speed={1.5}
                      distortion={0.8}
                      clusterCount={7.2}
                      clusterIntensity={3}
                      clusterSize={22.5}
                      scale={0.23}
                      spotSize={1.15}
                      rotation={0}
                      softness={0.31}
                      relief={2.94}
                      refraction={0.65}
                      roughness={0}
                      reflection={1.3}
                      caustics={0}
                      dispersion={1}
                      colorDistribution={0}
                      grain={0}
                      grainSize={1}
                      paused={false}
                      animateDistortion={true}
                      grainMode="fine"
                      flowType="drift"
                      state={voiceOrbState}
                      thinkingAnimation="ripples"
                      searchingAnimation="lens"
                      intensity={1}
                      preserveWhites={true}
                      animateEntrance={true}
                      size={184}
                      audioLevel={0.42}
                      getAudioLevel={getLiveVoiceAudioLevel}
                    />
                  </div>
                </div>
              ) : hasQuery ? (
                <div ref={resultsListRef} className="search-results-list">
                  {searchResults.length === 0 ? (
                    isSearching ? null : (
                      <div className="search-status-empty">
                        No songs found for &ldquo;{searchQuery.trim()}&rdquo;
                      </div>
                    )
                  ) : (
                    searchResults.map((item, idx) => {
                      const rowKey = `${item.source || 'track'}:${item.id}`;
                      const isRowPlaying = playingId === rowKey && isPlayingAudio;
                      const dlState = downloadingIds[rowKey];

                      return (
                        <DgReveal
                          key={rowKey}
                          index={idx}
                          className={`palette-result${isRowPlaying ? ' is-playing' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => void handleTogglePlay(item)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              void handleTogglePlay(item);
                            }
                          }}
                        >
                          <Cover track={item} />
                          <div className="palette-result-text">
                            <span className="palette-result-title">{item.name}</span>
                            <span className="palette-result-sub">
                              <span className="palette-result-artist">
                                {formatMinimalArtist(item.artist)}
                              </span>
                              {item.duration > 0 && (
                                <span className="palette-result-duration">
                                  {formatDuration(item.duration)}
                                </span>
                              )}
                            </span>
                          </div>

                          <div className="palette-result-actions">
                            <button
                              type="button"
                              className="icon-button palette-action-btn"
                              aria-label={isRowPlaying ? `Pause ${item.name}` : `Play ${item.name}`}
                              title={isRowPlaying ? 'Pause' : 'Play'}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleTogglePlay(item);
                              }}
                            >
                              {isRowPlaying ? <Pause size={15} /> : <Play size={15} />}
                            </button>

                            <button
                              type="button"
                              className={`download-icon-button palette-action-btn${dlState === 'loading' ? ' is-downloading' : ''}${dlState === 'done' ? ' is-download-success' : ''}`}
                              disabled={dlState === 'loading' || dlState === 'done'}
                              aria-label={
                                dlState === 'done'
                                  ? `Downloaded ${item.name}`
                                  : `Download ${item.name}`
                              }
                              title={
                                dlState === 'done'
                                  ? 'Downloaded'
                                  : dlState === 'loading'
                                    ? 'Saving offline…'
                                    : `Save ${item.name} for offline listening`
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDownloadTrack(item);
                              }}
                            >
                              <svg
                                width="13"
                                height="15"
                                viewBox="0 0 13 15"
                                fill="none"
                                aria-hidden="true"
                                style={{ display: 'block', overflow: 'visible' }}
                              >
                                {dlState === 'done' ? (
                                  <path
                                    className="download-success-check"
                                    d="M2.1 7.7L5.1 10.5L11 3.8"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                ) : (
                                  <path
                                    d="M6.5 1.5V10.5M2.9 7.2L6.5 10.8L10.1 7.2M2.2 13H10.8"
                                    stroke="currentColor"
                                    strokeWidth="1.35"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                )}
                              </svg>
                            </button>
                          </div>
                        </DgReveal>
                      );
                    })
                  )}
                </div>
              ) : (
                searchHistory.length > 0 && (
                  <div
                    className="search-history-list"
                    data-expanded={historyExpanded ? 'true' : 'false'}
                  >
                    <div className="search-history-header">
                      <span className="crumb">Recent Searches</span>
                      {searchHistory.length > 4 && (
                        <button
                          type="button"
                          className={`icon-button search-history-more-btn${historyExpanded ? ' is-expanded' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setHistoryExpanded((prev) => !prev);
                          }}
                          aria-label={
                            historyExpanded
                              ? 'Show fewer recent searches'
                              : 'Show more recent searches'
                          }
                          aria-expanded={historyExpanded}
                          title={historyExpanded ? 'Show less' : 'Show more'}
                        >
                          <ChevronDown size={15} strokeWidth={1.85} />
                        </button>
                      )}
                    </div>
                    <div
                      className={`search-history-items-scroll${historyExpanded ? ' is-expanded' : ''}`}
                    >
                      {(historyExpanded ? searchHistory : searchHistory.slice(0, 4)).map(
                        (term, i) => (
                          <div
                            key={`history-${term}-${i}`}
                            className={`palette-result search-history-item${i >= 4 ? ' is-extra-history' : ''}`}
                            role="button"
                            tabIndex={0}
                            style={
                              i >= 4
                                ? ({
                                    cursor: 'pointer',
                                    '--hist-idx': Math.min(i - 4, 8),
                                  } as CSSProperties)
                                : { cursor: 'pointer' }
                            }
                            onClick={() => {
                              setSearchQuery(term);
                              setIsSearchPanelOpen(true);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSearchQuery(term);
                                setIsSearchPanelOpen(true);
                              }
                            }}
                          >
                            <Clock3 size={16} />
                            <span>{term}</span>
                            <div style={{ marginLeft: 'auto', display: 'flex' }}>
                              <button
                                type="button"
                                className="icon-button"
                                style={{ width: 28, height: 28, pointerEvents: 'auto' }}
                                onClick={(e) => handleRemoveHistory(term, e)}
                                aria-label="Remove from history"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )
              )}
            </StarBorder>
          )}

          {children}
        </section>

        {/* Mobile Floating Liquid Glass Mini Player using Search Bar Liquid Glass format */}
        {activeTrack && (
          <SoapBubbleMaterial {...SEARCH_BUBBLE_MATERIAL_PROPS}>
            <SoapBubbleSurface
              className="player-bar void-mobile-player-bar"
              radius={9999}
              interactive={0.4}
              data-swarm-target=""
              data-testid="player-bar"
            >
              <div className="player-track" data-testid="player-current-track">
                <Cover track={activeTrack} />
                <span>
                  <span className="track-title mini-player-title-row">
                    {activeTrack.name}
                  </span>
                  <span className="track-sub mini-player-sub-row">
                    <span className="mini-player-artist-name">
                      {formatMinimalArtist(activeTrack.artist)}
                    </span>
                  </span>
                </span>
              </div>

              <div className="void-mobile-player-actions">
                <button
                  type="button"
                  className={`download-icon-button${activeTrackDlState === 'loading' ? ' is-downloading' : ''}${activeTrackDlState === 'done' ? ' is-download-success' : ''}`}
                  disabled={activeTrackDlState === 'loading' || activeTrackDlState === 'done'}
                  aria-label={
                    activeTrackDlState === 'done'
                      ? `Downloaded ${activeTrack.name}`
                      : `Download ${activeTrack.name}`
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDownloadTrack(activeTrack);
                  }}
                  style={{ width: 32, height: 32 }}
                >
                  <svg
                    width="13"
                    height="15"
                    viewBox="0 0 13 15"
                    fill="none"
                    aria-hidden="true"
                    style={{ display: 'block', overflow: 'visible' }}
                  >
                    {activeTrackDlState === 'done' ? (
                      <path
                        className="download-success-check"
                        d="M2.1 7.7L5.1 10.5L11 3.8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : (
                      <path
                        d="M6.5 1.5V10.5M2.9 7.2L6.5 10.8L10.1 7.2M2.2 13H10.8"
                        stroke="currentColor"
                        strokeWidth="1.35"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>
                </button>

                <button
                  type="button"
                  className="icon-button mobile-mini-play"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleTogglePlay(activeTrack);
                  }}
                  aria-label={isPlayingAudio ? 'Pause' : 'Play'}
                >
                  <VoidGlyph playing={isPlayingAudio} />
                </button>
              </div>
            </SoapBubbleSurface>
          </SoapBubbleMaterial>
        )}
      </SwarmCursor>
    </div>
  );
}

export default MobileUI;
