/**
 * Chord detection — identifies chord quality and root from a set of MIDI pitches.
 *
 * Algorithm:
 *   1. Extract unique pitch classes from the input pitches.
 *   2. Try each of the 12 possible roots.
 *   3. Rotate the pitch class set so the candidate root is 0.
 *   4. Compute the decimal fingerprint of the rotated set.
 *   5. Look up the fingerprint in the chord dictionary.
 *   6. Among all matches, prefer:
 *      a. Exact match (same number of pitch classes)
 *      b. Fewest extra pitch classes (simpler quality)
 *      c. Lowest root pitch class (conventional preference for lower roots)
 *   7. If no dictionary match is found, return null.
 */

import {
  type ChordMatch,
  type ChordQuality,
  lookupByDecimal,
  pcsToDecimal,
  rotatePcs,
  rootName,
} from './chord-dictionary';

export type { ChordMatch } from './chord-dictionary';

// ─── Single-set detection ──────────────────────────────────────────────

/**
 * Detect a chord from a set of MIDI pitches (absolute, 0-127).
 * Returns the best ChordMatch, or null if no chord quality matches.
 */
export function detectChord(pitches: number[]): ChordMatch | null {
  if (pitches.length === 0) return null;

  // Extract unique pitch classes
  const uniquePcs = [...new Set(pitches.map(p => ((p % 12) + 12) % 12))];

  if (uniquePcs.length < 2) return null; // Single note = no chord

  // Try exact match first (all PCs in input match a dictionary entry exactly)
  const exactMatch = findExactMatch(uniquePcs);
  if (exactMatch) return exactMatch;

  // Try subset matching: maybe the input has passing tones or doublings
  // that don't match exactly, but a subset does
  const subsetMatch = findBestSubsetMatch(uniquePcs);
  if (subsetMatch) return subsetMatch;

  return null;
}

/**
 * Detect a chord from pitch classes (0-11) directly.
 */
export function detectChordFromPcs(pitchClasses: number[]): ChordMatch | null {
  const fakePitches = pitchClasses.map(pc => pc + 60); // octave doesn't matter
  return detectChord(fakePitches);
}

// ─── Internal matching ─────────────────────────────────────────────────

interface ScoredMatch {
  root: number;
  quality: ChordQuality;
  /** Lower is better: 0 = exact, positive = extra notes in input */
  extraNotes: number;
}

