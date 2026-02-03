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
  return buildMatch(best.root, best.quality);
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
  return buildMatch(best.root, best.quality);
}

function buildMatch(root: number, quality: ChordQuality): ChordMatch {
  const rn = rootName(root);
  const display = quality.displayName;
  // For major triad, displayName is "" so symbol is just the root
  const symbol = `${rn}${display}`;

  return {
    root,
    rootName: rn,
    quality,
    symbol,
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
 *
 * @param pitches    Array of MIDI pitches (parallel with onsets)
 * @param onsets     Array of onset times in ticks
 * @param ticksPerBar Ticks per bar
 * @param numBars    Total number of bars
 */
export function detectChordsPerBar(
  pitches: number[],
  onsets: number[],
  ticksPerBar: number,
  numBars: number,
): BarChord[] {
  const bars: BarChord[] = [];

  for (let bar = 0; bar < numBars; bar++) {
    const barStart = bar * ticksPerBar;
    const barEnd = barStart + ticksPerBar;

    const barPitches: number[] = [];
    for (let i = 0; i < onsets.length; i++) {
      if (onsets[i] >= barStart && onsets[i] < barEnd) {
        barPitches.push(pitches[i]);
      }
    }

    const barPcs = [...new Set(barPitches.map(p => ((p % 12) + 12) % 12))];
    const chord = barPitches.length >= 2 ? detectChord(barPitches) : null;

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
