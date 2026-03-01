/**
 * VP Virtual Pianist — intensity synthesis.
 *
 * Simulates lower-intensity variants from a higher-intensity source clip by
 * selectively removing notes (prioritising weak metric positions, low velocity,
 * and pitch extremes) then rescaling velocities to match the target mean.
 */

import type { Gesture, Harmonic, DetectedChord, BarChordInfo } from '../types/clip';
import type { TransformResult } from '../types/transform';
import { computeSyncopation } from './gesture';
import { detectOverallChord, detectChordsPerBar, type ChordMatch } from './chord-detect';

// ---------------------------------------------------------------------------
// Public stats helper (used by the comparison table in VpIntensityControls)
// ---------------------------------------------------------------------------

export interface IntensityStats {
  noteCount: number;
  velMean: number;
  /** Unique-onset slots per bar, quantised to 8th-note grid */
  onsetDensity: number;
  pitchRange: number;
}

export function computeIntensityStats(gesture: Gesture, harmonic: Harmonic): IntensityStats {
  const { onsets, velocities, num_bars, ticks_per_beat } = gesture;
  const { pitches } = harmonic;

  const eighth = ticks_per_beat / 2;
  const uniqueOnsets = new Set(onsets.map(o => Math.round(o / eighth)));
  const onsetDensity = num_bars > 0 ? uniqueOnsets.size / num_bars : 0;

  const velMean = velocities.length
    ? velocities.reduce((a, b) => a + b, 0) / velocities.length
    : 0;

  const pitchRange =
    pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0;

  return {
    noteCount: onsets.length,
    velMean: Math.round(velMean * 10) / 10,
    onsetDensity: Math.round(onsetDensity * 100) / 100,
    pitchRange,
  };
}

// ---------------------------------------------------------------------------
// Fallback ratios (from vp-intensity-analysis aggregate)
// Used when the sibling at target intensity is not in the DB.
// note_ratio / vel_ratio are relative to intensity-10 baseline.
// ---------------------------------------------------------------------------

const FALLBACK_RATIOS: Record<string, { noteRatio: number; velRatio: number }> = {
  '1':  { noteRatio: 0.28, velRatio: 0.87 },
  '3':  { noteRatio: 0.37, velRatio: 0.90 },
  '5':  { noteRatio: 0.46, velRatio: 0.93 },
  '6':  { noteRatio: 0.53, velRatio: 0.99 },  // 5→6 is mostly velocity
  '8':  { noteRatio: 0.66, velRatio: 0.95 },
  '10': { noteRatio: 1.00, velRatio: 1.00 },
};

export function fallbackTargets(
  sourceNoteCount: number,
  sourceVelMean: number,
  targetIntensity: string,
): { targetNoteCount: number; targetVelMean: number } {
  const r = FALLBACK_RATIOS[targetIntensity] ?? { noteRatio: 0.5, velRatio: 0.9 };
  return {
    targetNoteCount: Math.max(1, Math.round(sourceNoteCount * r.noteRatio)),
    targetVelMean: Math.round(sourceVelMean * r.velRatio),
  };
}

// ---------------------------------------------------------------------------
// Per-note scoring
// ---------------------------------------------------------------------------

/**
 * How metrically weak is this onset? (0 = strong downbeat, 1 = weakest subdivision)
 */
function noteMetricWeakness(onset: number, tpb: number, tpBar: number): number {
  const posInBar = ((onset % tpBar) + tpBar) % tpBar;
  const posInBeat = posInBar % tpb;

  if (posInBeat === 0) {
    // Exactly on a beat boundary
    const beatNum = Math.floor(posInBar / tpb);
    return beatNum === 0 ? 0 : 0.25;        // downbeat=0, other beats=0.25
  }
  // Off-beat: linear ramp 0.25→1.0 within the beat
  return 0.25 + 0.75 * (posInBeat / tpb);
}

/**
 * How extreme is this pitch relative to the observed range? (0 = centre, 1 = edge)
 */
function pitchExtremenessScore(pitch: number, pitchMin: number, pitchMax: number): number {
  if (pitchMax === pitchMin) return 0;
  const centre = (pitchMin + pitchMax) / 2;
  return Math.min(1, Math.abs(pitch - centre) / ((pitchMax - pitchMin) / 2));
}

/**
 * Combined removability score. Higher score → remove first.
 */
function removalScore(
  onset: number,
  velocity: number,
  pitch: number,
  pitchMin: number,
  pitchMax: number,
  tpb: number,
  tpBar: number,
  onsetSurplus: boolean,   // true when this onset already has 3+ simultaneous notes
): number {
  const mw  = noteMetricWeakness(onset, tpb, tpBar);
  const vi  = 1 - velocity / 127;
  const pe  = pitchExtremenessScore(pitch, pitchMin, pitchMax);
  const po  = onsetSurplus ? 0.3 : 0;

  return 0.40 * mw + 0.40 * vi + 0.15 * pe + 0.05 * po;
}

