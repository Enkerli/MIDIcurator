/**
 * Apple Loops parser: extracts embedded SMF MIDI and chord metadata
 * from AIFF/AIFC and CAF container files.
 *
 * Based on reverse-engineering documented in docs/APPLE_LOOPS_REVERSE_ENGINEERING.md
 */

import { findQualityByIntervals } from './chord-dictionary';
import type { DetectedChord, Leadsheet, LeadsheetBar, LeadsheetChord } from '../types/clip';

// ─── Types ──────────────────────────────────────────────────────────

/** A chord event extracted from a Sequ payload (type 103). */
export interface AppleLoopChordEvent {
  /** Pitch-class interval bitmask (12 bits, relative to root). */
  mask: number;
  /** Decoded intervals (semitones above root, e.g. [0, 4, 7]). */
  intervals: number[];
  /** Position within bar in beats (0-based, floating point). */
  positionBeats: number;
  /** Raw be22 field (for debugging / future use). */
  rawBe22: number;
  /** Raw b8 field (encodes accidental). */
  b8: number;
  /** Raw b9 field (encodes pitch class or accidental hint). */
  b9: number;
  /** Root note name (e.g. "C", "F♯") if b8/b9 scheme allows full decode. */
  rootName?: string;
  /** Root pitch class (0-11) if b8/b9 scheme allows full decode. */
  rootPc?: number;
  /** Accidental hint (for b8=15 scheme, where b9 encodes hint not full PC). */
  accidentalHint?: 'flat' | 'natural' | 'sharp';
}

/** Result of parsing an Apple Loop file (AIFF or CAF). */
export interface AppleLoopParseResult {
  /** Embedded MIDI as ArrayBuffer, or null if not found. */
  midi: ArrayBuffer | null;
  /** Chord events extracted from Sequ chunk. */
  chordEvents: AppleLoopChordEvent[];
  /** Beats per bar (default 4, could be parsed from meta). */
  beatsPerBar: number;
  /** Format: "AIFF" or "CAF". */
  format: string;
}

// ─── Helper Functions ───────────────────────────────────────────────

/** Check if a filename looks like an Apple Loop. */
export function isAppleLoopFile(filename: string): boolean {
  return /\.(aif|aiff|caf)$/i.test(filename);
}

/**
 * Decode the 12-bit interval mask into an array of pitch-class offsets.
 * Bit 0 (LSB) → interval 0, bit 1 → interval 1, ..., bit 11 → interval 11.
 */
function decodeIntervalMask(mask: number): number[] {
  const intervals: number[] = [];
  for (let i = 0; i < 12; i++) {
    if (mask & (1 << i)) {
      intervals.push(i);
    }
  }
  return intervals;
}

interface RootInfo {
  name: string;
  pc: number;
}

interface AccidentalHintInfo {
  accidentalHint: 'flat' | 'natural' | 'sharp';
}

/**
 * Decode b8 and b9 bytes into root note information.
 *
 * Schemes discovered:
 *   1. b8 ∈ {1, 2, 3} (Apple first-party): full root encoding
 *      - b8=1 → flat, b8=2 → natural, b8=3 → sharp
 *      - b9 = pitch class
 *   2. b8=0x0f (15) (User-generated v1): accidental hint only
 *      - b9 encodes accidental hint, not full PC
 *      - Root must be inferred from MIDI notes
 *   3. b8=0xff (255) (User-generated v2): unknown encoding
 */
