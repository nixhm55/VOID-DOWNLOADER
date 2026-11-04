import type { CSSProperties, JSX } from 'react';
import {
  ChevronDown,
  Clock3,
  Pause,
  Play,
  X,
} from 'lucide-react';
import { Cover } from '@/components/cover-renderers/AppCover';
import { LiquidGlassOrb } from '@/components/liquid-glass-orb';
import { SilverDustBackdrop } from '@/components/SilverDustBackdrop';
import StarBorder from '@/components/StarBorder';
import {
  SoapBubbleMaterial,
  SoapBubbleSearch,
  SoapBubbleSurface,
} from '@/components/soap-bubble';
import { TopographicTerrain } from '@/components/topographic-terrain';
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
  handleTogglePlay,
  handleDownloadTrack,
  children,
}: VoidUIProps): JSX.Element {
  const activeTrackKey = activeTrack
    ? `${activeTrack.source || 'track'}:${activeTrack.id}`
    : '';

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
      <TopographicTerrain
        className="h-full w-full"
        animateEntrance={true}
        scale={400}
        density={6}
        speed={1.5}
        distortion={2.4}
        lineWidth={0.5}
        opacity={0}
        seed={42}
        gradientDiffusion={0}
        surfaceColor="#000000"
        shadowColor="#9d9d9d"
        shadowAnimation="none"
        shadowCycleDuration={6}
        elevation={160}
        cameraTilt={38}
        cameraRotation={-20}
        cameraZoom={1}
        terraceSoftness={0.6}
        lightingBlend={0}
        lightDirection={315}
        lightIntensity={1}
        hover={0.45}
        hoverRadius={200}
        hoverFollow={0.16}
        hoverFade={0.8}
        grain={0.2}
        paused={false}
        backgroundColor="#000000"
        backgroundImage="none"
        gradientColors={[]}
        lineColor="#ffffff"
        accentColor="#ffffff"
      >
        <div className="void-mobile-stage relative z-10 pointer-events-none">
          <section
            ref={searchSectionRef}
            className="void-mobile-search-section pointer-events-auto"
          >
            <SoapBubbleMaterial {...SEARCH_BUBBLE_MATERIAL_PROPS}>
              <div ref={searchOccluderRef} className="search-occluder-wrap">
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
                      <div className="search-status-empty">
                        {isSearching ? 'Searching songs…' : 'No matching songs found'}
                      </div>
                    ) : (
                      searchResults.map((item, idx) => {
                        const rowKey = `${item.source || 'track'}:${item.id}`;
                        const active = playingId === rowKey && isPlayingAudio;
                        const dlState = downloadingIds[rowKey];
                        const durText = formatDuration(item.duration);
                        const artistText = formatMinimalArtist(item.artist);

                        return (
                          <DgReveal
                            as="div"
                            dir="row"
                            index={idx}
                            key={rowKey}
                            className="search-result-row"
                            data-active={active || undefined}
                            onClick={() => void handleTogglePlay(item)}
                          >
                            <Cover track={item} identity={rowKey} loading="lazy" />

                            <div className="search-result-meta">
                              <div className="search-result-title" title={item.name}>
                                {item.name}
                              </div>
                              <div className="search-result-sub">
                                <span className="search-result-artist" title={item.artist}>
                                  {artistText}
                                </span>
                                {durText && (
                                  <span className="search-result-duration">{durText}</span>
                                )}
                              </div>
                            </div>

                            <div className="search-result-actions">
                              <button
                                type="button"
                                className="row-play-icon-button"
                                aria-label={active ? `Pause ${item.name}` : `Play ${item.name}`}
                                title={active ? 'Pause' : 'Play'}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleTogglePlay(item);
                                }}
                              >
                                {active ? <Pause /> : <Play />}
                              </button>
                              <button
                                type="button"
                                className={`download-icon-button${dlState === 'loading' ? ' is-downloading' : ''}${dlState === 'done' ? ' is-download-success' : ''}`}
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

          {activeTrack && (
            <SoapBubbleMaterial {...SEARCH_BUBBLE_MATERIAL_PROPS}>
              <SoapBubbleSurface
                as="footer"
                radius={16}
                interactive={0.18}
                className="player-bar void-mobile-player-bar pointer-events-auto"
                role="region"
                aria-label="Now playing"
              >
                <div className="player-track">
                  <Cover track={activeTrack} identity={activeTrackKey} loading="eager" />
                  <span>
                    <span
                      className="track-title mini-player-title-row"
                      title={activeTrack.name}
                    >
                      {activeTrack.name}
                    </span>
                    <span className="track-sub mini-player-sub-row">
                      <span
                        className="mini-player-artist-name"
                        title={activeTrack.artist}
                      >
                        {formatMinimalArtist(activeTrack.artist)}
                      </span>
                    </span>
                  </span>
                </div>

                <button
                  type="button"
                  className="mobile-mini-play"
                  aria-label={isPlayingAudio ? 'Pause' : 'Play'}
                  title={isPlayingAudio ? 'Pause' : 'Play'}
                  onClick={() => void handleTogglePlay(activeTrack)}
                >
                  <VoidGlyph playing={isPlayingAudio} />
                </button>
              </SoapBubbleSurface>
            </SoapBubbleMaterial>
          )}
        </div>
      </TopographicTerrain>
    </div>
  );
}

export default MobileUI;
