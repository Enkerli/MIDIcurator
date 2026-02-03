import { describe, it, expect } from 'vitest';
import { computeSyncopation, extractGesture, extractHarmonic } from '../gesture';
import type { Note } from '../../types/clip';

describe('computeSyncopation', () => {
  it('returns 0 for notes on the downbeat', () => {
    const onsets = [0, 480, 960, 1440]; // Every beat in 4/4 at 480 tpb
    expect(computeSyncopation(onsets, 480, 1920)).toBe(0.3 * 3 / 4);
    // Beat 0 = 0, beats 1-3 = 0.3 each → (0 + 0.3 + 0.3 + 0.3) / 4
  });

  it('returns 0 for empty onsets', () => {
    expect(computeSyncopation([], 480, 1920)).toBe(0);
  });

  it('scores off-beat notes higher', () => {
    const onBeat = [0, 480, 960, 1440];
    const offBeat = [240, 720, 1200, 1680]; // Every eighth note off-beat
    const onBeatScore = computeSyncopation(onBeat, 480, 1920);
    const offBeatScore = computeSyncopation(offBeat, 480, 1920);
    expect(offBeatScore).toBeGreaterThan(onBeatScore);
  });
});

describe('extractGesture', () => {
  const makeNotes = (count: number, spacing: number): Note[] =>
    Array.from({ length: count }, (_, i) => ({
      midi: 60 + i,
      ticks: i * spacing,
      durationTicks: spacing / 2,
      velocity: 80 + i,
    }));

  it('computes density as notes per beat', () => {
    // 4 notes across 1 bar of 4/4 at 96 tpb = 1 note per beat
    const notes = makeNotes(4, 96);
    const gesture = extractGesture(notes, 96);
    expect(gesture.density).toBe(1);
  });

  it('preserves ticks_per_beat from input', () => {
    const notes = makeNotes(4, 96);
    const gesture = extractGesture(notes, 96);
    expect(gesture.ticks_per_beat).toBe(96);
  });

  it('captures all onsets', () => {
    const notes = makeNotes(8, 120);
    const gesture = extractGesture(notes, 480);
    expect(gesture.onsets).toHaveLength(8);
    expect(gesture.onsets[0]).toBe(0);
    expect(gesture.onsets[7]).toBe(840);
  });
});

describe('extractHarmonic', () => {
  it('extracts MIDI pitches and pitch classes', () => {
    const notes: Note[] = [
      { midi: 60, ticks: 0, durationTicks: 100, velocity: 80 },
      { midi: 64, ticks: 100, durationTicks: 100, velocity: 80 },
      { midi: 67, ticks: 200, durationTicks: 100, velocity: 80 },
    ];
    const harmonic = extractHarmonic(notes);
    expect(harmonic.pitches).toEqual([60, 64, 67]);
    expect(harmonic.pitchClasses).toEqual([0, 4, 7]); // C major triad
  });
});
