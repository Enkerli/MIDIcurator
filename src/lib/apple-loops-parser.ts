/**
 * Apple Loops parser: extracts embedded SMF MIDI and chord metadata
 * from AIFF/AIFC and CAF container files.
 *
 * Based on reverse-engineering documented in docs/APPLE_LOOPS_REVERSE_ENGINEERING.md
 */

// ─── Types ──────────────────────────────────────────────────────────

/** A chord event extracted from a Sequ payload (type 103). */
export interface AppleLoopChordEvent {
  /** Pitch-class interval bitmask (12 bits, relative to unknown root). */
  mask: number;
  /** Decoded intervals (semitones above root, e.g. [0, 4, 7]). */
  intervals: number[];
  /** Position within bar in beats (0-based, floating point). */
  positionBeats: number;
  /** Raw be22 field (for debugging / future use). */
  rawBe22: number;
  /** Raw b8 field (may encode root — not yet proven). */
  b8: number;
  /** Raw b9 field (may encode root — not yet proven). */
  b9: number;
}

/** Result of parsing an Apple Loops file. */
export interface AppleLoopParseResult {
  /** Extracted SMF MIDI as an ArrayBuffer, or null if not found. */
  midi: ArrayBuffer | null;
  /** Chord events decoded from Sequ payloads. */
  chordEvents: AppleLoopChordEvent[];
  /** Beats per bar used for position decoding (default 4). */
  beatsPerBar: number;
  /** Container format detected. */
  format: 'aiff' | 'aifc' | 'caf';
}

// ─── AIFF chunk parsing ────────────────────────────────────────────

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

    if (offset + size > data.length) break; // truncated

    chunks.push({
      id,
      data: data.subarray(offset, offset + size),
      offset: offset,
    });

    offset += size;
    // AIFF chunks are padded to even boundaries
    if (size % 2 !== 0 && offset < data.length) {
      offset += 1;
    }
  }

  return chunks;
}

/**
 * Decode the 12-bit interval mask into an array of semitone intervals.
 */
export function decodeIntervalMask(mask: number): number[] {
  const intervals: number[] = [];
  for (let i = 0; i < 12; i++) {
    if (mask & (1 << i)) {
      intervals.push(i);
    }
  }
  return intervals;
}

/**
 * Decode be22 field into beat position within bar.
 * See docs: norm = (be22 & 0xFFFFFFFF) / 65536.0
 *           pos_beats = (1.0 - norm) * beats_per_bar, wrapped
 */
function decodeBe22(be22: number, beatsPerBar: number): number {
  const norm = (be22 >>> 0) / 65536.0;
  let pos = (1.0 - norm) * beatsPerBar;
  pos = ((pos % beatsPerBar) + beatsPerBar) % beatsPerBar;
  return pos;
}

/**
 * Scan a Sequ payload for chord events (type == 103).
 * Scans every 2-byte-aligned position looking for type-103 records.
 */
