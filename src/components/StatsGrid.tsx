import type { Clip } from '../types/clip';

interface StatsGridProps {
  clip: Clip;
  editingBpm: boolean;
  bpmValue: string;
  onBpmChange: (value: string) => void;
  onBpmSave: () => void;
  onStartEditBpm: () => void;
}

export function StatsGrid({
  clip,
  editingBpm,
  bpmValue,
  onBpmChange,
  onBpmSave,
  onStartEditBpm,
}: StatsGridProps) {
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
        <div className="mc-stat-label">Chord</div>
        <div className="mc-stat-value mc-stat-value--chord">
          {clip.harmonic.detectedChord
            ? clip.harmonic.detectedChord.symbol
            : '—'}
        </div>
        {clip.harmonic.detectedChord && (
          <div className="mc-stat-sub">
            {clip.harmonic.detectedChord.qualityName}
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
