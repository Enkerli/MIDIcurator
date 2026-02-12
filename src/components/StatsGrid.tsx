import { useMemo, useState, useCallback } from 'react';
import type { Clip, DetectedChord } from '../types/clip';
import { rootName, spellInChordContext } from '../lib/chord-dictionary';
import { parseChordSymbol } from '../lib/chord-parser';

interface StatsGridProps {
  clip: Clip;
  editingBpm: boolean;
  bpmValue: string;
  onBpmChange: (value: string) => void;
  onBpmSave: () => void;
  onStartEditBpm: () => void;
  /** Current playback time in seconds (for dynamic chord display) */
  playbackTime: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Chord info from range selection (takes priority over playhead/overall) */
  rangeChordInfo?: {
    chord: DetectedChord | null;
    pitchClasses: number[];
    noteCount: number;
  } | null;
  /** Called to override bar chord(s) with the current detected chord */
  onOverrideChord?: () => void;
  /** Called to adapt notes to a new chord (chord substitution) */
  onAdaptChord?: (newChord: DetectedChord) => void;
}

/**
 * Get the chord and pitch classes at the current playhead position.
 * Falls back to overall detected chord when stopped.
 * Supports sub-bar segments for bars with multiple chords.
 */
function getChordInfoAtTime(
  clip: Clip,
  time: number,
  isPlaying: boolean,
): { chord: DetectedChord | null | undefined; pitchClasses: number[] } {
  if (!isPlaying || time <= 0 || !clip.harmonic.barChords || clip.harmonic.barChords.length === 0) {
    return {
      chord: clip.harmonic.detectedChord,
      pitchClasses: clip.harmonic.pitchClasses || [],
    };
  }

  // Convert time (seconds) to ticks
  const ticksPerSecond = (clip.bpm / 60) * clip.gesture.ticks_per_beat;
  const currentTick = time * ticksPerSecond;
  const currentBar = Math.floor(currentTick / clip.gesture.ticks_per_bar);

  // Find the bar chord
  if (currentBar >= 0 && currentBar < clip.harmonic.barChords.length) {
    const barInfo = clip.harmonic.barChords[currentBar];

    // Check for sub-bar segments
    if (barInfo.segments && barInfo.segments.length > 1) {
      const localTick = currentTick - (currentBar * clip.gesture.ticks_per_bar);
      const segmentIndex = barInfo.segments.findIndex(
        s => localTick >= s.startTick && localTick < s.endTick
      );
      if (segmentIndex >= 0) {
        const segment = barInfo.segments[segmentIndex];
        // Inherit from previous segment if this one is empty (resonance principle)
        let chord = segment.chord;
        if (!chord) {
          for (let i = segmentIndex - 1; i >= 0; i--) {
            if (barInfo.segments[i].chord) {
              chord = barInfo.segments[i].chord;
              break;
            }
          }
        }
        return {
          chord,
          pitchClasses: barInfo.pitchClasses || [],
        };
      }
    }

    return {
      chord: barInfo.chord,
      pitchClasses: barInfo.pitchClasses || [],
    };
  }

  return {
    chord: clip.harmonic.detectedChord,
    pitchClasses: clip.harmonic.pitchClasses || [],
  };
}

