import type { Clip } from '../types/clip';

interface ClipCardProps {
  clip: Clip;
  isSelected: boolean;
  onClick: () => void;
}

export function ClipCard({ clip, isSelected, onClick }: ClipCardProps) {
  const densityMatch = clip.notes?.match(/density: ([\d.]+)x/);

  return (
    <div
      className={`mc-clip-card ${isSelected ? 'mc-clip-card--selected' : ''}`}
      onClick={onClick}
    >
      <div className="mc-clip-card-name">
        {clip.filename}
        {clip.source && <span className="mc-clip-card-variant-dot">&#x25CF;</span>}
      </div>
      <div className="mc-clip-card-meta">
        {clip.bpm} BPM &bull; {clip.gesture.density.toFixed(1)} density
        {densityMatch && (
          <span className="mc-clip-card-density-tag">
            ({densityMatch[1]}x)
          </span>
        )}
        {clip.harmonic.detectedChord && (
          <span className="mc-clip-card-chord">
            &bull; {clip.harmonic.detectedChord.symbol}
          </span>
        )}
      </div>
    </div>
  );
}
