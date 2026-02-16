/**
 * Chord Dictionary — ported from MIDIsplainer Chord-Dictionary branch.
 *
 * Each entry describes a chord quality with its pitch-class set (PCS) rooted at C,
 * a 12-bit binary fingerprint, a decimal form of that fingerprint, and display info.
 *
 * Detection strategy:
 *   1. Collect the unique pitch classes present in a note group.
 *   2. For each of the 12 possible roots (rotations), compute the binary fingerprint.
 *   3. Look up the fingerprint's decimal value in the dictionary.
 *   4. Return the best match (fewest notes = simplest quality; or exact match).
 */

export interface ChordQuality {
  /** Key in the original dictionary (e.g. "maj7", "min", "7b9") */
  key: string;
  /** Full descriptive name */
  fullName: string;
  /** Compact display symbol (e.g. "∆", "-7", "ø") */
  displayName: string;
  /** Pitch class set rooted at C (0-based semitones) */
  pcs: number[];
  /** 12-bit binary string, MSB = pitch class 0 */
  binary: string;
  /** Decimal value of the binary fingerprint */
  decimal: number;
  /** Interval names (e.g. ["R", "3", "5", "♭7"]) */
  intervals: string[];
  /** Alternative names */
  aliases: string[];
}

export interface ChordMatch {
  /** Root pitch class (0 = C, 1 = C#, ..., 11 = B) */
  root: number;
  /** Root note name (e.g. "C", "F#") */
  rootName: string;
  /** Matched chord quality */
  quality: ChordQuality;
  /** Full chord symbol (e.g. "Cmaj7", "F#-7", "D-(add4)") */
  symbol: string;
  /** All observed pitch classes (absolute, 0-11) — never discarded */
  observedPcs: number[];
  /** Template pitch classes from the matched quality (absolute, 0-11) */
  templatePcs: number[];
  /** Observed PCs not in the template (absolute, 0-11) */
  extras: number[];
  /** Template PCs not observed */
  missing: number[];
  /** Bass pitch class for slash chords (undefined = root position) */
  bassPc?: number;
  /** Bass note name for slash chords (e.g. "F" in "Dm/F") */
  bassName?: string;
}

// ─── Note name utilities ───────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const NOTE_NAMES_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const NOTE_NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Get a display-friendly root name for a pitch class. */
export function rootName(pc: number): string {
  return NOTE_NAMES[pc % 12];
}

/** All sharp spellings */
export function rootNameSharp(pc: number): string {
  return NOTE_NAMES_SHARP[pc % 12];
}

/** All flat spellings */
export function rootNameFlat(pc: number): string {
  return NOTE_NAMES_FLAT[pc % 12];
}

// Sharp keys: G(1♯), D(2♯), A(3♯), E(4♯), B(5♯), F♯(6♯)
const SHARP_KEYS: ReadonlySet<number> = new Set([7, 2, 9, 4, 11, 6]);
// Flat keys: F(1♭), B♭(2♭), E♭(3♭), A♭(4♭), D♭(5♭)
const FLAT_KEYS: ReadonlySet<number> = new Set([5, 10, 3, 8, 1]);

/**
 * Spell a pitch class name correctly for a given key context.
 * When keyPc is provided, uses the key signature's spelling rules:
 *   - Sharp keys → sharp chromatic names (+ diatonic E♯, B♯ where needed)
 *   - Flat keys  → flat chromatic names  (+ diatonic C♭, F♭ where needed)
 *   - C          → mixed default
 * When keyPc is omitted, falls back to the existing mixed NOTE_NAMES spelling.
 */
export function spellRoot(pc: number, keyPc?: number): string {
  if (keyPc === undefined) return rootName(pc);
  const k = ((keyPc % 12) + 12) % 12;
  const p = ((pc % 12) + 12) % 12;

  // Diatonic overrides for extreme keys (beyond rootNameSharp/rootNameFlat)
  if (k === 6 && p === 0) return 'B♯';  // F♯ major: scale degree 4♯ enharmonic
  if (k === 6 && p === 5) return 'E♯';  // F♯ major: leading tone
  if (k === 11 && p === 5) return 'E♯'; // B major: leading tone
  if (k === 8 && p === 4) return 'F♭';  // A♭ major: subdominant
  if (k === 1 && p === 11) return 'C♭'; // D♭ major: leading tone

  if (SHARP_KEYS.has(k)) return rootNameSharp(p);
  if (FLAT_KEYS.has(k)) return rootNameFlat(p);
  return rootName(p); // C major — mixed default
}