export function StatsGrid({
  clip,
  editingBpm,
  bpmValue,
  onBpmChange,
  onBpmSave,
  onStartEditBpm,
  playbackTime,
  isPlaying,
  rangeChordInfo,
  onOverrideChord,
  onAdaptChord,
}: StatsGridProps) {
  // Chord input state for substitution
  const [chordInput, setChordInput] = useState('');

  // Parse the input to check validity
  const parsedInputChord = useMemo(
    () => chordInput.trim() ? parseChordSymbol(chordInput) : null,
    [chordInput]
  );

  const isInputValid = parsedInputChord !== null;

  const handleAdaptClick = useCallback(() => {
    if (parsedInputChord && onAdaptChord) {
      onAdaptChord(parsedInputChord);
      setChordInput(''); // Clear input after adapting
    }
  }, [parsedInputChord, onAdaptChord]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && parsedInputChord && onAdaptChord) {
      e.preventDefault();
      handleAdaptClick();
    }
    if (e.key === 'Escape') {
      setChordInput('');
      (e.target as HTMLInputElement).blur();
    }
  }, [parsedInputChord, onAdaptChord, handleAdaptClick]);
  const playbackChordInfo = useMemo(
    () => getChordInfoAtTime(clip, playbackTime, isPlaying),
    [clip, playbackTime, isPlaying],
  );

  // Priority: range selection > playhead > overall
  const effectiveChordInfo = rangeChordInfo ?? playbackChordInfo;

  const chordLabel = rangeChordInfo
    ? `Chord (${rangeChordInfo.noteCount} notes selected)`
    : isPlaying && playbackTime > 0
      ? 'Chord (at playhead)'
      : 'Chord';

  // Format pitch class set for display
  const pcsStr = effectiveChordInfo.pitchClasses.length > 0
    ? `[${[...new Set(effectiveChordInfo.pitchClasses)].sort((a, b) => a - b).join(',')}]`
    : '';

  // Format note names for display, spelled consistently with the chord root's accidental
  const chordRoot = effectiveChordInfo.chord;
  const noteNamesStr = effectiveChordInfo.pitchClasses.length > 0
    ? [...new Set(effectiveChordInfo.pitchClasses)]
        .sort((a, b) => a - b)
        .map(pc => chordRoot
          ? spellInChordContext(pc, chordRoot.root, chordRoot.rootName)
          : rootName(pc))
        .join(' ')
    : '';

  const chordDisplayText = effectiveChordInfo.chord
    ? effectiveChordInfo.chord.symbol
    : effectiveChordInfo.pitchClasses.length > 0
      ? `?? ${pcsStr}`
      : '—';

  return (
    <div className="mc-stats-grid">
      <div className="mc-stat-box">
        <div className="mc-stat-label">BPM</div>
        {editingBpm ? (
          <div className="mc-bpm-edit">
            <input
              type="number"
              className="mc-bpm-input"
              aria-label="Edit tempo in beats per minute"
              value={bpmValue}
              onChange={(e) => onBpmChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onBpmSave()}
              autoFocus
            />
            <button
              className="mc-bpm-save"
              onClick={onBpmSave}
              aria-label="Save tempo"
            >
              &#x2713;
            </button>
          </div>
        ) : (
          <div
            className="mc-stat-value mc-stat-value--editable"
            onClick={onStartEditBpm}
            role="button"
            tabIndex={0}
            aria-label={`Tempo: ${clip.bpm} BPM. Click to edit.`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onStartEditBpm();
              }
            }}
          >
            {clip.bpm}
            <span className="mc-stat-edit-icon" aria-hidden="true">&#x270E;</span>
          </div>
        )}
      </div>
      <div className="mc-stat-box">
        <div className="mc-stat-label">{chordLabel}</div>
        <div
          className="mc-stat-value mc-stat-value--chord"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {chordDisplayText}
        </div>
        {effectiveChordInfo.chord ? (
          <div className="mc-stat-sub">
            {effectiveChordInfo.chord.qualityName}
            {noteNamesStr && <span className="mc-stat-notes">{noteNamesStr}</span>}
            {onOverrideChord && rangeChordInfo && (
              <button
                className="mc-btn--tag-chord"
                onClick={onOverrideChord}
                aria-label={`Set bar chord to ${effectiveChordInfo.chord.symbol}`}
                title={`Set bar chord to "${effectiveChordInfo.chord.symbol}"`}
              >
                Set
              </button>
            )}
          </div>
        ) : effectiveChordInfo.pitchClasses.length > 0 ? (
          <div className="mc-stat-sub">
            unrecognized structure
            {noteNamesStr && <span className="mc-stat-notes">{noteNamesStr}</span>}
          </div>
        ) : null}
        {/* Chord substitution input - only show when range is selected */}
        {rangeChordInfo && onAdaptChord && (
          <div className="mc-chord-adapt">
            <input
              type="text"
              className={`mc-chord-input ${chordInput && !isInputValid ? 'mc-chord-input--invalid' : ''} ${chordInput && isInputValid ? 'mc-chord-input--valid' : ''}`}
              placeholder="New chord (e.g., Am)"
              aria-label="Enter chord symbol for substitution"
              aria-invalid={chordInput.trim() !== '' && !isInputValid}
              value={chordInput}
              onChange={(e) => setChordInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <button
              className="mc-btn--adapt-chord"
              onClick={handleAdaptClick}
              disabled={!isInputValid}
              aria-label={isInputValid && parsedInputChord ? `Adapt notes to ${parsedInputChord.symbol}` : 'Enter a valid chord symbol'}
              title={isInputValid && parsedInputChord ? `Adapt notes to ${parsedInputChord.symbol}` : 'Enter a valid chord symbol'}
            >
              Adapt
            </button>
            {chordInput.trim() !== '' && !isInputValid && (
              <span className="mc-error-message" role="alert">
                Invalid chord symbol. Try: C, Am, Dm7, G7, etc.
              </span>
            )}
          </div>
        )}
      </div>
      <div className="mc-stat-box">
        <div className="mc-stat-label">Notes</div>
        <div className="mc-stat-value">{clip.gesture.onsets.length}</div>
      </div>
      <div className="mc-stat-box">
        <div className="mc-stat-label">Density</div>
        <div className="mc-stat-value">{clip.gesture.density.toFixed(2)}</div>
      </div>
      <div className="mc-stat-box">
        <div className="mc-stat-label">Syncopation</div>
        <div className="mc-stat-value">{clip.gesture.syncopation_score.toFixed(2)}</div>
      </div>
    </div>
  );
}
