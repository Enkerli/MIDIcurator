import type { Gesture, Harmonic } from '../types/clip';

/**
 * Layout constants and coordinate math for piano roll rendering.
 * Pure functions — no Canvas/DOM dependency.
 */

export interface PianoRollLayout {
  /** Total width in pixels */
  width: number;
  /** Total height in pixels */
  height: number;
  /** Pixels per tick */
  pxPerTick: number;
  /** Pixels per MIDI semitone */
  pxPerSemitone: number;
  /** Lowest MIDI note displayed */
  minPitch: number;
  /** Highest MIDI note displayed */
  maxPitch: number;
  /** Left padding for pitch labels */
  labelWidth: number;
  /** Top padding */
  topPad: number;
}

export interface NoteRect {
  x: number;
  y: number;
  w: number;
  h: number;
  velocity: number;
  pitch: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

export function isBlackKey(midi: number): boolean {
  const pc = midi % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

/**
 * Compute layout metrics from gesture/harmonic data and available canvas size.
 * Adds 2 semitones of padding above and below the pitch range.
 */
export function computeLayout(
  gesture: Gesture,
  harmonic: Harmonic,
  canvasWidth: number,
  canvasHeight: number,
): PianoRollLayout {
  const labelWidth = 40;
  const topPad = 4;
  const drawWidth = canvasWidth - labelWidth;
  const drawHeight = canvasHeight - topPad * 2;

  const minPitch = Math.max(0, Math.min(...harmonic.pitches) - 2);
  const maxPitch = Math.min(127, Math.max(...harmonic.pitches) + 2);
  const pitchRange = maxPitch - minPitch + 1;

  const lastTick = Math.max(
    ...gesture.onsets.map((onset, i) => onset + gesture.durations[i]!),
  );
  // Add a little padding at the end (1 beat worth)
  const totalTicks = lastTick + gesture.ticks_per_beat;

  const pxPerTick = drawWidth / totalTicks;
  const pxPerSemitone = drawHeight / pitchRange;

  return {
    width: canvasWidth,
    height: canvasHeight,
    pxPerTick,
    pxPerSemitone,
    minPitch,
    maxPitch,
    labelWidth,
    topPad,
  };
}

/**
 * Convert gesture+harmonic note data into pixel-space rectangles.
 */
export function computeNoteRects(
  gesture: Gesture,
  harmonic: Harmonic,
  layout: PianoRollLayout,
): NoteRect[] {
  const rects: NoteRect[] = [];

  for (let i = 0; i < gesture.onsets.length; i++) {
    const onset = gesture.onsets[i]!;
    const duration = gesture.durations[i]!;
    const velocity = gesture.velocities[i]!;
    const pitch = harmonic.pitches[i]!;

    const x = layout.labelWidth + onset * layout.pxPerTick;
    // Piano roll: higher pitch = higher on screen (y=0 is top)
    const y = layout.topPad + (layout.maxPitch - pitch) * layout.pxPerSemitone;
    const w = Math.max(1, duration * layout.pxPerTick);
    const h = Math.max(1, layout.pxPerSemitone - 1); // 1px gap between rows

    rects.push({ x, y, w, h, velocity, pitch });
  }

  return rects;
}

/**
 * Compute the x-position of vertical beat/bar grid lines.
 */
export function computeGridLines(
  gesture: Gesture,
  layout: PianoRollLayout,
): Array<{ x: number; isBar: boolean; label: string }> {
  const lines: Array<{ x: number; isBar: boolean; label: string }> = [];

  const lastTick = Math.max(
    ...gesture.onsets.map((onset, i) => onset + gesture.durations[i]!),
  );
  const totalTicks = lastTick + gesture.ticks_per_beat;

  for (let tick = 0; tick <= totalTicks; tick += gesture.ticks_per_beat) {
    const x = layout.labelWidth + tick * layout.pxPerTick;
    const isBar = tick % gesture.ticks_per_bar === 0;
    const barNum = Math.floor(tick / gesture.ticks_per_bar) + 1;
    const beatInBar = Math.floor((tick % gesture.ticks_per_bar) / gesture.ticks_per_beat) + 1;
    const label = isBar ? `${barNum}` : `${barNum}.${beatInBar}`;
    lines.push({ x, isBar, label });
  }

  return lines;
}

/**
 * Convert a playback time (in seconds) to an x-position for the playhead.
 */
export function timeToX(
  seconds: number,
  bpm: number,
  ticksPerBeat: number,
  layout: PianoRollLayout,
): number {
  const beatsPerSecond = bpm / 60;
  const ticksPerSecond = beatsPerSecond * ticksPerBeat;
  const tick = seconds * ticksPerSecond;
  return layout.labelWidth + tick * layout.pxPerTick;
}

/**
 * Velocity to color: low velocity = dim blue, high velocity = bright cyan/white.
 */
export function velocityColor(velocity: number): string {
  const t = velocity / 127;
  const r = Math.round(40 + t * 60);
  const g = Math.round(80 + t * 140);
  const b = Math.round(140 + t * 115);
  return `rgb(${r}, ${g}, ${b})`;
}