/**
 * Spell a pitch class consistently with a chord root's accidental direction.
 * Unlike `spellRoot(pc, keyPc)` which classifies by key signature,
 * this derives the direction from the root name itself:
 *   - Root contains ♯ or # → sharp spelling (+ diatonic E♯/B♯ for extreme roots)
 *   - Root contains ♭ or b (not at start) → flat spelling (+ diatonic C♭/F♭)
 *   - Natural root → use `spellRoot(pc, rootPc)` for key-aware context
 *
 * This avoids the mixed-default contradiction where rootName(1) = "C♯"
 * but key-signature classification of PC 1 = D♭ major (flat key).
 */
export function spellInChordContext(pc: number, rootPc: number, rootNameStr?: string): string {
  const rn = rootNameStr ?? rootName(rootPc);
  const p = ((pc % 12) + 12) % 12;
  const r = ((rootPc % 12) + 12) % 12;

  if (rn.includes('♯') || rn.includes('#')) {
    // Apply diatonic overrides for sharp-rooted chords:
    // A third from B♯(0) is D♯♯ — too exotic, skip.
    // But a third from C♯(1) is E♯, a third from F♯(6) is A♯,
    // and the seventh of C♯ is B♯. Use the root PC for overrides.
    if (r === 1 && p === 5) return 'E♯';   // C♯: major 3rd = E♯
    if (r === 1 && p === 0) return 'B♯';   // C♯: major 7th = B♯
    if (r === 6 && p === 0) return 'B♯';   // F♯: perfect 4th / enharmonic
    if (r === 6 && p === 5) return 'E♯';   // F♯: major 7th = E♯
    return rootNameSharp(p);
  }
  if (rn.includes('♭') || (rn.length > 1 && rn.includes('b'))) {
    // Diatonic overrides for flat-rooted chords:
    if (r === 8 && p === 4) return 'F♭';   // A♭: major 6th context
    if (r === 1 && p === 11) return 'C♭';  // D♭: major 7th = C (but as root D♭, 7th is C)
    if (r === 6 && p === 4) return 'F♭';   // G♭: major 7th = F♭
    if (r === 6 && p === 11) return 'C♭';  // G♭: perfect 4th = C♭
    return rootNameFlat(p);
  }
  // Natural root — delegate to key-aware spelling
  return spellRoot(p, rootPc);
}

// ─── Fingerprint utilities ─────────────────────────────────────────────

/**
 * Convert a set of pitch classes (0-11) into a 12-bit binary string.
 * Bit 11 (MSB) = pitch class 0, bit 0 (LSB) = pitch class 11.
 * This matches the MIDIsplainer convention.
 */
export function pcsToBinary(pcs: number[]): string {
  const bits = Array(12).fill('0');
  for (const pc of pcs) {
    bits[pc % 12] = '1';
  }
  return bits.join('');
}

/**
 * Convert a 12-bit binary string to its decimal value.
 */
export function binaryToDecimal(binary: string): number {
  return parseInt(binary, 2);
}

/**
 * Compute the decimal fingerprint for a set of pitch classes.
 */
export function pcsToDecimal(pcs: number[]): number {
  return binaryToDecimal(pcsToBinary(pcs));
}

/**
 * Rotate a set of pitch classes so that `root` becomes 0.
 * Returns sorted unique pitch classes relative to the new root.
 */
export function rotatePcs(pcs: number[], root: number): number[] {
  const rotated = pcs.map(pc => ((pc - root) % 12 + 12) % 12);
  return [...new Set(rotated)].sort((a, b) => a - b);
}

// ─── Dictionary data ───────────────────────────────────────────────────

/**
 * All 104 chord qualities from MIDIsplainer chord_dictionary.json.
 * Each entry's `pcs` is rooted at C (root = 0).
 */
