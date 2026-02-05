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
      {barChords.map((bc) => {
        // Format pitch class set for display
        const pcsStr = bc.pitchClasses.length > 0
          ? `[${bc.pitchClasses.sort((a, b) => a - b).join(',')}]`
          : '';

        const displayText = bc.chord
          ? bc.chord.symbol
          : bc.pitchClasses.length > 0
            ? `?? ${pcsStr}`
            : '—';

        const titleText = bc.chord
          ? `Bar ${bc.bar + 1}: ${bc.chord.symbol} (${bc.chord.qualityName})`
          : bc.pitchClasses.length > 0
            ? `Bar ${bc.bar + 1}: unrecognized structure ${pcsStr}`
            : `Bar ${bc.bar + 1}: no notes`;

        return (
          <div
            key={bc.bar}
            className={`mc-chord-bar-cell ${bc.chord ? '' : 'mc-chord-bar-cell--empty'}`}
            title={titleText}
          >
            <span className="mc-chord-bar-symbol">
              {displayText}
            </span>
          </div>
        );
      })}
    </div>
  );
}
