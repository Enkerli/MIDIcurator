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
  /** Pitch classes actually observed in the input (0-11, sorted) */
  observedPcs?: number[];
  /** Pitch classes of the matched chord template (0-11, sorted) */
  templatePcs?: number[];
  /** Pitch classes in observed but not in template (extras / passing tones) */
  extras?: number[];
  /** Pitch classes in template but not observed (missing tones) */
  missing?: number[];
  /** Bass pitch class for slash chords (undefined = root position) */
  bassPc?: number;
  /** Bass note name for slash chords (e.g. "F" in "Dm/F") */
  bassName?: string;
}

/** A sub-bar chord segment (for bars with multiple chords). */
export interface ChordSegment {
  /** Start tick relative to bar start (0 = beginning of bar) */
  startTick: number;
  /** End tick relative to bar start (up to ticks_per_bar) */
  endTick: number;
  /** The chord assigned to this segment */
  chord: DetectedChord | null;
}

/** Per-bar chord detection result. */
export interface BarChordInfo {
  /** Bar index (0-based) */
  bar: number;
  /** Detected chord, or null if not enough notes */
  chord: DetectedChord | null;
  /** Unique pitch classes in this bar */
  pitchClasses: number[];
  /** Optional sub-bar chord segments (manual override only).
   *  When present with length > 1, segments take priority over `chord` for rendering. */
  segments?: ChordSegment[];
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

/** Per-segment chord result (computed from notes within the segment). */
export interface SegmentChordInfo {
  /** Segment index (0-based). */
  index: number;
  /** Absolute start tick of this segment. */
  startTick: number;
  /** Absolute end tick of this segment. */
  endTick: number;
  /** Detected chord for this segment, or null. */
  chord: DetectedChord | null;
  /** Pitch classes present in this segment. */
  pitchClasses: number[];
}

/** Segmentation state for a clip. */
export interface Segmentation {
  /** Absolute tick positions of segment boundaries (sorted, ascending). */
  boundaries: number[];
  /** Per-segment chord detection results (derived from boundaries + notes). */
  segmentChords?: SegmentChordInfo[];
}

/** A single chord in the leadsheet layer, bar-quantized. */
export interface LeadsheetChord {
  /** Parsed chord, or null for NC */
  chord: DetectedChord | null;
  /** Original input text (preserved for round-trip fidelity) */
  inputText: string;
  /** Position within bar: 0 = first chord, 1 = second, etc. */
  position: number;
  /** Total chords in this bar (determines time fraction: 1/total) */
  totalInBar: number;
  /** Beat position within bar (0.0 = start, 4.0 = end for 4/4 time) */
  beatPosition?: number;
  /** Duration in beats (if undefined, uses equal division: beatsPerBar / totalInBar) */
  duration?: number;
}

/** Per-bar leadsheet annotation. */
export interface LeadsheetBar {
  /** Bar index (0-based, matching BarChordInfo.bar) */
  bar: number;
  /** Chords in this bar (1–4 entries, equal time division) */
  chords: LeadsheetChord[];
  /** True if this bar is a repeat of the previous bar (from '%' or '-') */
  isRepeat: boolean;
}

/** Full leadsheet annotation for a clip. */
export interface Leadsheet {
  /** Raw input text (for editing round-trip) */
  inputText: string;
  /** Parsed per-bar data */
  bars: LeadsheetBar[];
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
  /** Parent clip ID (session-local, for variant tracking in the current session). */
  source?: string;
  /** Parent clip filename (persisted in MIDI metadata, survives export/reimport). */
  sourceFilename?: string;
  segmentation?: Segmentation;
  /** Leadsheet (underlying chord) annotation, manually entered. */
  leadsheet?: Leadsheet;
}

/** A tag record in the 'tags' object store. */
export interface TagRecord {
  clipId: string;
  tag: string;
  added_at: number;
}