const CHORD_QUALITIES: ChordQuality[] = [
  { key: "4", fullName: "quartal", displayName: "q", pcs: [0,5,10,3], binary: "100101000010", decimal: 2370, intervals: ["R","4","♭7","♭3"], aliases: ["4","quartal"] },
  { key: "5", fullName: "fifth", displayName: "5", pcs: [0,7], binary: "100000010000", decimal: 2064, intervals: ["R","5"], aliases: ["5"] },
  { key: "6", fullName: "major sixth", displayName: "6", pcs: [0,4,7,9], binary: "100010010100", decimal: 2196, intervals: ["R","3","5","6"], aliases: ["6","add6","add13","M6"] },
  { key: "7", fullName: "dominant seventh", displayName: "7", pcs: [0,4,7,10], binary: "100010010010", decimal: 2194, intervals: ["R","3","5","♭7"], aliases: ["7","dom"] },
  { key: "9", fullName: "dominant ninth", displayName: "9", pcs: [0,4,7,10,2], binary: "101010010010", decimal: 2706, intervals: ["R","3","5","♭7","9"], aliases: ["9"] },
  { key: "11", fullName: "dominant eleventh", displayName: "11", pcs: [0,4,7,10,2,5], binary: "101011010010", decimal: 2770, intervals: ["R","3","5","♭7","9","11"], aliases: ["11","dom11"] },
  { key: "13", fullName: "dominant thirteenth", displayName: "13", pcs: [0,4,7,10,2,5,9], binary: "101011010110", decimal: 2774, intervals: ["R","3","5","♭7","9","11","13"], aliases: ["13"] },
  { key: "maj", fullName: "major triad", displayName: "", pcs: [0,4,7], binary: "100010010000", decimal: 2192, intervals: ["R","3","5"], aliases: ["maj","M","major"] },
  { key: "min", fullName: "minor triad", displayName: "-", pcs: [0,3,7], binary: "100100010000", decimal: 2320, intervals: ["R","♭3","5"], aliases: ["min","m","minor","-"] },
  { key: "dim", fullName: "diminished triad", displayName: "°", pcs: [0,3,6], binary: "100100100000", decimal: 2336, intervals: ["R","♭3","♭5"], aliases: ["dim","°"] },
  { key: "aug", fullName: "augmented triad", displayName: "+", pcs: [0,4,8], binary: "100010001000", decimal: 2184, intervals: ["R","3","♯5"], aliases: ["aug","+"] },
  { key: "maj7", fullName: "major seventh", displayName: "∆", pcs: [0,4,7,11], binary: "100010010001", decimal: 2193, intervals: ["R","3","5","7"], aliases: ["maj7","M7","∆","∆7"] },
  { key: "min7", fullName: "minor seventh", displayName: "-7", pcs: [0,3,7,10], binary: "100100010010", decimal: 2322, intervals: ["R","♭3","5","♭7"], aliases: ["min7","m7","-7"] },
  { key: "dim7", fullName: "diminished seventh", displayName: "°7", pcs: [0,3,6,9], binary: "100100100100", decimal: 2340, intervals: ["R","♭3","♭5","𝄫7"], aliases: ["dim7","°7"] },
  { key: "m7b5", fullName: "half-diminished seventh", displayName: "ø", pcs: [0,3,6,10], binary: "100100100010", decimal: 2338, intervals: ["R","♭3","♭5","♭7"], aliases: ["m7b5","ø","ø7"] },
  { key: "minMaj7", fullName: "minor-major seventh", displayName: "m∆", pcs: [0,3,7,11], binary: "100100010001", decimal: 2321, intervals: ["R","♭3","5","7"], aliases: ["minMaj7","mM7","m∆"] },
  { key: "augMaj7", fullName: "augmented major seventh", displayName: "+∆", pcs: [0,4,8,11], binary: "100010001001", decimal: 2185, intervals: ["R","3","♯5","7"], aliases: ["augMaj7","+M7","+∆"] },
  { key: "m6", fullName: "minor sixth", displayName: "-6", pcs: [0,3,7,9], binary: "100100010100", decimal: 2324, intervals: ["R","♭3","5","6"], aliases: ["m6","-6"] },
  { key: "maj9", fullName: "major ninth", displayName: "∆9", pcs: [0,4,7,11,2], binary: "101010010001", decimal: 2705, intervals: ["R","3","5","7","9"], aliases: ["maj9","M9","∆9"] },
  { key: "min9", fullName: "minor ninth", displayName: "-9", pcs: [0,3,7,10,2], binary: "101100010010", decimal: 2834, intervals: ["R","♭3","5","♭7","9"], aliases: ["min9","m9","-9"] },
  { key: "maj11", fullName: "major eleventh", displayName: "∆11", pcs: [0,4,7,11,2,5], binary: "101011010001", decimal: 2769, intervals: ["R","3","5","7","9","11"], aliases: ["maj11","M11","∆11"] },
  { key: "min11", fullName: "minor eleventh", displayName: "-11", pcs: [0,3,7,10,2,5], binary: "101101010010", decimal: 2898, intervals: ["R","♭3","5","♭7","9","11"], aliases: ["min11","m11","-11"] },
  { key: "maj13", fullName: "major thirteenth", displayName: "∆13", pcs: [0,4,7,11,2,5,9], binary: "101011010101", decimal: 2773, intervals: ["R","3","5","7","9","11","13"], aliases: ["maj13","M13","∆13"] },
  { key: "min13", fullName: "minor thirteenth", displayName: "-13", pcs: [0,3,7,10,2,5,9], binary: "101101010110", decimal: 2902, intervals: ["R","♭3","5","♭7","9","11","13"], aliases: ["min13","m13","-13"] },
  { key: "sus2", fullName: "suspended second", displayName: "sus2", pcs: [0,2,7], binary: "101000010000", decimal: 2576, intervals: ["R","2","5"], aliases: ["sus2"] },
  { key: "sus4", fullName: "suspended fourth", displayName: "sus4", pcs: [0,5,7], binary: "100001010000", decimal: 2128, intervals: ["R","4","5"], aliases: ["sus4"] },
  { key: "7sus4", fullName: "dominant seventh suspended fourth", displayName: "7sus4", pcs: [0,5,7,10], binary: "100001010010", decimal: 2130, intervals: ["R","4","5","♭7"], aliases: ["7sus4"] },
  { key: "9sus4", fullName: "dominant ninth suspended fourth", displayName: "9sus4", pcs: [0,5,7,10,2], binary: "101001010010", decimal: 2642, intervals: ["R","4","5","♭7","9"], aliases: ["9sus4"] },
  { key: "7b5", fullName: "dominant seventh diminished", displayName: "7b5", pcs: [0,4,6,10], binary: "100010100010", decimal: 2210, intervals: ["R","3","♭5","♭7"], aliases: ["7b5"] },
  { key: "aug7", fullName: "augmented dominant seventh", displayName: "+7", pcs: [0,4,8,10], binary: "100010001010", decimal: 2186, intervals: ["R","3","♯5","♭7"], aliases: ["aug7","+7","7#5"] },
  { key: "7b9", fullName: "dominant seventh flat ninth", displayName: "7b9", pcs: [0,4,7,10,1], binary: "110010010010", decimal: 3218, intervals: ["R","3","5","♭7","♭9"], aliases: ["7b9"] },
  { key: "7#9", fullName: "dominant seventh sharp ninth", displayName: "7#9", pcs: [0,4,7,10,3], binary: "100110010010", decimal: 2450, intervals: ["R","3","5","♭7","♯9"], aliases: ["7#9"] },
  { key: "7#11", fullName: "lydian dominant seventh", displayName: "7#11", pcs: [0,4,7,10,6], binary: "100010110010", decimal: 2226, intervals: ["R","3","5","♭7","♯11"], aliases: ["7#11"] },
  { key: "7b13", fullName: "dominant seventh flat thirteen", displayName: "7b13", pcs: [0,4,7,10,8], binary: "100010011010", decimal: 2202, intervals: ["R","3","5","♭7","♭13"], aliases: ["7b13"] },
  { key: "6add9", fullName: "sixth added ninth", displayName: "69", pcs: [0,4,7,9,2], binary: "101010010100", decimal: 2708, intervals: ["R","3","5","6","9"], aliases: ["6add9","69"] },
  { key: "M6#11", fullName: "sixth sharp eleventh", displayName: "M6#11", pcs: [0,4,7,9,6], binary: "100010110100", decimal: 2228, intervals: ["R","3","5","6","♯11"], aliases: ["M6#11"] },
  { key: "69#11", fullName: "major sixth ninth sharp eleventh", displayName: "69#11", pcs: [0,4,7,9,2,6], binary: "101010110100", decimal: 2740, intervals: ["R","3","5","6","9","♯11"], aliases: ["69#11"] },
  { key: "maj#4", fullName: "major seventh sharp eleventh", displayName: "∆#4", pcs: [0,4,7,11,6], binary: "100010110001", decimal: 2225, intervals: ["R","3","5","7","♯11"], aliases: ["maj#4","∆#11"] },
  { key: "maj9#11", fullName: "major sharp eleventh (lydian)", displayName: "∆9#11", pcs: [0,4,7,11,2,6], binary: "101010110001", decimal: 2737, intervals: ["R","3","5","7","9","♯11"], aliases: ["maj9#11","∆9#11"] },
  { key: "maj7#9#11", fullName: "major sharp ninth sharp eleventh", displayName: "∆#9#11", pcs: [0,4,7,11,3,6], binary: "100110110001", decimal: 2481, intervals: ["R","3","5","7","♯9","♯11"], aliases: ["maj7#9#11"] },
  { key: "M13#11", fullName: "major thirteenth sharp eleventh", displayName: "∆13#11", pcs: [0,4,7,11,2,6,9], binary: "101010110101", decimal: 2741, intervals: ["R","3","5","7","9","♯11","13"], aliases: ["M13#11"] },
  { key: "M7b9", fullName: "major seventh flat ninth", displayName: "∆b9", pcs: [0,4,7,11,1], binary: "110010010001", decimal: 3217, intervals: ["R","3","5","7","♭9"], aliases: ["M7b9"] },
  { key: "Madd9", fullName: "major added ninth", displayName: "add9", pcs: [0,4,7,2], binary: "101010010000", decimal: 2704, intervals: ["R","3","5","9"], aliases: ["Madd9","add9"] },
  { key: "Maddb9", fullName: "major added flat ninth", displayName: "addb9", pcs: [0,4,7,1], binary: "110010010000", decimal: 3216, intervals: ["R","3","5","♭9"], aliases: ["Maddb9"] },
  { key: "Mb5", fullName: "major diminished", displayName: "b5", pcs: [0,4,6], binary: "100010100000", decimal: 2208, intervals: ["R","3","♭5"], aliases: ["Mb5"] },
  { key: "M7b5", fullName: "major seventh diminished", displayName: "∆b5", pcs: [0,4,6,11], binary: "100010100001", decimal: 2209, intervals: ["R","3","♭5","7"], aliases: ["M7b5"] },
  { key: "M9b5", fullName: "major ninth diminished", displayName: "∆9b5", pcs: [0,4,6,11,2], binary: "101010100001", decimal: 2721, intervals: ["R","3","♭5","7","9"], aliases: ["M9b5"] },
  { key: "mb6", fullName: "minor flat sixth", displayName: "-b6", pcs: [0,3,7,8], binary: "100100011000", decimal: 2328, intervals: ["R","♭3","5","♭6"], aliases: ["mb6"] },
  { key: "m69", fullName: "minor sixth ninth", displayName: "-69", pcs: [0,3,7,9,2], binary: "101100010100", decimal: 2836, intervals: ["R","♭3","5","6","9"], aliases: ["m69"] },
  { key: "m7b9", fullName: "minor seventh flat 9th", displayName: "-7b9", pcs: [0,3,7,10,1], binary: "110100010010", decimal: 3346, intervals: ["R","♭3","5","♭7","♭9"], aliases: ["m7b9"] },
  { key: "mM9", fullName: "minor/major ninth", displayName: "mM9", pcs: [0,3,7,11,2], binary: "101100010001", decimal: 2833, intervals: ["R","♭3","5","7","9"], aliases: ["mM9"] },
  { key: "m7add11", fullName: "minor seventh added eleventh", displayName: "-7add11", pcs: [0,3,7,10,5], binary: "100101010010", decimal: 2386, intervals: ["R","♭3","5","♭7","11"], aliases: ["m7add11"] },
  { key: "madd4", fullName: "minor added fourth", displayName: "-add4", pcs: [0,3,7,5], binary: "100101010000", decimal: 2384, intervals: ["R","♭3","5","4"], aliases: ["madd4"] },
  { key: "mMaj7b6", fullName: "minor/Major seventh flat sixth", displayName: "m∆b6", pcs: [0,3,7,11,8], binary: "100100011001", decimal: 2329, intervals: ["R","♭3","5","7","♭6"], aliases: ["mMaj7b6"] },
  { key: "mMaj9b6", fullName: "minor/Major ninth flat sixth", displayName: "m∆9b6", pcs: [0,3,7,11,2,8], binary: "101100011001", decimal: 2841, intervals: ["R","♭3","5","7","9","♭6"], aliases: ["mMaj9b6"] },
  { key: "madd9", fullName: "minor added ninth", displayName: "-add9", pcs: [0,3,7,2], binary: "101100010000", decimal: 2832, intervals: ["R","♭3","5","9"], aliases: ["madd9"] },
  { key: "m7#5", fullName: "minor seventh sharp fifth", displayName: "-7+", pcs: [0,3,8,10], binary: "100100001010", decimal: 2314, intervals: ["R","♭3","♯5","♭7"], aliases: ["m7#5"] },
  { key: "m9#5", fullName: "minor ninth sharp fifth", displayName: "-9+", pcs: [0,3,8,10,2], binary: "101100001010", decimal: 2826, intervals: ["R","♭3","♯5","♭7","9"], aliases: ["m9#5"] },
  { key: "m11A", fullName: "augmented minor eleventh", displayName: "-11+", pcs: [0,3,8,10,2,5], binary: "101101001010", decimal: 2890, intervals: ["R","♭3","♯5","♭7","9","11"], aliases: ["m11A"] },
  { key: "mb6b9", fullName: "minor flat sixth flat ninth", displayName: "-b6b9", pcs: [0,3,7,8,1], binary: "110100011000", decimal: 3352, intervals: ["R","♭3","5","♭6","♭9"], aliases: ["mb6b9"] },
  { key: "m9b5", fullName: "minor ninth flat fifth", displayName: "ø9", pcs: [0,3,6,10,2], binary: "101100100010", decimal: 2850, intervals: ["R","♭3","♭5","♭7","9"], aliases: ["m9b5","ø9"] },
  { key: "o7M7", fullName: "diminished seventh Major seventh", displayName: "°7M7", pcs: [0,3,6,9,11], binary: "100100100101", decimal: 2341, intervals: ["R","♭3","♭5","𝄫7","7"], aliases: ["o7M7"] },
  { key: "oM7", fullName: "diminished/Major seventh", displayName: "°M7", pcs: [0,3,6,11], binary: "100100100001", decimal: 2337, intervals: ["R","♭3","♭5","7"], aliases: ["oM7"] },
  { key: "alt7", fullName: "altered", displayName: "alt7", pcs: [0,4,10,1], binary: "110010000010", decimal: 3202, intervals: ["R","3","♭7","♭9"], aliases: ["alt7"] },
  { key: "7#11b13", fullName: "dominant flat sixth flat fifth", displayName: "7#11b13", pcs: [0,4,7,10,6,8], binary: "100010111010", decimal: 2234, intervals: ["R","3","5","♭7","♯11","♭13"], aliases: ["7#11b13"] },
  { key: "7add6", fullName: "dominant added thirteenth", displayName: "7add6", pcs: [0,4,7,9,10], binary: "100010010110", decimal: 2198, intervals: ["R","3","5","6","♭7"], aliases: ["7add6"] },
  { key: "7#9#11", fullName: "dominant sharp ninth sharp eleventh", displayName: "7#9#11", pcs: [0,4,7,10,3,6], binary: "100110110010", decimal: 2482, intervals: ["R","3","5","♭7","♯9","♯11"], aliases: ["7#9#11"] },
  { key: "13#9#11", fullName: "dominant thirteenth sharp ninth sharp eleventh", displayName: "13#9#11", pcs: [0,4,7,10,3,6,9], binary: "100110110110", decimal: 2486, intervals: ["R","3","5","♭7","♯9","♯11","13"], aliases: ["13#9#11"] },
  { key: "7#9#11b13", fullName: "dominanth flat thirteenth sharp ninth sharp eleventh", displayName: "7#9#11b13", pcs: [0,4,7,10,3,6,8], binary: "100110111010", decimal: 2490, intervals: ["R","3","5","♭7","♯9","♯11","♭13"], aliases: ["7#9#11b13"] },
  { key: "13#9", fullName: "dominant thirteenth sharp ninth", displayName: "13#9", pcs: [0,4,7,10,3,5,9], binary: "100111010110", decimal: 2518, intervals: ["R","3","5","♭7","♯9","11","13"], aliases: ["13#9"] },
  { key: "7#9b13", fullName: "dominant sharp ninth flat thirteenth", displayName: "7#9b13", pcs: [0,4,7,10,3,8], binary: "100110011010", decimal: 2458, intervals: ["R","3","5","♭7","♯9","♭13"], aliases: ["7#9b13"] },
  { key: "9#11", fullName: "dominant ninth sharp eleventh", displayName: "9#11", pcs: [0,4,7,10,2,6], binary: "101010110010", decimal: 2738, intervals: ["R","3","5","♭7","9","♯11"], aliases: ["9#11"] },
  { key: "13#11", fullName: "dominant thirteenth sharp eleventh", displayName: "13#11", pcs: [0,4,7,10,2,6,9], binary: "101010110110", decimal: 2742, intervals: ["R","3","5","♭7","9","♯11","13"], aliases: ["13#11"] },
  { key: "9#11b13", fullName: "dominant ninth sharp eleventh flat thirteenth", displayName: "9#11b13", pcs: [0,4,7,10,2,6,8], binary: "101010111010", decimal: 2746, intervals: ["R","3","5","♭7","9","♯11","♭13"], aliases: ["9#11b13"] },
  { key: "7b9#11", fullName: "dominant flat ninth sharp eleventh", displayName: "7b9#11", pcs: [0,4,7,10,1,6], binary: "110010110010", decimal: 3250, intervals: ["R","3","5","♭7","♭9","♯11"], aliases: ["7b9#11"] },
  { key: "13b9#11", fullName: "dominant thirteenth flat ninth sharp eleventh", displayName: "13b9#11", pcs: [0,4,7,10,1,6,9], binary: "110010110110", decimal: 3254, intervals: ["R","3","5","♭7","♭9","♯11","13"], aliases: ["13b9#11"] },
  { key: "7b9b13#11", fullName: "dominant flat thirteenth flat ninth sharp eleventh", displayName: "7b9b13#11", pcs: [0,4,7,10,1,6,8], binary: "110010111010", decimal: 3258, intervals: ["R","3","5","♭7","♭9","♯11","♭13"], aliases: ["7b9b13#11"] },
  { key: "13b9", fullName: "dominant thirteenth flat ninth", displayName: "13b9", pcs: [0,4,7,10,1,5,9], binary: "110011010110", decimal: 3286, intervals: ["R","3","5","♭7","♭9","11","13"], aliases: ["13b9"] },
  { key: "7b9b13", fullName: "dominant flat thirteenth flat ninth", displayName: "7b9b13", pcs: [0,4,7,10,1,8], binary: "110010011010", decimal: 3226, intervals: ["R","3","5","♭7","♭9","♭13"], aliases: ["7b9b13"] },
  { key: "7b9#9", fullName: "dominant flat ninth sharp ninth", displayName: "7b9#9", pcs: [0,3,4,7,10,1], binary: "110110010010", decimal: 3474, intervals: ["R","♭3","3","5","♭7","♭9"], aliases: ["7b9#9"] },
  { key: "7#5#9", fullName: "altered dominant", displayName: "7#5#9", pcs: [0,4,8,10,3], binary: "100110001010", decimal: 2442, intervals: ["R","3","♯5","♭7","♯9"], aliases: ["7#5#9"] },
  { key: "9#5", fullName: "dominant ninth augmented", displayName: "9#5", pcs: [0,4,8,10,2], binary: "101010001010", decimal: 2698, intervals: ["R","3","♯5","♭7","9"], aliases: ["9#5"] },
  { key: "9#5#11", fullName: "dominant ninth augmented sharp eleventh", displayName: "9#5#11", pcs: [0,4,8,10,2,6], binary: "101010101010", decimal: 2730, intervals: ["R","3","♯5","♭7","9","♯11"], aliases: ["9#5#11"] },
  { key: "7#5b9", fullName: "dominant augmented flat ninth", displayName: "7#5b9", pcs: [0,4,8,10,1], binary: "110010001010", decimal: 3210, intervals: ["R","3","♯5","♭7","♭9"], aliases: ["7#5b9"] },
  { key: "7#5b9#11", fullName: "dominant augmented flat ninth sharp eleventh", displayName: "7#5b9#11", pcs: [0,4,8,10,1,6], binary: "110010101010", decimal: 3242, intervals: ["R","3","♯5","♭7","♭9","♯11"], aliases: ["7#5b9#11"] },
  { key: "13b5", fullName: "dominant thirteenth diminished", displayName: "13b5", pcs: [0,4,6,10,2,5,9], binary: "101011100110", decimal: 2790, intervals: ["R","3","♭5","♭7","9","11","13"], aliases: ["13b5"] },
  { key: "9b5", fullName: "dominant ninth diminished", displayName: "9b5", pcs: [0,4,6,10,2], binary: "101010100010", decimal: 2722, intervals: ["R","3","♭5","♭7","9"], aliases: ["9b5"] },
  { key: "7no5", fullName: "dominant seventh no fifth", displayName: "7no5", pcs: [0,4,10], binary: "100010000010", decimal: 2178, intervals: ["R","3","♭7"], aliases: ["7no5"] },
  { key: "9no5", fullName: "dominant ninth no fifth", displayName: "9no5", pcs: [0,4,10,2], binary: "101010000010", decimal: 2690, intervals: ["R","3","♭7","9"], aliases: ["9no5"] },
  { key: "13no5", fullName: "dominant thirteenth no fifth", displayName: "13no5", pcs: [0,4,10,2,5,9], binary: "101011000110", decimal: 2758, intervals: ["R","3","♭7","9","11","13"], aliases: ["13no5"] },
  { key: "sus24", fullName: "suspended second fourth", displayName: "sus24", pcs: [0,2,5,7], binary: "101001010000", decimal: 2640, intervals: ["R","2","4","5"], aliases: ["sus24"] },
  { key: "b9sus", fullName: "suspended fourth flat ninth", displayName: "b9sus", pcs: [0,5,7,10,1], binary: "110001010010", decimal: 3154, intervals: ["R","4","5","♭7","♭9"], aliases: ["b9sus"] },
  { key: "13sus4", fullName: "dominant thirteenth suspended fourth", displayName: "13sus4", pcs: [0,5,7,10,2,9], binary: "101001010110", decimal: 2646, intervals: ["R","4","5","♭7","9","13"], aliases: ["13sus4"] },
  { key: "7sus4b9b13", fullName: "dominant seventh suspended fourth flat ninth flat thirteenth", displayName: "7sus4b9b13", pcs: [0,5,7,10,1,8], binary: "110001011010", decimal: 3162, intervals: ["R","4","5","♭7","♭9","♭13"], aliases: ["7sus4b9b13"] },
  { key: "M7sus4", fullName: "major seventh suspended fourth", displayName: "M7sus4", pcs: [0,5,7,11], binary: "100001010001", decimal: 2129, intervals: ["R","4","5","7"], aliases: ["M7sus4"] },
  { key: "M9sus4", fullName: "major ninth suspended fourth", displayName: "M9sus4", pcs: [0,5,7,11,2], binary: "101001010001", decimal: 2641, intervals: ["R","4","5","7","9"], aliases: ["M9sus4"] },
  { key: "M7#5sus4", fullName: "major seventh augmented suspended fourth", displayName: "M7#5sus4", pcs: [0,5,11,8], binary: "100001001001", decimal: 2121, intervals: ["R","4","♯5","7"], aliases: ["M7#5sus4"] },
  { key: "M9#5sus4", fullName: "major ninth augmented suspended fourth", displayName: "M9#5sus4", pcs: [0,5,8,11,2], binary: "101001001001", decimal: 2633, intervals: ["R","4","♯5","7","9"], aliases: ["M9#5sus4"] },
  { key: "7b13sus", fullName: "dominant flat 13th sus", displayName: "7b13sus", pcs: [0,5,7,8], binary: "100001011000", decimal: 2136, intervals: ["R","4","5","♭6"], aliases: ["7b13sus"] },
  { key: "7#5sus4", fullName: "dominant seventh sharp fifth suspended fourth", displayName: "7#5sus4", pcs: [0,5,8,10], binary: "100001001010", decimal: 2122, intervals: ["R","4","♯5","♭7"], aliases: ["7#5sus4"] },
  { key: "m#5", fullName: "minor augmented", displayName: "m#5", pcs: [0,3,8], binary: "100100001000", decimal: 2312, intervals: ["R","♭3","♯5"], aliases: ["m#5"] },
  { key: "maj9#5", fullName: "augmented ninth", displayName: "maj9#5", pcs: [0,4,8,11,2], binary: "101010001001", decimal: 2697, intervals: ["R","3","♯5","7","9"], aliases: ["maj9#5"] },
  { key: "M#5add9", fullName: "augmented added ninth", displayName: "M#5add9", pcs: [0,4,8,2], binary: "101010001000", decimal: 2696, intervals: ["R","3","♯5","9"], aliases: ["M#5add9"] },
  { key: "+add#9", fullName: "augmented added sharp ninth", displayName: "+add#9", pcs: [0,4,8,3], binary: "100110001000", decimal: 2440, intervals: ["R","3","♯5","♯9"], aliases: ["+add#9"] },
];