function decodeRootNote(
  b8: number,
  b9: number,
): RootInfo | AccidentalHintInfo | null {
  // Scheme 1: b8 ∈ {1, 2, 3} (full root encoding)
  if (b8 === 1 || b8 === 2 || b8 === 3) {
    const pc = b9 % 12;

    // Natural notes (b8 = 2)
    const naturals = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const naturalPcs = [0, 2, 4, 5, 7, 9, 11];

    if (b8 === 2) {
      const idx = naturalPcs.indexOf(pc);
      if (idx >= 0) {
        return { name: naturals[idx]!, pc };
      }
    } else if (b8 === 3) {
      // Sharp (b8 = 3)
      const sharpNames = ['C♯', 'D♯', 'F♯', 'G♯', 'A♯'];
      const sharpPcs = [1, 3, 6, 8, 10];
      const idx = sharpPcs.indexOf(pc);
      if (idx >= 0) {
        return { name: sharpNames[idx]!, pc };
      }
    } else if (b8 === 1) {
      // Flat (b8 = 1)
      const flatNames = ['D♭', 'E♭', 'G♭', 'A♭', 'B♭'];
      const flatPcs = [1, 3, 6, 8, 10];
      const idx = flatPcs.indexOf(pc);
      if (idx >= 0) {
        return { name: flatNames[idx]!, pc };
      }
    }

    // Fallback: shouldn't reach here for valid Apple first-party data
    return null;
  }

  // Scheme 2: b8=0x0f (15) - accidental hint only
  if (b8 === 0x0f || b8 === 15) {
    // b9 encodes accidental hint
    // Observed: b9=1 or b9=2 might encode flat/natural/sharp
    // This is a hint; actual root must be inferred from MIDI
    if (b9 === 0 || b9 === 2) {
      return { accidentalHint: 'natural' };
    } else if (b9 === 1) {
      return { accidentalHint: 'flat' };
    } else if (b9 === 3) {
      return { accidentalHint: 'sharp' };
    }
    return { accidentalHint: 'natural' }; // default
  }

  // Scheme 3: b8=0xff (255) or other values - unknown
  return null;
}

/**
 * Decode be22 field into beat position within bar.
 * Use low 16 bits only (high 16 bits may contain other data).
 * See docs: norm = lo16 / 65536.0
 *           pos_beats = (1.0 - norm) * beats_per_bar, wrapped
 */
function decodeBe22(be22: number, beatsPerBar: number): number {
  const lo16 = be22 & 0xFFFF;  // Use low 16 bits only
  const norm = lo16 / 65536.0;
  let pos = (1.0 - norm) * beatsPerBar;
  pos = ((pos % beatsPerBar) + beatsPerBar) % beatsPerBar;
  return pos;
}

/**
 * Scan a Sequ payload for chord events (type == 103).
 * Scans every 2-byte boundary looking for type-103 records.
 *
 * Record structure (32 bytes):
 *   +0x00: u16 LE type (103 for chord event)
 *   +0x04: u16 LE mask (12-bit pitch-class bitmask)
 *   +0x08: u8 b8 (accidental / scheme marker)
 *   +0x09: u8 b9 (pitch class or accidental hint)
 *   +0x18: u32 BE be22 (position, use low 16 bits)
 */
