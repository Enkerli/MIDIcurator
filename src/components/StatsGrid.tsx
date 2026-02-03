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
 * Get the chord at the current playhead position.
 * Falls back to overall detected chord when stopped.
 */
function getChordAtTime(clip: Clip, time: number, isPlaying: boolean): DetectedChord | null | undefined {
  if (!isPlaying || time <= 0 || !clip.harmonic.barChords || clip.harmonic.barChords.length === 0) {
    return clip.harmonic.detectedChord;
  }

  // Convert time (seconds) to ticks
  const ticksPerSecond = (clip.bpm / 60) * clip.gesture.ticks_per_beat;
  const currentTick = time * ticksPerSecond;
  const currentBar = Math.floor(currentTick / clip.gesture.ticks_per_bar);

  // Find the bar chord
  if (currentBar >= 0 && currentBar < clip.harmonic.barChords.length) {
    return clip.harmonic.barChords[currentBar].chord;
  }

  return clip.harmonic.detectedChord;
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
  const currentChord = useMemo(
    () => getChordAtTime(clip, playbackTime, isPlaying),
    [clip, playbackTime, isPlaying],
  );

  const chordLabel = isPlaying && playbackTime > 0 ? 'Chord (at playhead)' : 'Chord';

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
          {currentChord ? currentChord.symbol : '—'}
        </div>
        {currentChord && (
          <div className="mc-stat-sub">
            {currentChord.qualityName}
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