// ─── Lookup index ──────────────────────────────────────────────────────

/**
 * Map from decimal fingerprint → chord quality.
 * Built once at module load time.
 */
const DECIMAL_INDEX: Map<number, ChordQuality> = new Map();

for (const q of CHORD_QUALITIES) {
  DECIMAL_INDEX.set(q.decimal, q);
}

/**
 * Look up a chord quality by its decimal fingerprint.
 */
export function lookupByDecimal(decimal: number): ChordQuality | undefined {
  return DECIMAL_INDEX.get(decimal);
}

/**
 * Get all chord qualities.
 */
export function getAllQualities(): readonly ChordQuality[] {
  return CHORD_QUALITIES;
}

/**
 * Get the number of chord qualities in the dictionary.
 */
export function dictionarySize(): number {
  return CHORD_QUALITIES.length;
}

/**
 * Look up a chord quality by its interval pattern.
 * Intervals should be semitones from root (e.g., [0,4,7,11] for maj7).
 * Returns the first matching quality, or undefined if no exact match.
 */
export function findQualityByIntervals(intervals: number[]): ChordQuality | undefined {
  // Normalize intervals to sorted set
  const sorted = [...new Set(intervals)].sort((a, b) => a - b);

  // Search for exact match in dictionary
  for (const quality of CHORD_QUALITIES) {
    if (quality.pcs.length === sorted.length &&
        quality.pcs.every((pc, i) => pc === sorted[i])) {
      return quality;
    }
  }

  return undefined;
}