function extractChordEventsFromSequ(
  data: Uint8Array,
  beatsPerBar: number,
): AppleLoopChordEvent[] {
  const events: AppleLoopChordEvent[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const RECORD_SIZE = 32; // Corrected from 30

  // Scan for type==103 records at every 2-byte boundary
  for (let off = 0; off + RECORD_SIZE <= data.length; off += 2) {
    const type = view.getUint16(off, true); // Little-endian
    if (type !== 103) continue;

    const mask = view.getUint16(off + 0x04, true); // Little-endian!
    const b8 = data[off + 0x08]!;
    const b9 = data[off + 0x09]!;
    const be22 = view.getUint32(off + 0x18, false); // Big-endian, corrected offset

    const intervals = decodeIntervalMask(mask);
    const positionBeats = decodeBe22(be22, beatsPerBar);
    const rootInfo = decodeRootNote(b8, b9);

    const event: AppleLoopChordEvent = {
      mask,
      intervals,
      positionBeats,
      rawBe22: be22,
      b8,
      b9,
    };

    if (rootInfo) {
      if ('accidentalHint' in rootInfo) {
        // Scheme 2: accidental hint only
        event.accidentalHint = rootInfo.accidentalHint;
      } else {
        // Scheme 1: full root decode
        event.rootName = rootInfo.name;
        event.rootPc = rootInfo.pc;
      }
    }

    events.push(event);
  }

  // Sort by position within bar
  events.sort((a, b) => a.positionBeats - b.positionBeats);

  return events;
}

// ─── Sequ chunk helper ──────────────────────────────────────────────

interface IffChunk {
  id: string;
  data: Uint8Array;
  offset: number;
}

/**
 * Parse IFF-style chunks from a data region.
 * Used for both top-level AIFF chunks and nested subchunks inside APPL payloads.
 */
function parseIffChunks(data: Uint8Array, startOffset: number = 0): IffChunk[] {
  const chunks: IffChunk[] = [];
  let offset = startOffset;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  while (offset + 8 <= data.length) {
    const id = String.fromCharCode(data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!);
    offset += 4;

    const size = view.getUint32(offset);
    offset += 4;

    if (offset + size > data.length) break;

    chunks.push({
      id,
      data: data.subarray(offset, offset + size),
      offset,
    });

    offset += size;
    // AIFF chunks are word-aligned; skip padding byte if odd size
    if (size % 2 !== 0 && offset < data.length) {
      offset += 1;
    }
  }

  return chunks;
}

/**
 * Recursively search for Sequ chunks in nested IFF structures.
 * Some Apple Loops have Sequ inside APPL inside INST; others have top-level Sequ.
 */
function findSequChunks(chunks: IffChunk[]): Uint8Array[] {
  const sequPayloads: Uint8Array[] = [];

  for (const chunk of chunks) {
    if (chunk.id === 'Sequ') {
      sequPayloads.push(chunk.data);
    }
    // Recurse into APPL chunks which may contain nested Sequ
    if (chunk.id === 'APPL') {
      const nested = parseIffChunks(chunk.data);
      sequPayloads.push(...findSequChunks(nested));
    }
  }

  return sequPayloads;
}

// ─── MIDI extraction ────────────────────────────────────────────────

/**
 * Search for embedded MIDI data.
 * Apple Loops may store SMF MIDI in chunks like '.mid' (AIFF) or 'midi' (CAF).
 * Fallback: scan entire buffer for 'MThd' magic.
 */
function extractEmbeddedMidi(data: Uint8Array): ArrayBuffer | null {
  // Scan for 'MThd' (MIDI header magic)
  for (let i = 0; i <= data.length - 4; i++) {
    if (
      data[i] === 0x4d &&
      data[i + 1] === 0x54 &&
      data[i + 2] === 0x68 &&
      data[i + 3] === 0x64
    ) {
      // Found potential MIDI header; return from here to end (simplified extraction)
      return data.slice(i).buffer;
    }
  }
  return null;
}

// ─── AIFF container ─────────────────────────────────────────────────

/**
 * Parse an AIFF/AIFC file and extract Apple Loops data.
 *
 * AIFF structure:
 *   File header: 'FORM' (4 bytes) + size (4 bytes BE) + 'AIFF'/'AIFC' (4 bytes)
 *   Chunks: chunk_id (4 bytes) + size (4 bytes BE) + data
 *
 * Relevant chunks:
 *   - '.mid' or similar: embedded MIDI
 *   - 'APPL' → nested chunks may contain 'Sequ'
 *   - 'Sequ' (top-level or nested): chord events
 */
function parseAiff(arrayBuffer: ArrayBuffer): AppleLoopParseResult {
  const data = new Uint8Array(arrayBuffer);

  // Validate FORM header
  const formMagic = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
  if (formMagic !== 'FORM') {
    throw new Error('Not a valid AIFF file: missing FORM header');
  }

  const formType = String.fromCharCode(data[8]!, data[9]!, data[10]!, data[11]!);
  if (formType !== 'AIFF' && formType !== 'AIFC') {
    throw new Error('Not a valid AIFF/AIFC file: unexpected form type');
  }

  let midi: ArrayBuffer | null = null;
  const allChordEvents: AppleLoopChordEvent[] = [];
  const beatsPerBar = 4; // Default; could parse from time sig meta

  // Parse top-level IFF chunks starting at offset 12
  const chunks = parseIffChunks(data, 12);

  // Look for MIDI and Sequ chunks
  for (const chunk of chunks) {
    // Check for top-level Sequ chunks (user-generated loops)
    if (chunk.id === 'Sequ') {
      const events = extractChordEventsFromSequ(chunk.data, beatsPerBar);
      allChordEvents.push(...events);
    }

    // Check for '.mid' chunk (MIDI data)
    if (chunk.id === '.mid') {
      const extracted = extractEmbeddedMidi(chunk.data);
      if (extracted && !midi) {
        midi = extracted;
      }
    }

    // Check for 'midi' chunk variant
    if (chunk.id === 'midi') {
      const extracted = extractEmbeddedMidi(chunk.data);
      if (extracted && !midi) {
        midi = extracted;
      }
    }

    // Recurse into APPL chunks for nested Sequ
    if (chunk.id === 'APPL') {
      const sequPayloads = findSequChunks([chunk]);
      for (const sequ of sequPayloads) {
        const events = extractChordEventsFromSequ(sequ, beatsPerBar);
        allChordEvents.push(...events);
      }

      // Also check for embedded MIDI inside APPL
      const subChunks = parseIffChunks(chunk.data);
      for (const sub of subChunks) {
        if (sub.id === '.mid' || sub.id === 'midi') {
          const extracted = extractEmbeddedMidi(sub.data);
          if (extracted && !midi) {
            midi = extracted;
          }
        }
      }
    }
  }

  // Last resort: scan the entire file for MThd
  if (!midi) {
    midi = extractEmbeddedMidi(data);
  }

  return { midi, chordEvents: allChordEvents, beatsPerBar, format: 'AIFF' };
}

// ─── CAF container ──────────────────────────────────────────────────

/**
 * Parse a CAF (Core Audio Format) file and extract Apple Loops data.
 *
 * CAF structure:
 *   File header: 'caff' (4 bytes) + version (2) + flags (2) = 8 bytes
 *   Chunks: chunk_type (4) + chunk_size (i64) + data
 *
 * CAF uses big-endian, chunk sizes are signed 64-bit.
 */
function parseCaf(arrayBuffer: ArrayBuffer): AppleLoopParseResult {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Validate CAF header: 'caff'
  const magic = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
  if (magic !== 'caff') {
    throw new Error('Not a valid CAF file: missing caff header');
  }

  let midi: ArrayBuffer | null = null;
  const allChordEvents: AppleLoopChordEvent[] = [];
  const beatsPerBar = 4;

  // Parse CAF chunks starting at offset 8
  let offset = 8;

  while (offset + 12 <= data.length) {
    const chunkType = String.fromCharCode(
      data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!,
    );

    // CAF chunk size is i64 big-endian; for practical files, read lower 32 bits
    // (upper 32 should be 0 for reasonable file sizes)
    const sizeHi = view.getUint32(offset + 4);
    const sizeLo = view.getUint32(offset + 8);
    const chunkSize = sizeHi === 0 ? sizeLo : -1; // Skip impossibly large chunks

    offset += 12; // past type + size

    if (chunkSize < 0 || offset + chunkSize > data.length) break;

    const chunkData = data.subarray(offset, offset + chunkSize);

    // 'midi' chunk in CAF can contain SMF data
    if (chunkType === 'midi') {
      const extracted = extractEmbeddedMidi(chunkData);
      if (extracted && !midi) {
        midi = extracted;
      }
    }

    // 'info' or user-defined chunks may contain Apple Loops metadata
    // Apple Loops in CAF often use 'user' or vendor-specific chunk types
    if (chunkType === 'user' || chunkType === 'APPL') {
      // Try to parse nested IFF subchunks
      const subChunks = parseIffChunks(chunkData);
      for (const sub of subChunks) {
        if (sub.id === 'Sequ') {
          const events = extractChordEventsFromSequ(sub.data, beatsPerBar);
          allChordEvents.push(...events);
        }
      }

      // Also scan for embedded MIDI
      const extracted = extractEmbeddedMidi(chunkData);
      if (extracted && !midi) {
        midi = extracted;
      }
    }

    offset += chunkSize;
  }

  // Last resort: scan entire file for MThd
  if (!midi) {
    midi = extractEmbeddedMidi(data);
  }

  return { midi, chordEvents: allChordEvents, beatsPerBar, format: 'CAF' };
}

// ─── Main API ───────────────────────────────────────────────────────

/**
 * Parse an Apple Loop file (AIFF or CAF) and extract embedded MIDI + chord metadata.
 */
export function parseAppleLoop(arrayBuffer: ArrayBuffer): AppleLoopParseResult {
  const data = new Uint8Array(arrayBuffer);

  // Detect format by magic bytes
  const magic = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);

  if (magic === 'FORM') {
    return parseAiff(arrayBuffer);
  } else if (magic === 'caff') {
    return parseCaf(arrayBuffer);
  } else {
    throw new Error(`Unsupported file format: ${magic}`);
  }
}

