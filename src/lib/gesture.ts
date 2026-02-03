import type { Note, Gesture, Harmonic } from '../types/clip';

export function computeSyncopation(
  onsets: number[],
  ticksPerBeat: number,
  ticksPerBar: number,
): number {
  let score = 0;

  for (const onset of onsets) {
    const posInBar = onset % ticksPerBar;
    const posInBeat = posInBar % ticksPerBeat;

    if (posInBeat === 0) {
      const beatNum = Math.floor(posInBar / ticksPerBeat);
      score += beatNum === 0 ? 0 : 0.3;
    } else {
      score += posInBeat / ticksPerBeat;
    }
  }

  return onsets.length > 0 ? score / onsets.length : 0;
}

export function extractGesture(notes: Note[], ticksPerBeat: number): Gesture {
  const onsets = notes.map(n => n.ticks);
  const durations = notes.map(n => n.durationTicks);
  const velocities = notes.map(n => n.velocity);

  const ticksPerBar = ticksPerBeat * 4; // Assume 4/4
  const lastTick = Math.max(...notes.map(n => n.ticks + n.durationTicks));
  const numBars = Math.ceil(lastTick / ticksPerBar);

  const totalBeats = numBars * 4;
  const density = notes.length / totalBeats;

  const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  const velocityVariance =
    velocities.reduce((sum, v) => sum + (v - avgVelocity) ** 2, 0) / velocities.length;
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

  const syncopationScore = computeSyncopation(onsets, ticksPerBeat, ticksPerBar);

  return {
    onsets,
    durations,
    velocities,
    density,
    syncopation_score: syncopationScore,
    avg_velocity: avgVelocity,
    velocity_variance: velocityVariance,
    avg_duration: avgDuration,
    num_bars: numBars,
    ticks_per_bar: ticksPerBar,
    ticks_per_beat: ticksPerBeat,
  };
}

export function extractHarmonic(notes: Note[]): Harmonic {
  const pitches = notes.map(n => n.midi);
  const pitchClasses = pitches.map(p => p % 12);

  return { pitches, pitchClasses };
}
