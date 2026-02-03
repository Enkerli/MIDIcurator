import type { BarChordInfo } from '../types/clip';

interface ChordBarProps {
  barChords: BarChordInfo[];
}

/**
 * Horizontal bar showing detected chord per bar.
 * Placed above the piano roll to show the harmonic progression.
 */
export function ChordBar({ barChords }: ChordBarProps) {
  if (barChords.length === 0) return null;

  return (
    <div className="mc-chord-bar">
      {barChords.map((bc) => (
        <div
          key={bc.bar}
          className={`mc-chord-bar-cell ${bc.chord ? '' : 'mc-chord-bar-cell--empty'}`}
          title={
            bc.chord
              ? `Bar ${bc.bar + 1}: ${bc.chord.symbol} (${bc.chord.qualityName})`
              : `Bar ${bc.bar + 1}: no chord detected`
          }
        >
          <span className="mc-chord-bar-symbol">
            {bc.chord ? bc.chord.symbol : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