// ─── Enrichment (for b8=15 scheme) ──────────────────────────────────

interface MidiNote {
  pitch: number;
  start: number;
  duration: number;
}

/**
 * Enrich chord events that have accidental hints (b8=15) by inferring
 * root from MIDI notes.
 *
 * Strategy: For each event, find the lowest MIDI pitch within the chord block,
 * reduce to pitch class, and spell it using the accidental hint.
 */
export function enrichChordEventsWithMidiRoots(
  events: AppleLoopChordEvent[],
  midiNotes: MidiNote[],
): AppleLoopChordEvent[] {
  return events.map((event) => {
    // Only enrich events with accidental hint (scheme 2)
    if (!event.accidentalHint) return event;

    // Find MIDI notes that overlap with this chord event
    // (simplified: use all notes in the clip)
    const pitches = midiNotes.map((n) => n.pitch);
    if (pitches.length === 0) return event;

    // Get lowest pitch as root
    const lowestPitch = Math.min(...pitches);
    const rootPc = lowestPitch % 12;

    // Spell root based on accidental hint
    const rootName = spellRootByHint(rootPc, event.accidentalHint);

    return {
      ...event,
      rootPc,
      rootName,
    };
  });
}

function spellRootByHint(
  pc: number,
  hint: 'flat' | 'natural' | 'sharp',
): string {
  const naturals = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const naturalPcs = [0, 2, 4, 5, 7, 9, 11];
  const sharps = ['C♯', 'D♯', 'F♯', 'G♯', 'A♯'];
  const sharpPcs = [1, 3, 6, 8, 10];
  const flats = ['D♭', 'E♭', 'G♭', 'A♭', 'B♭'];
  const flatPcs = [1, 3, 6, 8, 10];

  if (hint === 'natural') {
    const idx = naturalPcs.indexOf(pc);
    if (idx >= 0) return naturals[idx]!;
  } else if (hint === 'sharp') {
    const idx = sharpPcs.indexOf(pc);
    if (idx >= 0) return sharps[idx]!;
  } else if (hint === 'flat') {
    const idx = flatPcs.indexOf(pc);
    if (idx >= 0) return flats[idx]!;
  }

  // Fallback: use natural spelling
  const idx = naturalPcs.indexOf(pc);
  if (idx >= 0) return naturals[idx]!;

  // Last resort: generic sharp
  return sharps[sharpPcs.indexOf(pc)] || `PC${pc}`;
}

