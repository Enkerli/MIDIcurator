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

// ─── Range selection ───────────────────────────────────────────────────

/** A selected tick range on the piano roll (UI state, not clip data). */
export interface TickRange {
  /** Start tick (inclusive), snapped to beat */
  startTick: number;
  /** End tick (exclusive), snapped to beat */
  endTick: number;
}

/**
 * Convert a pixel x-coordinate to a tick value (inverse of tick-to-x).
 * Clamps to >= 0.
 */
export function xToTick(x: number, layout: PianoRollLayout): number {
  return Math.max(0, (x - layout.labelWidth) / layout.pxPerTick);
}

/**
 * Snap a tick value to the nearest beat boundary.
 */
export function snapToNearestBeat(tick: number, ticksPerBeat: number): number {
  return Math.round(tick / ticksPerBeat) * ticksPerBeat;
}

/**
 * Collect all unique note start/end boundaries, sorted.
 * Used for snap-to-note functionality.
 */
export function collectNoteBoundaries(onsets: number[], durations: number[]): number[] {
  const boundaries = new Set<number>();
  for (let i = 0; i < onsets.length; i++) {
    boundaries.add(onsets[i]!);
    boundaries.add(onsets[i]! + durations[i]!);
  }
  return [...boundaries].sort((a, b) => a - b);
}

/**
 * Snap to nearest note boundary if close, otherwise to 1/4 beat grid.
 * Provides precise selection for short chords while maintaining grid feel.
 */
export function snapToNearestBoundary(
  rawTick: number,
  boundaries: number[],
  ticksPerBeat: number,
): number {
  const NOTE_SNAP_THRESHOLD = ticksPerBeat / 8;  // 60 ticks at 480 tpb
  const GRID_UNIT = ticksPerBeat / 4;            // 120 ticks (1/4 beat)

  // Find closest boundary
  let closest = boundaries[0] ?? 0;
  let minDist = Math.abs(rawTick - closest);
  for (const b of boundaries) {
    const dist = Math.abs(rawTick - b);
    if (dist < minDist) {
      minDist = dist;
      closest = b;
    }
  }

  // Snap to boundary if within threshold
  if (minDist <= NOTE_SNAP_THRESHOLD) {
    return closest;
  }

  // Fall back to 1/4 beat grid
  return Math.round(rawTick / GRID_UNIT) * GRID_UNIT;
}

/**
 * Get the indices of notes that overlap a tick range.
 * A note overlaps if:
 *   1. Its onset is within [startTick, endTick), OR
 *   2. It started before startTick but is still sounding (onset + duration > startTick)
 */
export function getNotesInTickRange(
  onsets: number[],
  durations: number[],
  startTick: number,
  endTick: number,
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const onset = onsets[i]!;
    const dur = durations[i]!;
    const noteEnd = onset + dur;
    if ((onset >= startTick && onset < endTick) ||
        (onset < startTick && noteEnd > startTick)) {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Check if a tick range is large enough to be a meaningful selection.
 * Returns true if the range spans at least a quarter beat.
 */
export function isMinimumDrag(
  startTick: number,
  endTick: number,
  ticksPerBeat: number,
): boolean {
  return Math.abs(endTick - startTick) >= ticksPerBeat / 4;
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

// ─── Scissors tool: boundary snapping ──────────────────────────────────

/**
 * Snap a raw tick position for the scissors tool.
 * Priority order:
 *   1. Note onset within tolerance (half a beat)
 *   2. Note end within tolerance
 *   3. Beat grid (if no notes nearby)
 * Shift key disables snapping entirely (caller passes `disableSnap`).
 * Never snaps more than 1 beat away from click position.
 */
export function snapForScissors(
  rawTick: number,
  onsets: number[],
  durations: number[],
  ticksPerBeat: number,
  disableSnap = false,
): number {
  if (disableSnap) return Math.max(0, Math.round(rawTick));

  const MAX_SNAP = ticksPerBeat; // never snap more than 1 beat
  const ONSET_TOLERANCE = ticksPerBeat / 2;
  const END_TOLERANCE = ticksPerBeat / 2;

  // 1. Find closest note onset
  let closestOnset = Infinity;
  let closestOnsetDist = Infinity;
  for (const onset of onsets) {
    const dist = Math.abs(rawTick - onset);
    if (dist < closestOnsetDist && dist <= ONSET_TOLERANCE && dist <= MAX_SNAP) {
      closestOnsetDist = dist;
      closestOnset = onset;
    }
  }
  if (closestOnset !== Infinity) return closestOnset;

  // 2. Find closest note end
  let closestEnd = Infinity;
  let closestEndDist = Infinity;
  for (let i = 0; i < onsets.length; i++) {
    const noteEnd = onsets[i]! + durations[i]!;
    const dist = Math.abs(rawTick - noteEnd);
    if (dist < closestEndDist && dist <= END_TOLERANCE && dist <= MAX_SNAP) {
      closestEndDist = dist;
      closestEnd = noteEnd;
    }
  }
  if (closestEnd !== Infinity) return closestEnd;

  // 3. Fall back to beat grid
  return Math.max(0, Math.round(rawTick / ticksPerBeat) * ticksPerBeat);
}

// ─── Block chord detection ─────────────────────────────────────────────

/** A group of notes that start and end together (block chord). */
export interface ChordBlock {
  startTick: number;
  endTick: number;
  noteIndices: number[];
}

/** Tolerance for "simultaneous" note starts/ends (in ticks). */
const BLOCK_TOLERANCE = 30;

/**
 * Detect chord blocks within selected notes.
 * Groups notes that start and end together into blocks.
 * Block chords = notes held together, not changing.
 */
export function detectChordBlocks(
  indices: number[],
  onsets: number[],
  durations: number[],
): ChordBlock[] {
  if (indices.length === 0) return [];

  // Group by quantized onset
  const groups = new Map<number, number[]>();
  for (const i of indices) {
    const onset = onsets[i]!;
    const key = Math.round(onset / BLOCK_TOLERANCE) * BLOCK_TOLERANCE;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  // Convert groups to blocks, verify notes end together
  const blocks: ChordBlock[] = [];
  for (const [, noteIndices] of groups) {
    const starts = noteIndices.map(i => onsets[i]!);
    const ends = noteIndices.map(i => onsets[i]! + durations[i]!);

    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    const endSpread = Math.max(...ends) - Math.min(...ends);

    // Only treat as block if notes end together (within tolerance)
    if (endSpread <= BLOCK_TOLERANCE) {
      blocks.push({ startTick: minStart, endTick: maxEnd, noteIndices });
    } else {
      // Notes don't end together - treat each note as its own "block"
      for (const i of noteIndices) {
        blocks.push({
          startTick: onsets[i]!,
          endTick: onsets[i]! + durations[i]!,
          noteIndices: [i],
        });
      }
    }
  }

  return blocks.sort((a, b) => a.startTick - b.startTick);
}
