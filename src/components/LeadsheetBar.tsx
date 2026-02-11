import type { Leadsheet } from '../types/clip';

interface LeadsheetBarProps {
  leadsheet: Leadsheet;
  ticksPerBar: number;
  totalTicks: number;
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
  totalTicks,
  numBars,
  drawWidth,
}: LeadsheetBarProps) {
  if (leadsheet.bars.length === 0) return null;

  const usePixelWidths = drawWidth !== undefined;
  const barWidthPercent = (ticksPerBar / totalTicks) * 100;
  const barWidthPx = usePixelWidths ? (ticksPerBar / totalTicks) * drawWidth : 0;
  const barWidthStyle = usePixelWidths
    ? { width: `${barWidthPx}px` }
    : { width: `${barWidthPercent}%` };
  const containerStyle = usePixelWidths ? { width: `${drawWidth}px` } : undefined;

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
            style={barWidthStyle}
            title={`Bar ${i + 1}: ${bar.chords.map(c => c.chord?.symbol ?? c.inputText).join(' ')}`}
          >
            {bar.chords.map((lc, j) => {
              const isInvalid = !lc.chord && lc.inputText.toUpperCase() !== 'NC';
              return (
                <span
                  key={j}
                  className={`mc-leadsheet-chord ${isInvalid ? 'mc-leadsheet-chord--invalid' : ''}`}
                  style={{ width: `${100 / lc.totalInBar}%` }}
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