function findExactMatch(uniquePcs: number[]): ChordMatch | null {
  const candidates: ScoredMatch[] = [];

  for (let root = 0; root < 12; root++) {
    const rotated = rotatePcs(uniquePcs, root);
    const decimal = pcsToDecimal(rotated);
    const quality = lookupByDecimal(decimal);

    if (quality) {
      // Normalize the quality's PCS for comparison
      const qualityPcsNorm = [...new Set(quality.pcs.map(p => ((p % 12) + 12) % 12))];
      if (qualityPcsNorm.length === uniquePcs.length) {
        candidates.push({ root, quality, extraNotes: 0 });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Prefer simpler qualities (fewer notes = more fundamental)
  // Then prefer conventional root ordering
  candidates.sort((a, b) => {
    // Prefer fewer PCS in quality (simpler chord)
    const aSize = a.quality.pcs.length;
    const bSize = b.quality.pcs.length;
    if (aSize !== bSize) return aSize - bSize;

    // Prefer the bass note as root (lowest pitch class present)
    return a.root - b.root;
  });

  const best = candidates[0];
  return buildMatch(best.root, best.quality, uniquePcs);
}

function findBestSubsetMatch(uniquePcs: number[]): ChordMatch | null {
  const candidates: ScoredMatch[] = [];

  // For each possible root, try to find a quality where the quality's PCS
  // is a subset of the input (input may have extra notes like passing tones)
  for (let root = 0; root < 12; root++) {
    const rotated = rotatePcs(uniquePcs, root);
    const rotatedSet = new Set(rotated);

    // Try progressively smaller subsets by removing notes
    // First: try the full set as-is (already tried above, skip)
    // Then: try removing one note at a time to see if a smaller chord matches
    if (uniquePcs.length >= 3) {
      for (let skip = 0; skip < rotated.length; skip++) {
        const subset = rotated.filter((_, i) => i !== skip);
        if (subset.length < 2) continue;
        // Ensure root (0) is still in subset
        if (!subset.includes(0)) continue;

        const decimal = pcsToDecimal(subset);
        const quality = lookupByDecimal(decimal);
        if (quality) {
          const qualityPcsNorm = [...new Set(quality.pcs.map(p => ((p % 12) + 12) % 12))];
          const extraNotes = rotatedSet.size - qualityPcsNorm.length;
          candidates.push({ root, quality, extraNotes: Math.max(0, extraNotes) });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort: prefer fewer extra notes, then simpler quality, then lower root
  candidates.sort((a, b) => {
    if (a.extraNotes !== b.extraNotes) return a.extraNotes - b.extraNotes;
    const aSize = a.quality.pcs.length;
    const bSize = b.quality.pcs.length;
    if (aSize !== bSize) return bSize - aSize; // prefer larger match (more notes explained)
    return a.root - b.root;
  });

  const best = candidates[0];
  return buildMatch(best.root, best.quality, uniquePcs);
}

/** Map a root-relative semitone distance to a readable interval label. */
function intervalLabel(semitones: number): string {
  const labels: Record<number, string> = {
    0: 'R', 1: 'b9', 2: '9', 3: '#9', 4: '3', 5: '11',
    6: '#11', 7: '5', 8: 'b13', 9: '13', 10: 'b7', 11: '7',
  };
  return labels[semitones] ?? `+${semitones}`;
}

function buildMatch(root: number, quality: ChordQuality, observedPcsAbsolute: number[]): ChordMatch {
  const rn = rootName(root);

  // Compute absolute template PCs
  const templatePcs = quality.pcs.map(pc => (pc + root) % 12).sort((a, b) => a - b);
  const templateSet = new Set(templatePcs);
  const observedSet = new Set(observedPcsAbsolute);

  const extras = observedPcsAbsolute.filter(pc => !templateSet.has(pc)).sort((a, b) => a - b);
  const missing = templatePcs.filter(pc => !observedSet.has(pc)).sort((a, b) => a - b);

  // Build symbol: base quality + extras suffix
  const display = quality.displayName;
  let extrasSuffix = '';
  if (extras.length > 0) {
    const extraIntervals = extras.map(pc => `add${intervalLabel((pc - root + 12) % 12)}`);
    extrasSuffix = `(${extraIntervals.join(',')})`;
  }
  const symbol = `${rn}${display}${extrasSuffix}`;

  return {
    root,
    rootName: rn,
    quality,
    symbol,
    observedPcs: [...observedSet].sort((a, b) => a - b),
    templatePcs,
    extras,
    missing,
  };
}

// ─── Bar-level segmentation ────────────────────────────────────────────

export interface BarChord {
  /** Bar index (0-based) */
  bar: number;
  /** Detected chord for this bar, or null */
  chord: ChordMatch | null;
  /** Pitch classes present in this bar */
  pitchClasses: number[];
  /** MIDI pitches in this bar */
  pitches: number[];
}

/**
 * Segment notes by bar and detect a chord for each bar.
 * Includes notes that are still sounding (sustained) from previous bars.
 *
 * @param pitches     Array of MIDI pitches (parallel with onsets/durations)
 * @param onsets      Array of onset times in ticks
 * @param ticksPerBar Ticks per bar
 * @param numBars     Total number of bars
 * @param durations   Optional array of note durations in ticks.
 *                    When provided, notes sustaining into a bar are included.
 */
/** Tolerance for "simultaneous" note starts/ends (in ticks). */
const BLOCK_TOLERANCE = 30;

/** Check if chord quality is a "simple" triad (preferred in detection). */
function isSimpleTriad(qualityKey: string): boolean {
  return ['maj', 'min', '5'].includes(qualityKey);
}

/**
 * Detect chord blocks within a set of note indices.
 * Groups notes that start and end together into blocks.
 */
function detectBlocksInBar(
  indices: number[],
  onsets: number[],
  durations: number[],
): Array<{ noteIndices: number[]; startTick: number; endTick: number }> {
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
  const blocks: Array<{ noteIndices: number[]; startTick: number; endTick: number }> = [];
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

export function detectChordsPerBar(
  pitches: number[],
  onsets: number[],
  ticksPerBar: number,
  numBars: number,
  durations?: number[],
): BarChord[] {
  const bars: BarChord[] = [];

  for (let bar = 0; bar < numBars; bar++) {
    const barStart = bar * ticksPerBar;
    const barEnd = barStart + ticksPerBar;

    // Collect note indices in this bar
    const barIndices: number[] = [];
    for (let i = 0; i < onsets.length; i++) {
      const onset = onsets[i]!;
      const dur = durations ? durations[i]! : 0;
      const noteEnd = onset + dur;

      // Include if:
      // 1. Note starts in this bar, OR
      // 2. Note started before but is still sounding in this bar
      if ((onset >= barStart && onset < barEnd) ||
          (durations && onset < barStart && noteEnd > barStart)) {
        barIndices.push(i);
      }
    }

    // All pitches in bar (for pitchClasses field)
    const barPitches = barIndices.map(i => pitches[i]!);
    const barPcs = [...new Set(barPitches.map(p => ((p % 12) + 12) % 12))];

    // Detect chord using block-aware logic if durations available
    let chord: ChordMatch | null = null;
    if (durations && barIndices.length >= 2) {
      // Use block detection to find the dominant chord
      const blocks = detectBlocksInBar(barIndices, onsets, durations);

      // Find blocks with 3+ notes (likely full triads or larger chords)
      const chordBlocks = blocks.filter(b => b.noteIndices.length >= 3);

      if (chordBlocks.length > 0) {
        // Strategy: merge all chord-block pitches first — within a bar,
        // arpeggiated/broken patterns collectively spell one harmony.
        const mergedPitches = chordBlocks.flatMap(b =>
          b.noteIndices.map(i => pitches[i]!)
        );
        const mergedChord = detectChord(mergedPitches);

        if (mergedChord) {
          chord = mergedChord;
        } else {
          // Merged set too dense / unrecognizable — fall back to best single block
          const ticksPerBeat = ticksPerBar / 4;
          const scoredBlocks = chordBlocks.map(block => {
            const localTick = block.startTick - barStart;
            const beat = Math.floor(localTick / ticksPerBeat);
            const beatBonus = (beat === 0 || beat === 3) ? 2 : 0;

            const blockPitches = block.noteIndices.map(i => pitches[i]!);
            const blockChord = detectChord(blockPitches);
            const qualityBonus = blockChord && isSimpleTriad(blockChord.quality.key) ? 1 : 0;

            return {
              block,
              chord: blockChord,
              score: block.noteIndices.length * 10 + beatBonus + qualityBonus
            };
          });

          const best = scoredBlocks.reduce((a, b) => b.score > a.score ? b : a);
          chord = best.chord;
        }
      }

      // If no chord from blocks (or no 3+ note blocks), try all pitches
      // This handles sustained notes + new onsets forming a complete chord
      if (!chord) {
        chord = detectChord(barPitches);
      }
    } else if (barPitches.length >= 2) {
      // Fallback: no durations, use all pitches
      chord = detectChord(barPitches);
    }

    // Empty bar inherits previous chord (resonance principle: chord sustains until next change)
    if (chord === null && bar > 0 && bars[bar - 1]) {
      chord = bars[bar - 1].chord;
    }

    bars.push({
      bar,
      chord,
      pitchClasses: barPcs,
      pitches: barPitches,
    });
  }

  return bars;
}

/**
 * Detect a single overall chord for an entire clip.
 * Uses all unique pitch classes across all notes.
 */
export function detectOverallChord(pitches: number[]): ChordMatch | null {
  return detectChord(pitches);
}
