# Implementation Plan: Range Selection + Chord Adaptation

## Feature 1: Range Selection on Piano Roll

**Goal**: Click-drag horizontally on the piano roll to select a time range, detect the chord for notes within that range.

### Lib Layer (pure functions)

**`src/lib/piano-roll.ts`** — Add 3 functions + 1 type:
- `xToTick(x, layout)` → tick (inverse of existing tick-to-x math)
- `snapTickToBeat(tick, ticksPerBeat, snapToBar?, ticksPerBar?)` → snapped tick
- `getNotesInTickRange(gesture, range)` → index array (notes overlapping the range)
- Export `TickRange` interface `{ startTick, endTick }`

**`src/lib/chord-detect.ts`** — Add 1 function:
- `detectChordInRange(gesture, harmonic, range)` → `{ chord, pitches, pitchClasses }`

### UI Layer

**`src/types/clip.ts`** — Add `RangeSelection` interface:
```
{ startTick, endTick, chord, pitches, pitchClasses, noteCount }
```

**`src/components/PianoRoll.tsx`** — Major changes:
- New props: `onRangeSelect?(selection | null)`, `snapToBeats?`
- Mouse handlers: mouseDown/mouseMove/mouseUp on canvas
- Convert pixel → tick via `xToTick`, optional beat-snapping
- Selection overlay drawn on canvas (semi-transparent blue highlight + edge lines)
- Escape key clears selection
- On mouseUp: run `detectChordInRange`, fire `onRangeSelect` callback
- Minimum drag distance threshold (< quarter beat = click = clear)

**`src/components/StatsGrid.tsx`** — Add `rangeSelection?` prop:
- Priority: range selection chord > playhead chord > overall chord
- Label changes to "Chord (N notes selected)" when selection active

**`src/components/ClipDetail.tsx`** — Pass through new props

**`src/components/MidiCurator.tsx`** — Add `rangeSelection` state, clear on clip switch

---

## Feature 2: Simple Chord Adaptation

**Goal**: Type a target chord symbol, transpose the pattern to fit that chord.

### Lib Layer

**`src/lib/chord-parse.ts`** — New file, chord symbol parser:
- `parseChordSymbol(input)` → `ParsedChord { root, rootName, quality, symbol }` or null
- Root parsing: A-G + optional #/b/♯/♭
- Quality matching: suffix matched against dictionary keys, displayNames, aliases
- Common shorthands: "m"→min, "M7"→maj7, "-"→min, "+"→aug, "o"→dim, "ø"→m7b5

**`src/lib/transform.ts`** — Add `adaptToChord(gesture, harmonic, params)`:
- Parse target chord via `parseChordSymbol`
- Compute transposition interval: `(targetRoot - sourceRoot) mod 12`
- Transpose all pitches by that interval
- Optional: quantize non-chord tones to nearest target chord tone
- Re-detect chords on the transposed pitches
- Return `TransformResult` (same gesture, new harmonic)

### UI Layer

**`src/components/TransformControls.tsx`** — Add chord adaptation section:
- Source chord display (from detected chord) → arrow → text input for target
- "Adapt" button (also Enter key)
- "Quantize non-chord tones" checkbox
- Error message display for invalid chord symbols

**`src/components/ClipDetail.tsx`** — Pass through chord adaptation props

**`src/components/MidiCurator.tsx`** — Add state + `handleAdaptChord` callback:
- `targetChord`, `quantizeNonChordTones`, `chordParseError` state
- Creates variant clip with transposed harmonic, same gesture
- Same pattern as existing `generateSingleVariant`

**`src/App.css`** — Styles for chord adaptation input, cursor for piano roll

---

## Testing

**New test file**: `src/lib/__tests__/chord-parse.test.ts`
- Root parsing (C, D, F#, Bb, Eb, Ab, G#)
- Quality matching (maj7, min7, 7, dim, aug, sus4, ø, 7#9, etc.)
- Edge cases (empty, garbage, whitespace, case insensitivity)
- Round-trip with detectChord

**Extend existing tests**:
- `piano-roll.test.ts`: xToTick, snapTickToBeat, getNotesInTickRange
- `chord-detect.test.ts`: detectChordInRange
- `transform.test.ts`: adaptToChord (transposition, NCT quantization, edge cases)

---

## Implementation Order

### Phase 1 — Lib layer (all pure functions + tests)
1. piano-roll.ts: xToTick, snapTickToBeat, getNotesInTickRange
2. chord-detect.ts: detectChordInRange
3. Tests for above
4. chord-parse.ts (new file): parseChordSymbol
5. Tests for chord-parse
6. transform.ts: adaptToChord
7. Tests for adaptToChord
8. Run full test suite

### Phase 2 — Range Selection UI
9. types/clip.ts: RangeSelection interface
10. PianoRoll.tsx: mouse handlers + selection overlay + Escape
11. StatsGrid.tsx: rangeSelection prop + display logic
12. ClipDetail.tsx: pass through props
13. MidiCurator.tsx: rangeSelection state
14. App.css: cursor style

### Phase 3 — Chord Adaptation UI
15. TransformControls.tsx: chord adaptation section
16. ClipDetail.tsx: pass through chord adaptation props
17. MidiCurator.tsx: targetChord state + handleAdaptChord
18. App.css: chord adaptation styles

---

## Files Summary

| File | Action |
|------|--------|
| `src/lib/piano-roll.ts` | Modify — add xToTick, snapTickToBeat, getNotesInTickRange |
| `src/lib/chord-detect.ts` | Modify — add detectChordInRange |
| `src/lib/chord-parse.ts` | **Create** — chord symbol parser |
| `src/lib/transform.ts` | Modify — add adaptToChord |
| `src/types/clip.ts` | Modify — add RangeSelection |
| `src/components/PianoRoll.tsx` | Modify — mouse events, selection overlay |
| `src/components/StatsGrid.tsx` | Modify — selection chord display |
| `src/components/TransformControls.tsx` | Modify — chord adaptation UI |
| `src/components/ClipDetail.tsx` | Modify — pass through new props |
| `src/components/MidiCurator.tsx` | Modify — state + callbacks for both features |
| `src/App.css` | Modify — cursor, chord adaptation styles |
| `src/lib/__tests__/chord-parse.test.ts` | **Create** — parser tests |
| `src/lib/__tests__/piano-roll.test.ts` | Modify — new function tests |
| `src/lib/__tests__/chord-detect.test.ts` | Modify — detectChordInRange tests |
| `src/lib/__tests__/transform.test.ts` | Modify — adaptToChord tests |

2 new files, 13 modified files.
