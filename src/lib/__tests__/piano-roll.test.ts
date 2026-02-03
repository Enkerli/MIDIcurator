import { describe, it, expect } from 'vitest';
import {
  noteName,
  isBlackKey,
  computeLayout,
  computeNoteRects,
  computeGridLines,
  timeToX,
  velocityColor,
} from '../piano-roll';
import type { Gesture, Harmonic } from '../../types/clip';

function makeFixture(): { gesture: Gesture; harmonic: Harmonic } {
  return {
    gesture: {
      onsets: [0, 480, 960, 1440],
      durations: [240, 240, 240, 240],
      velocities: [80, 100, 60, 120],
      density: 1,
      syncopation_score: 0,
      avg_velocity: 90,
      velocity_variance: 0,
      avg_duration: 240,
      num_bars: 1,
      ticks_per_bar: 1920,
      ticks_per_beat: 480,
    },
    harmonic: {
      pitches: [60, 64, 67, 72],
      pitchClasses: [0, 4, 7, 0],
    },
  };
}

describe('noteName', () => {
  it('maps MIDI 60 to C4', () => {
    expect(noteName(60)).toBe('C4');
  });

  it('maps MIDI 69 to A4', () => {
    expect(noteName(69)).toBe('A4');
  });

  it('maps MIDI 21 to A0', () => {
    expect(noteName(21)).toBe('A0');
  });
});

describe('isBlackKey', () => {
  it('C is not a black key', () => {
    expect(isBlackKey(60)).toBe(false);
  });

  it('C# is a black key', () => {
    expect(isBlackKey(61)).toBe(true);
  });

  it('E is not a black key', () => {
    expect(isBlackKey(64)).toBe(false);
  });

  it('F# is a black key', () => {
    expect(isBlackKey(66)).toBe(true);
  });
});

describe('computeLayout', () => {
  it('computes pitch range with padding', () => {
    const { gesture, harmonic } = makeFixture();
    const layout = computeLayout(gesture, harmonic, 800, 240);
    // pitches are 60,64,67,72 → min should be 58, max should be 74
    expect(layout.minPitch).toBe(58);
    expect(layout.maxPitch).toBe(74);
  });

  it('has positive pxPerTick and pxPerSemitone', () => {
    const { gesture, harmonic } = makeFixture();
    const layout = computeLayout(gesture, harmonic, 800, 240);
    expect(layout.pxPerTick).toBeGreaterThan(0);
    expect(layout.pxPerSemitone).toBeGreaterThan(0);
  });
});

describe('computeNoteRects', () => {
  it('produces one rect per note', () => {
    const { gesture, harmonic } = makeFixture();
    const layout = computeLayout(gesture, harmonic, 800, 240);
    const rects = computeNoteRects(gesture, harmonic, layout);
    expect(rects).toHaveLength(4);
  });

  it('rects have positive dimensions', () => {
    const { gesture, harmonic } = makeFixture();
    const layout = computeLayout(gesture, harmonic, 800, 240);
    const rects = computeNoteRects(gesture, harmonic, layout);
    for (const rect of rects) {
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
  });

  it('higher pitches have lower y values', () => {
    const { gesture, harmonic } = makeFixture();
    const layout = computeLayout(gesture, harmonic, 800, 240);
    const rects = computeNoteRects(gesture, harmonic, layout);
    // pitch 60 (C4) should be below pitch 72 (C5)
    const c4 = rects.find(r => r.pitch === 60)!;
    const c5 = rects.find(r => r.pitch === 72)!;
    expect(c5.y).toBeLessThan(c4.y);
  });
});

describe('computeGridLines', () => {
  it('marks bar lines', () => {
    const { gesture } = makeFixture();
    const layout = computeLayout(gesture, makeFixture().harmonic, 800, 240);
    const lines = computeGridLines(gesture, layout);
    const barLines = lines.filter(l => l.isBar);
    expect(barLines.length).toBeGreaterThanOrEqual(1);
  });

  it('first line is a bar line', () => {
    const { gesture } = makeFixture();
    const layout = computeLayout(gesture, makeFixture().harmonic, 800, 240);
    const lines = computeGridLines(gesture, layout);
    expect(lines[0]!.isBar).toBe(true);
  });
});

describe('timeToX', () => {
  it('time 0 maps to labelWidth', () => {
    const { gesture, harmonic } = makeFixture();
    const layout = computeLayout(gesture, harmonic, 800, 240);
    expect(timeToX(0, 120, 480, layout)).toBe(layout.labelWidth);
  });

  it('positive time maps beyond labelWidth', () => {
    const { gesture, harmonic } = makeFixture();
    const layout = computeLayout(gesture, harmonic, 800, 240);
    expect(timeToX(1, 120, 480, layout)).toBeGreaterThan(layout.labelWidth);
  });
});

describe('velocityColor', () => {
  it('returns valid rgb string', () => {
    const color = velocityColor(80);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('higher velocity produces brighter color', () => {
    const low = velocityColor(20);
    const high = velocityColor(120);
    // Extract green channel (most visible brightness component)
    const gLow = parseInt(low.match(/rgb\(\d+, (\d+),/)![1]!);
    const gHigh = parseInt(high.match(/rgb\(\d+, (\d+),/)![1]!);
    expect(gHigh).toBeGreaterThan(gLow);
  });
});
