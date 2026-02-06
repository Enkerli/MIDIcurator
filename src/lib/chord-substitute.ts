/**
 * Chord Substitution — transforms note pitches to match a new chord.
 *
 * When substituting chords, we map each note to the closest chord tone
 * in the target chord, preserving the octave register as much as possible.
 */

import type { DetectedChord } from '../types/clip';
import { getAllQualities } from './chord-dictionary';

/**
 * Get the pitch classes that make up a chord.
 * E.g., G- (G minor) returns [7, 10, 2] (G, Bb, D)
 *
 * @param chord The chord to extract pitch classes from
 * @returns Array of pitch classes (0-11)
 */
export function getChordPitchClasses(chord: DetectedChord): number[] {
  // Find the quality in the dictionary to get its PCS
  const quality = getAllQualities().find(q => q.key === chord.qualityKey);
  if (!quality) {
    // Fallback: just return the root
    return [chord.root];
  }

  // quality.pcs is rooted at 0 (e.g., [0,3,7] for minor)
  // Add chord.root to get actual pitch classes
  return quality.pcs.map(pc => (pc + chord.root) % 12);
}

/**
 * Find the closest pitch in targetPcs to the given pitch,
 * staying within the same octave or ±1 octave.
 *
 * @param pitch The original MIDI pitch (0-127)
 * @param targetPcs Array of target pitch classes (0-11)
 * @returns The closest MIDI pitch that is a chord tone
 */
export function mapToClosestChordTone(
  pitch: number,
  targetPcs: number[]
): number {
  if (targetPcs.length === 0) return pitch;

  const octave = Math.floor(pitch / 12);

  // Generate candidate pitches in nearby octaves
  const candidates: number[] = [];
  for (let oct = octave - 1; oct <= octave + 1; oct++) {
    if (oct < 0) continue;
    for (const pc of targetPcs) {
      const candidate = oct * 12 + pc;
      if (candidate >= 0 && candidate <= 127) {
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) return pitch;

  // Find closest
  let closest = candidates[0]!;
  let minDist = Math.abs(pitch - closest);
  for (const c of candidates) {
    const dist = Math.abs(pitch - c);
    if (dist < minDist) {
      minDist = dist;
      closest = c;
    }
  }

  return closest;
}

/**
 * Substitute pitches in a time range to match a new chord.
 * Only affects notes whose onset falls within [segStartTick, segEndTick).
 *
 * @param pitches Array of MIDI pitches (parallel with onsets)
 * @param onsets Array of onset times in ticks
 * @param segStartTick Start of the segment (absolute tick)
 * @param segEndTick End of the segment (absolute tick)
 * @param newChord The target chord to map notes to
 * @returns New pitches array with substitutions applied
 */
export function substituteSegmentPitches(
  pitches: number[],
  onsets: number[],
  segStartTick: number,
  segEndTick: number,
  newChord: DetectedChord
): number[] {
  const targetPcs = getChordPitchClasses(newChord);

  return pitches.map((pitch, i) => {
    const onset = onsets[i]!;
    // Only transform notes that start in this segment
    if (onset >= segStartTick && onset < segEndTick) {
      return mapToClosestChordTone(pitch, targetPcs);
    }
    return pitch; // Keep unchanged
  });
}

/**
 * Substitute all pitches in a clip to match a new chord.
 * Useful for whole-clip transposition/reharmonization.
 *
 * @param pitches Array of MIDI pitches
 * @param newChord The target chord to map notes to
 * @returns New pitches array with all notes mapped to chord tones
 */
export function substituteAllPitches(
  pitches: number[],
  newChord: DetectedChord
): number[] {
  const targetPcs = getChordPitchClasses(newChord);
  return pitches.map(pitch => mapToClosestChordTone(pitch, targetPcs));
}