// ─── Formatting ─────────────────────────────────────────────────────

/**
 * Convert Apple Loop chord events into a human-readable chord timeline string.
 * Formats chords as symbols when root is decoded, otherwise shows interval sets with quality.
 */
export function formatChordTimeline(events: AppleLoopChordEvent[]): string {
  if (events.length === 0) return '(no chord events)';

  return events
    .map((e) => {
      // Look up chord quality from interval pattern
      const quality = findQualityByIntervals(e.intervals);

      if (e.rootName && e.rootPc !== undefined) {
        // We have a decoded root - format as chord symbol
        if (quality) {
          // Use the quality's display name
          return `${e.rootName}${quality.displayName}`;
        }

        // Fallback: show root + intervals
        return `${e.rootName}[${e.intervals.join(',')}]`;
      }

      // No root decoded - show quality or intervals
      if (quality) {
        // We found a quality! Show it as "?" + display name
        return `?${quality.displayName}`;
      }

      // Fallback: show intervals only
      const intervals = e.intervals.join(',');
      return `[${intervals}]`;
    })
    .join(' | ');
}

/**
 * Convert an Apple Loop chord event to a DetectedChord.
 * Similar to toDetectedChord in gesture.ts, but for Apple Loop metadata.
 */
export function appleLoopEventToDetectedChord(event: AppleLoopChordEvent): {
  chord: DetectedChord | null;
  symbol: string;
} {
  const quality = findQualityByIntervals(event.intervals);

  // If no root, return null chord with interval description
  if (!event.rootName || event.rootPc === undefined) {
    const symbol = quality ? `?${quality.displayName}` : `[${event.intervals.join(',')}]`;
    return { chord: null, symbol };
  }

  // If we have root but no quality match, create a custom symbol
  if (!quality) {
    const symbol = `${event.rootName}[${event.intervals.join(',')}]`;
    return { chord: null, symbol };
  }

  // Full chord with root and quality
  const symbol = `${event.rootName}${quality.displayName}`;

  // Build DetectedChord (minimal structure for display)
  const chord: DetectedChord = {
    root: event.rootPc,
    rootName: event.rootName,
    qualityKey: quality.key,
    symbol,
    qualityName: quality.fullName,
    observedPcs: event.intervals.map(i => (event.rootPc! + i) % 12).sort((a, b) => a - b),
    templatePcs: quality.pcs.map(i => (event.rootPc! + i) % 12).sort((a, b) => a - b),
  };

  return { chord, symbol };
}

