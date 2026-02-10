import type { MidiEvent, ParsedMidi } from '../types/midi';
import type { Note } from '../types/clip';

export function parseMIDI(arrayBuffer: ArrayBuffer): ParsedMidi {
  const view = new DataView(arrayBuffer);
  let offset = 0;

  // Read header chunk
  const headerType = String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
  offset += 4;

  if (headerType !== 'MThd') {
    throw new Error('Not a valid MIDI file');
  }

  offset += 4; // header length (always 6)

  offset += 2; // format (unused but consumed)

  const trackCount = view.getUint16(offset);
  offset += 2;

  const division = view.getUint16(offset);
  offset += 2;

  let ticksPerBeat: number;
  if (division & 0x8000) {
    // SMPTE format
    console.warn('SMPTE format MIDI not fully supported');
    ticksPerBeat = 480; // fallback
  } else {
    ticksPerBeat = division;
  }

  // Read tracks
  const tracks: MidiEvent[][] = [];
  for (let i = 0; i < trackCount; i++) {
    const trackType = String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
    offset += 4;

    if (trackType !== 'MTrk') {
      throw new Error('Invalid track header');
    }

    const trackLength = view.getUint32(offset);
    offset += 4;

    const trackData = new Uint8Array(arrayBuffer, offset, trackLength);
    tracks.push(parseTrack(trackData));

    offset += trackLength;
  }

  return { ticksPerBeat, tracks };
}

export function parseTrack(data: Uint8Array): MidiEvent[] {
  const events: MidiEvent[] = [];
  let offset = 0;
  let runningStatus = 0;

  while (offset < data.length) {
    // Read variable-length delta time
    let delta = 0;
    let byte: number;
    do {
      byte = data[offset++]!;
      delta = (delta << 7) | (byte & 0x7F);
    } while (byte & 0x80);

    // Read event
    let status = data[offset]!;

    if (status < 0x80) {
      // Running status
      status = runningStatus;
    } else {
      offset++;
      runningStatus = status;
    }

    const channel = status & 0x0F;

    if (status === 0xFF) {
      // Meta event — check full status byte before masking
      const metaType = data[offset++]!;
      let length = 0;
      do {
        byte = data[offset++]!;
        length = (length << 7) | (byte & 0x7F);
      } while (byte & 0x80);

      const metaData = data.slice(offset, offset + length);
      offset += length;

      if (metaType === 0x51) {
        // Set Tempo
        const microsecondsPerBeat = (metaData[0]! << 16) | (metaData[1]! << 8) | metaData[2]!;
        const bpm = Math.round(60000000 / microsecondsPerBeat);
        events.push({ delta, type: 'tempo', bpm });
      } else if (metaType === 0x58 && length >= 2) {
        // Time Signature: nn/2^dd
        const numerator = metaData[0]!;
        const denominator = Math.pow(2, metaData[1]!);
        events.push({ delta, type: 'timeSig', numerator, denominator });
      } else if (metaType === 0x06) {
        // Marker
        const text = new TextDecoder().decode(metaData);
        events.push({ delta, type: 'marker', text });
      } else if (metaType === 0x01) {
        // Text event
        const text = new TextDecoder().decode(metaData);
        events.push({ delta, type: 'text', text });
      } else if (metaType === 0x2F) {
        // End of Track
        break;
      }
      // Other meta events silently consumed (key sig, etc.)
    } else if (status === 0xF0 || status === 0xF7) {
      // SysEx events — variable-length data
      let length = 0;
      do {
        byte = data[offset++]!;
        length = (length << 7) | (byte & 0x7F);
      } while (byte & 0x80);
      offset += length;
    } else if (status >= 0xF0) {
      // Other system common/realtime messages
      if (status === 0xF2) {
        offset += 2; // Song Position Pointer
      } else if (status === 0xF1 || status === 0xF3) {
        offset += 1; // MTC Quarter Frame, Song Select
      }
      // 0xF4-0xF6, 0xF8-0xFE: 0 data bytes
    } else {
      // Channel voice messages
      const type = status & 0xF0;

      if (type === 0x90) {
        // Note On
        const note = data[offset++]!;
        const velocity = data[offset++]!;
        events.push({ delta, type: 'noteOn', note, velocity, channel });
      } else if (type === 0x80) {
        // Note Off
        const note = data[offset++]!;
        const velocity = data[offset++]!;
        events.push({ delta, type: 'noteOff', note, velocity, channel });
      } else if (type === 0xC0 || type === 0xD0) {
        // Program Change, Channel Pressure: 1 data byte
        offset += 1;
      } else if (type === 0xB0 || type === 0xE0 || type === 0xA0) {
        // Control Change, Pitch Bend, Aftertouch: 2 data bytes
        offset += 2;
      }
    }
  }

  return events;
}

export function extractNotes(midiData: ParsedMidi): Note[] {
  const notes: Note[] = [];
  const activeNotes = new Map<string, { tick: number; velocity: number; note: number }>();

  for (const track of midiData.tracks) {
    let currentTick = 0;

    for (const event of track) {
      currentTick += event.delta;

      if (event.type === 'noteOn' && event.velocity! > 0) {
        const key = `${event.note}-${event.channel}`;
        activeNotes.set(key, { tick: currentTick, velocity: event.velocity!, note: event.note! });
      } else if (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) {
        const key = `${event.note}-${event.channel}`;
        const noteOn = activeNotes.get(key);
        if (noteOn) {
          notes.push({
            midi: noteOn.note,
            ticks: noteOn.tick,
            durationTicks: currentTick - noteOn.tick,
            velocity: noteOn.velocity,
          });
          activeNotes.delete(key);
        }
      }
    }
  }

  return notes.sort((a, b) => a.ticks - b.ticks);
}

