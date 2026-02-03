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

/** Pitch layer extracted from a set of notes. */
export interface Harmonic {
  pitches: number[];
  pitchClasses: number[];
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