// ---------------------------------------------------------------------------
// Main synthesis function
// ---------------------------------------------------------------------------

function matchToDetectedChord(match: ChordMatch | null): DetectedChord | null {
  if (!match) return null;
  return {
    root:          match.root,
    rootName:      match.rootName,
    qualityKey:    match.quality.key,
    symbol:        match.symbol,
    qualityName:   match.quality.fullName,
    observedPcs:   match.observedPcs,
    templatePcs:   match.templatePcs,
    extras:        match.extras,
    missing:       match.missing,
  };
}

/**
 * Produce a lower-intensity version of `gesture`+`harmonic` by removing notes
 * and rescaling velocities.
 *
 * @param targetNoteCount  Desired number of notes in the output.
 * @param targetVelMean    Desired mean velocity; 0 = no rescaling.
 */
export function synthesizeIntensityDown(
  gesture: Gesture,
  harmonic: Harmonic,
  targetNoteCount: number,
  targetVelMean: number,
): TransformResult {
  const { ticks_per_beat: tpb, ticks_per_bar: tpBar, num_bars } = gesture;
  const n = gesture.onsets.length;

  // Build per-onset count map for polyphony excess detection
  const ONSET_TOL = 30; // ticks — same as detectChordBlocks
  const onsetBucket = (onset: number) => Math.round(onset / ONSET_TOL) * ONSET_TOL;
  const onsetCount = new Map<number, number>();
  for (const o of gesture.onsets) {
    const b = onsetBucket(o);
    onsetCount.set(b, (onsetCount.get(b) ?? 0) + 1);
  }

  // Pitch stats
  const pitches = harmonic.pitches;
  const pitchMin = pitches.length ? Math.min(...pitches) : 0;
  const pitchMax = pitches.length ? Math.max(...pitches) : 0;

  // Score every note
  type IndexedNote = { i: number; score: number };
  const scored: IndexedNote[] = [];
  for (let i = 0; i < n; i++) {
    const onset    = gesture.onsets[i]!;
    const velocity = gesture.velocities[i]!;
    const pitch    = pitches[i]!;
    const surplus  = (onsetCount.get(onsetBucket(onset)) ?? 0) >= 3;
    scored.push({
      i,
      score: removalScore(onset, velocity, pitch, pitchMin, pitchMax, tpb, tpBar, surplus),
    });
  }

  // Sort by score descending; remove highest-scored notes first
  scored.sort((a, b) => b.score - a.score);

  const keepCount = Math.min(n, Math.max(1, targetNoteCount));
  // Keep the last `keepCount` entries (lowest scores = most important)
  const keepSet = new Set(scored.slice(scored.length - keepCount).map(x => x.i));

  // Rebuild parallel arrays
  let onsets:     number[] = [];
  let durations:  number[] = [];
  let velocities: number[] = [];
  let newPitches: number[] = [];

  for (let i = 0; i < n; i++) {
    if (keepSet.has(i)) {
      onsets.push(gesture.onsets[i]!);
      durations.push(gesture.durations[i]!);
      velocities.push(gesture.velocities[i]!);
      newPitches.push(pitches[i]!);
    }
  }

  // Velocity rescaling (proportional around mean)
  if (targetVelMean > 0 && velocities.length > 0) {
    const currentMean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    if (currentMean > 0) {
      const scale = targetVelMean / currentMean;
      velocities = velocities.map(v => Math.max(1, Math.min(127, Math.round(v * scale))));
    }
  }

  // Recompute gesture-level metrics
  const totalBeats = num_bars * 4;
  const density = onsets.length / totalBeats;
  const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  const velocityVariance =
    velocities.reduce((sum, v) => sum + (v - avgVelocity) ** 2, 0) / velocities.length;
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

  const newGesture: Gesture = {
    onsets,
    durations,
    velocities,
    density,
    syncopation_score: computeSyncopation(onsets, tpb, tpBar),
    avg_velocity:      avgVelocity,
    velocity_variance: velocityVariance,
    avg_duration:      avgDuration,
    num_bars,
    ticks_per_bar:   tpBar,
    ticks_per_beat:  tpb,
  };

  // Chord detection on the thinned set
  const overallMatch  = detectOverallChord(newPitches);
  const detectedChord = matchToDetectedChord(overallMatch);

  const barMatches = detectChordsPerBar(
    newPitches, onsets, tpBar, num_bars, durations,
  );
  const barChords: BarChordInfo[] = barMatches.map((bm, idx) => ({
    bar:         bm.bar,
    chord:       matchToDetectedChord(bm.chord),
    pitchClasses: bm.pitchClasses,
    segments:    harmonic.barChords?.[idx]?.segments,
  }));

  const newHarmonic: Harmonic = {
    pitches:       newPitches,
    pitchClasses:  newPitches.map(p => p % 12),
    detectedChord,
    barChords,
  };

  return { gesture: newGesture, harmonic: newHarmonic };
}
