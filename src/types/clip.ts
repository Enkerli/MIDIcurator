/** A resolved note with absolute timing (output of extractNotes). */
export interface Note {
  midi: number;
  ticks: number;
  durationTicks: number;
  velocity: number;
}

/** Rhythmic/timing layer extracted from a set of notes. */
export interface Gesture {
  onsets: number[];
  durations: number[];
  velocities: number[];
  density: number;
  syncopation_score: number;
  avg_velocity: number;
  velocity_variance: number;
  avg_duration: number;
  num_bars: number;
  ticks_per_bar: number;
  ticks_per_beat: number;
}

/** Detected chord information for a single bar or the whole clip. */
export interface DetectedChord {
  /** Root pitch class (0 = C, 1 = C#, ..., 11 = B) */
  root: number;
  /** Root note name (e.g. "C", "F♯") */
  rootName: string;
  /** Chord quality key (e.g. "maj7", "min", "7b9") */
  qualityKey: string;
  /** Full chord symbol (e.g. "C∆", "F♯-7") */
  symbol: string;
  /** Human-readable quality name (e.g. "major seventh") */
  qualityName: string;
}

/** Per-bar chord detection result. */
export interface BarChordInfo {
  /** Bar index (0-based) */
  bar: number;
  /** Detected chord, or null if not enough notes */
  chord: DetectedChord | null;
  /** Unique pitch classes in this bar */
  pitchClasses: number[];
}

/** Pitch layer extracted from a set of notes. */
export interface Harmonic {
  pitches: number[];
  pitchClasses: number[];
  /** Overall detected chord for the clip (may be null) */
  detectedChord?: DetectedChord | null;
  /** Per-bar chord detection (populated for multi-bar clips) */
  barChords?: BarChordInfo[];
}

/** A clip stored in IndexedDB. */
export interface Clip {
  id: string;
  filename: string;
  imported_at: number;
  bpm: number;
  gesture: Gesture;
  harmonic: Harmonic;
  rating: number | null;
  notes: string;
  source?: string;
}

/** A tag record in the 'tags' object store. */
export interface TagRecord {
  clipId: string;
  tag: string;
  added_at: number;
}
