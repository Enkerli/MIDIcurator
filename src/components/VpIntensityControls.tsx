import { useMemo } from 'react';
import type { Clip } from '../types/clip';
import { computeIntensityStats } from '../lib/intensity-synthesis';

interface VpIntensityControlsProps {
  clip: Clip;
  /** All sibling clips: same vpMeta.source + pattern, any intensity. */
  siblings: Clip[];
  onSynthesize: (targetIntensity: string) => void;
}

/** Intensities in ascending order. Synthesis only goes downward. */
const ALL_INTENSITIES = ['1', '3', '5', '6', '8', '10'] as const;
type KnownIntensity = typeof ALL_INTENSITIES[number];

/** Human-readable label for a metric value. */
function fmtStat(key: string, val: number): string {
  if (key === 'velMean') return val.toFixed(1);
  if (key === 'onsetDensity') return val.toFixed(2);
  return String(val);
}

/** Signed delta string, e.g. "+12" or "−5". */
function fmtDelta(delta: number): string {
  if (delta === 0) return '—';
  return (delta > 0 ? '+' : '') + delta.toFixed(delta % 1 === 0 ? 0 : 1);
}

const METRIC_LABELS: Record<string, string> = {
  noteCount:    'Notes',
  velMean:      'Vel mean',
  onsetDensity: 'Onset/bar',
  pitchRange:   'Pitch range',
};

export function VpIntensityControls({ clip, siblings, onSynthesize }: VpIntensityControlsProps) {
  // Always call hooks — conditional rendering happens after.
  const sourceStats = useMemo(
    () => computeIntensityStats(clip.gesture, clip.harmonic),
    [clip],
  );

  // Build a map: intensity string → sibling clip (original, if imported)
  const siblingByIntensity = useMemo(() => {
    const map = new Map<string, Clip>();
    for (const s of siblings) {
      if (s.vpMeta?.intensity) map.set(s.vpMeta.intensity, s);
    }
    return map;
  }, [siblings]);

  // Build a map: intensity string → synthesized sibling (tagged as X-synth)
  const synthByIntensity = useMemo(() => {
    const map = new Map<string, Clip>();
    for (const s of siblings) {
      const intens = s.vpMeta?.intensity;
      if (intens?.endsWith('-synth')) {
        map.set(intens.replace('-synth', ''), s);
      }
    }
    return map;
  }, [siblings]);

  // Only render for VP clips that have lower intensities available.
  const sourceIntensity = clip.vpMeta?.intensity;
  if (!sourceIntensity) return null;

  const targetIntensities = ALL_INTENSITIES.filter(
    (i): i is KnownIntensity => parseInt(i) < parseInt(sourceIntensity),
  );
  if (targetIntensities.length === 0) return null;

  return (
    <div className="mc-transform-section">
      <h3>Intensity Variants</h3>
      <div className="mc-transform-panel">
        <p className="mc-note-count-preview">
          Source: intensity {sourceIntensity} — {sourceStats.noteCount} notes,
          {' '}vel {sourceStats.velMean.toFixed(1)},
          {' '}{sourceStats.onsetDensity.toFixed(2)} onset/bar
        </p>

        <div className="mc-density-presets">
          {targetIntensities.map(target => {
            const already = synthByIntensity.has(target);
            return (
              <button
                key={target}
                className={`mc-preset-btn${already ? ' mc-preset-btn--active' : ''}`}
                title={already ? `Re-synthesize intensity ${target}` : `Synthesize intensity ${target}`}
                onClick={() => onSynthesize(target)}
              >
                →{target}
              </button>
            );
          })}
        </div>

        {/* Comparison table: one row per synthesized intensity */}
        {targetIntensities.some(t => synthByIntensity.has(t)) && (
          <table className="mc-intensity-compare">
            <thead>
              <tr>
                <th>Intensity</th>
                {Object.values(METRIC_LABELS).map(label => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {targetIntensities.filter(t => synthByIntensity.has(t)).map(target => {
                const synth  = synthByIntensity.get(target)!;
                const orig   = siblingByIntensity.get(target);
                const synthStats = computeIntensityStats(synth.gesture, synth.harmonic);
                const origStats  = orig ? computeIntensityStats(orig.gesture, orig.harmonic) : null;

                return (
                  <tr key={target}>
                    <td>{target}</td>
                    {(Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[]).map(metric => {
                      const sVal = synthStats[metric as keyof typeof synthStats] as number;
                      const oVal = origStats?.[metric as keyof typeof origStats] as number | undefined;
                      const delta = oVal !== undefined ? sVal - oVal : null;
                      return (
                        <td key={metric} className={delta !== null && Math.abs(delta) > 0 ? 'mc-intensity-delta' : ''}>
                          {fmtStat(metric, sVal)}
                          {oVal !== undefined && (
                            <span
                              className="mc-intensity-orig"
                              title={`Original intensity ${target}: ${fmtStat(metric, oVal)}`}
                            >
                              {' '}({fmtDelta(delta!)})
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
