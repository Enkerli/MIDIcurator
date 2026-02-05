import { useMemo } from 'react';
import type { Clip, DetectedChord } from '../types/clip';

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
}

/**
 * Get the chord and pitch classes at the current playhead position.
 * Falls back to overall detected chord when stopped.
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
}: StatsGridProps) {
  const chordInfo = useMemo(
    () => getChordInfoAtTime(clip, playbackTime, isPlaying),
    [clip, playbackTime, isPlaying],
  );

  const chordLabel = isPlaying && playbackTime > 0 ? 'Chord (at playhead)' : 'Chord';

  // Format pitch class set for display
  const pcsStr = chordInfo.pitchClasses.length > 0
    ? `[${[...new Set(chordInfo.pitchClasses)].sort((a, b) => a - b).join(',')}]`
    : '';

  const chordDisplayText = chordInfo.chord
    ? chordInfo.chord.symbol
    : chordInfo.pitchClasses.length > 0
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
              value={bpmValue}
              onChange={(e) => onBpmChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onBpmSave()}
              autoFocus
            />
            <button className="mc-bpm-save" onClick={onBpmSave}>
              &#x2713;
            </button>
          </div>
        ) : (
          <div className="mc-stat-value mc-stat-value--editable" onClick={onStartEditBpm}>
            {clip.bpm}
            <span className="mc-stat-edit-icon">&#x270E;</span>
          </div>
        )}
      </div>
      <div className="mc-stat-box">
        <div className="mc-stat-label">{chordLabel}</div>
        <div className="mc-stat-value mc-stat-value--chord">
          {chordDisplayText}
        </div>
        {chordInfo.chord ? (
          <div className="mc-stat-sub">
            {chordInfo.chord.qualityName}
          </div>
        ) : chordInfo.pitchClasses.length > 0 ? (
          <div className="mc-stat-sub">
            unrecognized structure
          </div>
        ) : null}
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
