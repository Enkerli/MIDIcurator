import type { Leadsheet, LeadsheetChord } from '../types/clip';

interface LeadsheetBarProps {
  leadsheet: Leadsheet;
  ticksPerBar: number;
  ticksPerBeat: number;
  numBars: number;
  /** When set, use pixel widths instead of percentages (for zoom alignment). */
  drawWidth?: number;
}

/**
 * Bar-quantized leadsheet display showing the underlying harmony.
 * Rendered above the realized ChordBar.
 */
export function LeadsheetBar({
  leadsheet,
  ticksPerBar,
  ticksPerBeat,
  numBars,
  drawWidth,
}: LeadsheetBarProps) {
  if (leadsheet.bars.length === 0) return null;

  // Use bar grid (numBars * ticksPerBar) for harmonic alignment, not totalTicks (MIDI extent)
  const harmonicTicks = numBars * ticksPerBar;

  const usePixelWidths = drawWidth !== undefined;
  const barWidthPercent = (ticksPerBar / harmonicTicks) * 100;
  const barWidthPx = usePixelWidths ? (ticksPerBar / harmonicTicks) * drawWidth : 0;
  const barWidthStyle = usePixelWidths
    ? { width: `${barWidthPx}px` }
    : { width: `${barWidthPercent}%` };
  const containerStyle = usePixelWidths ? { width: `${drawWidth}px` } : undefined;

  const beatsPerBar = ticksPerBar / ticksPerBeat;

  /**
   * Calculate chord style (position and width) based on beat timing.
   * Falls back to equal division if timing is not specified.
   */
  const getChordStyle = (
    chord: LeadsheetChord,
    chordIndex: number,
  ): React.CSSProperties => {
    // If chord has explicit beat position and duration, use those
    if (chord.beatPosition !== undefined && chord.duration !== undefined) {
      const leftPercent = (chord.beatPosition / beatsPerBar) * 100;
      const widthPercent = (chord.duration / beatsPerBar) * 100;
      return {
        position: 'absolute',
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
      };
    }

    // Fallback: equal division based on totalInBar
    const widthPercent = 100 / chord.totalInBar;
    const leftPercent = chordIndex * widthPercent;
    return {
      position: 'absolute',
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
    };
  };

  return (
    <div className="mc-leadsheet-bar" style={containerStyle}>
      {Array.from({ length: numBars }, (_, i) => {
        const bar = leadsheet.bars.find(b => b.bar === i);

        if (!bar || bar.chords.length === 0) {
          return (
            <div
              key={i}
              className="mc-leadsheet-cell mc-leadsheet-cell--nc"
              style={barWidthStyle}
              title={`Bar ${i + 1}: no chord`}
            >
              <span className="mc-leadsheet-chord mc-leadsheet-chord--nc">NC</span>
            </div>
          );
        }

        if (bar.isRepeat) {
          return (
            <div
              key={i}
              className="mc-leadsheet-cell mc-leadsheet-cell--repeat"
              style={barWidthStyle}
              title={`Bar ${i + 1}: repeat`}
            >
              <span className="mc-leadsheet-chord mc-leadsheet-chord--repeat">%</span>
            </div>
          );
        }

        // Single or multi-chord bar
        const isNc = bar.chords.length === 1 && !bar.chords[0]!.chord && bar.chords[0]!.inputText.toUpperCase() === 'NC';
        if (isNc) {
          return (
            <div
              key={i}
              className="mc-leadsheet-cell mc-leadsheet-cell--nc"
              style={barWidthStyle}
              title={`Bar ${i + 1}: no chord`}
            >
              <span className="mc-leadsheet-chord mc-leadsheet-chord--nc">NC</span>
            </div>
          );
        }

        return (
          <div
            key={i}
            className="mc-leadsheet-cell"
            style={{ ...barWidthStyle, position: 'relative' }}
            title={`Bar ${i + 1}: ${bar.chords.map(c => c.chord?.symbol ?? c.inputText).join(' ')}`}
          >
            {bar.chords.map((lc, j) => {
              const isInvalid = !lc.chord && lc.inputText.toUpperCase() !== 'NC';
              return (
                <span
                  key={j}
                  className={`mc-leadsheet-chord ${isInvalid ? 'mc-leadsheet-chord--invalid' : ''}`}
                  style={getChordStyle(lc, j)}
                >
                  {lc.chord?.symbol ?? lc.inputText}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