/**
 * Convert Apple Loop chord events into a Leadsheet structure.
 * Groups chords by bar and creates proper LeadsheetChord entries.
 *
 * @param events - Apple Loop chord events (should already be sorted by position)
 * @param numBars - Total number of bars in the clip
 * @param beatsPerBar - Beats per bar (typically 4)
 */
export function appleLoopEventsToLeadsheet(
  events: AppleLoopChordEvent[],
  numBars: number,
  beatsPerBar: number = 4,
): Leadsheet | null {
  if (events.length === 0) return null;

  // Group events by bar
  const eventsByBar = new Map<number, AppleLoopChordEvent[]>();

  for (const event of events) {
    // Calculate which bar this event belongs to
    // (simplified: assume single-bar loops or events within first bar)
    const bar = Math.floor(event.positionBeats / beatsPerBar);
    if (!eventsByBar.has(bar)) {
      eventsByBar.set(bar, []);
    }
    eventsByBar.get(bar)!.push(event);
  }

  // Create leadsheet bars
  const bars: LeadsheetBar[] = [];

  for (let barIdx = 0; barIdx < numBars; barIdx++) {
    const barEvents = eventsByBar.get(barIdx) || [];

    if (barEvents.length === 0) {
      // Empty bar - could inherit from previous or show as NC
      continue;
    }

    const chords: LeadsheetChord[] = barEvents.map((event, position) => {
      const { chord, symbol } = appleLoopEventToDetectedChord(event);

      // Calculate beat position within this bar
      const beatPosition = event.positionBeats - (barIdx * beatsPerBar);

      // Calculate duration to next chord or end of bar
      let duration: number;
      if (position < barEvents.length - 1) {
        // Duration until next chord
        const nextEvent = barEvents[position + 1]!;
        const nextBeatPosition = nextEvent.positionBeats - (barIdx * beatsPerBar);
        duration = nextBeatPosition - beatPosition;
      } else {
        // Last chord in bar - duration until end of bar
        duration = beatsPerBar - beatPosition;
      }

      return {
        chord,
        inputText: symbol,
        position,
        totalInBar: barEvents.length,
        beatPosition,
        duration,
      };
    });

    bars.push({
      bar: barIdx,
      chords,
      isRepeat: false,
    });
  }

  // Create input text from all events (for round-trip editing)
  const inputText = formatChordTimeline(events);

  return {
    inputText,
    bars,
  };
}
