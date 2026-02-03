/** A single MIDI event as parsed from a track chunk. */
export interface MidiEvent {
  delta: number;
  type: 'noteOn' | 'noteOff' | 'tempo';
  note?: number;
  velocity?: number;
  channel?: number;
  bpm?: number;
}

/** Result of parsing an entire MIDI file. */
export interface ParsedMidi {
  ticksPerBeat: number;
  tracks: MidiEvent[][];
}