function extractChordEventsFromSequ(
  data: Uint8Array,
  beatsPerBar: number,
): AppleLoopChordEvent[] {
  const events: AppleLoopChordEvent[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const RECORD_SIZE = 30;

  // Scan for type==103 records at every 2-byte boundary
  for (let off = 0; off + RECORD_SIZE <= data.length; off += 2) {
    const type = view.getUint16(off);
    if (type !== 103) continue;

    const mask = view.getUint16(off + 0x04);
    const b8 = data[off + 0x08]!;
    const b9 = data[off + 0x09]!;
    const be22 = view.getUint32(off + 0x16);

    const intervals = decodeIntervalMask(mask);
    const positionBeats = decodeBe22(be22, beatsPerBar);

    events.push({
      mask,
      intervals,
      positionBeats,
      rawBe22: be22,
      b8,
      b9,
    });
  }

  // Sort by position within bar
  events.sort((a, b) => a.positionBeats - b.positionBeats);

  return events;
}

/**
 * Scan a byte array for the SMF MThd signature.
 * Returns the offset if found, or -1.
 */
function findMThd(data: Uint8Array): number {
  // Look for "MThd" (0x4D546864)
  for (let i = 0; i <= data.length - 4; i++) {
    if (
      data[i] === 0x4D &&
      data[i + 1] === 0x54 &&
      data[i + 2] === 0x68 &&
      data[i + 3] === 0x64
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Given a byte array starting at MThd, compute the total SMF size
 * by reading the header and all track chunks.
 */
function computeSmfSize(data: Uint8Array, start: number): number {
  const view = new DataView(data.buffer, data.byteOffset + start, data.byteLength - start);

  // MThd header: 4 bytes id + 4 bytes size + 6 bytes data = 14 bytes
  if (start + 14 > data.length) return -1;

  const headerSize = view.getUint32(4);
  let offset = 8 + headerSize; // past MThd id + size + data

  const trackCount = view.getUint16(10); // format at 8, tracks at 10

  for (let i = 0; i < trackCount; i++) {
    if (start + offset + 8 > data.length) return -1;

    const chunkId = String.fromCharCode(
      data[start + offset]!,
      data[start + offset + 1]!,
      data[start + offset + 2]!,
      data[start + offset + 3]!,
    );

    if (chunkId !== 'MTrk') return -1;

    const trackLen = view.getUint32(offset + 4);
    offset += 8 + trackLen;
  }

  return offset;
}

/**
 * Extract embedded SMF MIDI data from a region.
 * Searches for MThd signature and computes the full SMF extent.
 */
function extractEmbeddedMidi(data: Uint8Array): ArrayBuffer | null {
  const mthdOffset = findMThd(data);
  if (mthdOffset < 0) return null;

  const smfSize = computeSmfSize(data, mthdOffset);
  if (smfSize <= 0) return null;

  // Copy to a standalone ArrayBuffer
  const midi = new ArrayBuffer(smfSize);
  new Uint8Array(midi).set(data.subarray(mthdOffset, mthdOffset + smfSize));
  return midi;
}

// ─── AIFF container ─────────────────────────────────────────────────

/**
 * Parse an AIFF/AIFC file and extract Apple Loops data.
 */
function parseAiff(arrayBuffer: ArrayBuffer): AppleLoopParseResult {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Validate FORM header
  const formTag = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
  if (formTag !== 'FORM') {
    throw new Error('Not a valid AIFF file: missing FORM header');
  }

  const formSize = view.getUint32(4);
  const formType = String.fromCharCode(data[8]!, data[9]!, data[10]!, data[11]!);

  if (formType !== 'AIFF' && formType !== 'AIFC') {
    throw new Error(`Not a valid AIFF file: unexpected form type "${formType}"`);
  }

  const format = formType === 'AIFC' ? 'aifc' as const : 'aiff' as const;

  // Parse top-level chunks (skip FORM header: 4 id + 4 size + 4 type = 12 bytes)
  const bodyEnd = Math.min(8 + formSize, data.length);
  const bodyData = data.subarray(12, bodyEnd);
  const topChunks = parseIffChunks(bodyData);

  let midi: ArrayBuffer | null = null;
  const allChordEvents: AppleLoopChordEvent[] = [];
  const beatsPerBar = 4; // default; could be refined from time sig metadata

  for (const chunk of topChunks) {
    // Standard AIFF MIDI chunk
    if (chunk.id === 'MIDI') {
      const extracted = extractEmbeddedMidi(chunk.data);
      if (extracted && !midi) {
        midi = extracted;
      }
    }

    // Apple Loops metadata in APPL chunks
    if (chunk.id === 'APPL') {
      // Parse nested subchunks inside APPL payload
      const subChunks = parseIffChunks(chunk.data);

      for (const sub of subChunks) {
        if (sub.id === 'Sequ') {
          const events = extractChordEventsFromSequ(sub.data, beatsPerBar);
          allChordEvents.push(...events);
        }
      }

      // Also scan the raw APPL payload for embedded MIDI
      // (some loops embed SMF directly in the APPL block)
      if (!midi) {
        const extracted = extractEmbeddedMidi(chunk.data);
        if (extracted) {
          midi = extracted;
        }
      }
    }
  }

  // Last resort: scan the entire file for MThd
  if (!midi) {
    midi = extractEmbeddedMidi(data);
  }

  return { midi, chordEvents: allChordEvents, beatsPerBar, format };
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
      if (!midi) {
        const extracted = extractEmbeddedMidi(chunkData);
        if (extracted) {
          midi = extracted;
        }
      }
    }

    offset += chunkSize;
  }

  // Last resort: scan entire file for MThd
  if (!midi) {
    midi = extractEmbeddedMidi(data);
  }

  return { midi, chordEvents: allChordEvents, beatsPerBar, format: 'caf' };
}

// ─── Public API ─────────────────────────────────────────────────────

/** File extensions accepted for Apple Loops. */
export const APPLE_LOOP_EXTENSIONS = ['.aif', '.aiff', '.caf'];

/**
 * Check whether a filename looks like an Apple Loops file.
 */
export function isAppleLoopFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return APPLE_LOOP_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Parse an Apple Loops file (AIFF, AIFC, or CAF).
 *
 * Returns extracted MIDI data (if embedded), chord events from Sequ payloads,
 * and container format metadata.
 *
 * @throws Error if the file format is not recognized.
 */
export function parseAppleLoop(arrayBuffer: ArrayBuffer): AppleLoopParseResult {
  const data = new Uint8Array(arrayBuffer);

  if (data.length < 12) {
    throw new Error('File too small to be an Apple Loops file');
  }

  // Detect container by magic bytes
  const magic4 = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);

  if (magic4 === 'FORM') {
    return parseAiff(arrayBuffer);
  }

  if (magic4 === 'caff') {
    return parseCaf(arrayBuffer);
  }

  throw new Error(`Unrecognized container format (magic: "${magic4}")`);
}

/**
 * Convert Apple Loop chord events into a human-readable chord timeline string.
 * Useful for debugging and display before root resolution is available.
 *
 * Since absolute roots are not yet decoded, chords are shown as interval sets.
 */
export function formatChordTimeline(events: AppleLoopChordEvent[]): string {
  if (events.length === 0) return '(no chord events)';

  return events.map(e => {
    const intervals = e.intervals.join(',');
    const pos = e.positionBeats.toFixed(2);
    return `beat ${pos}: [${intervals}]`;
  }).join(' | ');
}