export function extractBPM(midiData: ParsedMidi): number {
  for (const track of midiData.tracks) {
    for (const event of track) {
      if (event.type === 'tempo') {
        return event.bpm!;
      }
    }
  }
  return 120;
}

/**
 * Extract the first time signature from MIDI data.
 * Returns [numerator, denominator] (e.g. [3, 4] for 3/4 time).
 * Defaults to [4, 4] if no time signature event is found.
 */
export function extractTimeSignature(midiData: ParsedMidi): [number, number] {
  for (const track of midiData.tracks) {
    for (const event of track) {
      if (event.type === 'timeSig') {
        return [event.numerator!, event.denominator!];
      }
    }
  }
  return [4, 4];
}

/** Parsed segment from MCURATOR metadata. */
export interface McuratorSegment {
  tick: number;
  index: number;
  chord: string | null;
  json?: Record<string, unknown>;
}

/** Result of extracting MCURATOR metadata from a MIDI file. */
export interface McuratorMetadata {
  boundaries: number[];
  segments: McuratorSegment[];
  fileInfo?: Record<string, unknown>;
  /** Raw leadsheet input text (if embedded in MIDI metadata). */
  leadsheetText?: string;
}

const MARKER_PREFIX = 'MCURATOR v1 SEG';
const TEXT_PREFIX = 'MCURATOR:v1 ';

/**
 * Parse an MCURATOR marker string.
 * Format: "MCURATOR v1 SEG <n> CHORD <symbol> [KEY <key>] [FLAGS <flags>]"
 */
function parseMarker(text: string): { index: number; chord: string | null } | null {
  if (!text.startsWith(MARKER_PREFIX)) return null;
  const rest = text.slice(MARKER_PREFIX.length).trim();
  const tokens = rest.split(/\s+/);
  const index = parseInt(tokens[0] ?? '', 10);
  if (isNaN(index)) return null;

  let chord: string | null = null;
  const chordIdx = tokens.indexOf('CHORD');
  if (chordIdx >= 0 && chordIdx + 1 < tokens.length) {
    chord = tokens[chordIdx + 1]!;
  }
  return { index, chord };
}

/**
 * Parse an MCURATOR text event JSON payload.
 * Format: "MCURATOR:v1 <JSON>"
 */
function parseTextJson(text: string): Record<string, unknown> | null {
  if (!text.startsWith(TEXT_PREFIX)) return null;
  const jsonStr = text.slice(TEXT_PREFIX.length);
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract MCURATOR segmentation metadata from a parsed MIDI file.
 * Scans all tracks for MCURATOR marker and text meta events.
 */
export function extractMcuratorSegments(midiData: ParsedMidi): McuratorMetadata | null {
  // Collect all marker/text events with absolute ticks across all tracks
  const markerEvents: Array<{ tick: number; text: string }> = [];
  const textEvents: Array<{ tick: number; text: string }> = [];

  for (const track of midiData.tracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.delta;
      if (event.type === 'marker' && event.text) {
        markerEvents.push({ tick, text: event.text });
      } else if (event.type === 'text' && event.text) {
        textEvents.push({ tick, text: event.text });
      }
    }
  }

  // Parse file-level info and leadsheet from text events at tick 0
  let fileInfo: Record<string, unknown> | undefined;
  let leadsheetText: string | undefined;
  for (const te of textEvents) {
    const json = parseTextJson(te.text);
    if (!json) continue;
    if (json.type === 'file') {
      fileInfo = json;
    } else if (json.type === 'leadsheet' && typeof json.text === 'string') {
      leadsheetText = json.text;
    }
  }

  // Parse segment markers
  const segmentMap = new Map<number, McuratorSegment>();

  for (const me of markerEvents) {
    const parsed = parseMarker(me.text);
    if (!parsed) continue;
    segmentMap.set(me.tick, {
      tick: me.tick,
      index: parsed.index,
      chord: parsed.chord,
    });
  }

  // Merge text JSON into segments (JSON overrides marker per spec §8.3)
  for (const te of textEvents) {
    const json = parseTextJson(te.text);
    if (!json || json.type === 'file') continue;
    if (typeof json.seg !== 'number') continue;

    const existing = segmentMap.get(te.tick);
    if (existing) {
      existing.json = json;
      // JSON chord overrides marker chord
      if (typeof json.chord === 'string') {
        existing.chord = json.chord;
      }
    } else {
      // Text-only segment (no marker)
      segmentMap.set(te.tick, {
        tick: te.tick,
        index: json.seg as number,
        chord: typeof json.chord === 'string' ? json.chord : null,
        json,
      });
    }
  }

  if (segmentMap.size === 0 && !fileInfo && !leadsheetText) return null;

  const segments = [...segmentMap.values()].sort((a, b) => a.tick - b.tick);
  const boundaries = segments.map(s => s.tick);

  return { boundaries, segments, fileInfo, leadsheetText };
}
