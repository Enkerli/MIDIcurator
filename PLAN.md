# Segmentation Implementation Plan

## Clarification: MIDI "comments"

SMF (.mid) files are binary — there's no `;` comment syntax. The `;` convention
exists in ABC notation and some MIDI text formats, but not in standard `.mid`.
The right approach (already specified in `docs/METADATA_MIDI.md`) is:
- **Marker meta events (0x06)** — visible in most DAWs as markers/cue points
- **Text meta events (0x01)** — machine-readable JSON payload

This is the standard way to embed annotations in MIDI files.

---

## Phase A — Data Model + MIDI Metadata (foundation)

**Goal**: Clip-level segmentation state persisted in IndexedDB; MIDI export
embeds MCURATOR markers; MIDI import reads them back. Independently valuable:
exported .mid files carry harmonic annotations even before the scissors tool.

### A1. Extend Clip type with segmentation state
- **File**: `src/types/clip.ts`
- Add `segmentation?: { boundaries: number[] }` to `Clip` interface
- Boundaries are absolute tick positions; segments derived as
  `[0…b1), [b1…b2), …[bn…end]`
- Optional field → backward-compatible with existing IndexedDB clips

### A2. Parse marker (0x06) and text (0x01) meta events
- **Files**: `src/types/midi.ts`, `src/lib/midi-parser.ts`
- Add `'marker' | 'text'` to `MidiEvent.type` union
- Add `text?: string` field to `MidiEvent`
- In `parseTrack()`, decode metaType 0x01 and 0x06 as UTF-8 text
- Add `extractMcuratorSegments(midiData)` — scan for `MCURATOR v1 SEG`
  markers, return `{ boundaries, segmentChords }`

### A3. Write MCURATOR metadata in MIDI export
- **File**: `src/lib/midi-export.ts`
- Helper: `encodeTextMeta(type: 0x01 | 0x06, text: string): number[]`
- At tick 0: write file-level `MCURATOR:v1 { "type":"file", ... }` text event
- For each segment boundary: write marker + text JSON at the segment's tick
- Modify `createMIDITrack()` to accept optional segmentation + barChords
- Interleave metadata events with note events via tick sort

### A4. Tests
- Round-trip: create MIDI with segments → parse → extract → match
- Marker-only and JSON-only parsing
- Unknown fields don't break parsing
- Variable-length text encoding edge cases

**Commit point**: "Add MCURATOR metadata to MIDI export/import"

---

## Phase B — Scissors Tool (interaction)

**Goal**: Users can place and see segmentation boundaries on the piano roll.
Chord labels update immediately.

### B1. Segmentation mode toggle
- **Files**: `src/components/MidiCurator.tsx`, `src/components/ClipDetail.tsx`
- New state: `scissorsMode: boolean`
- Toggle button near piano roll (✂ icon)
- Keyboard shortcut: `S` to toggle
- When active, PianoRoll switches from drag-select to click-to-cut

### B2. PianoRoll scissors interaction
- **File**: `src/components/PianoRoll.tsx`
- New props: `scissorsMode`, `boundaries`, `onBoundaryAdd`
- **Hover guide line**: in scissors mode, mousemove draws a vertical dashed
  line at the snapped tick position
- **Click to cut**: mousedown in scissors mode calls `onBoundaryAdd(tick)`
- **Render boundaries**: existing boundaries as colored dashed vertical lines
  (orange, distinct from bar grid)

### B3. Boundary snapping (note-content-focused)
- **File**: `src/lib/piano-roll.ts`
- New function: `snapForScissors(rawTick, onsets, durations, ticksPerBeat)`
- Priority order:
  1. Note onset within tolerance (half a beat)
  2. Note end within tolerance
  3. Beat grid (if no notes nearby)
- Shift key disables snapping entirely
- Never snap more than 1 beat away from click position

### B4. Boundary management in state
- **File**: `src/components/MidiCurator.tsx`
- `addBoundary(tick)`: insert into sorted array, deduplicate
- `removeBoundary(tick)`: remove (right-click or Shift+click on existing)
- Persist to clip in IndexedDB on change
- Trigger reanalysis pipeline

### B5. Segment-aware ChordBar rendering
- **File**: `src/components/ChordBar.tsx`
- When segmentation boundaries exist, render segment-based labels
  instead of bar-based labels
- Each segment shows its detected chord, proportional width
- Boundary separators visible

**Commit point**: "Scissors tool: place and render segmentation boundaries"

---

## Phase C — Segment-Aware Chord Detection (analysis)

**Goal**: When boundaries exist, chord detection uses segments instead of bars.

### C1. detectChordsForSegments()
- **File**: `src/lib/chord-detect.ts`
- New function: given notes, onsets, durations, and boundary ticks →
  per-segment chord results
- Each segment: collect notes whose onset is in [segStart, segEnd)
- Apply merge-first strategy per segment
- Notes sustaining across boundaries: attribute to onset segment

### C2. Reanalysis pipeline
- **File**: `src/components/MidiCurator.tsx`
- When `clip.segmentation?.boundaries` exists:
  - Use `detectChordsForSegments()` instead of `detectChordsPerBar()`
  - Store results alongside segmentation state
  - Update harmonic display

### C3. Segment info in StatsGrid
- **File**: `src/components/StatsGrid.tsx`
- Show segment count and progression summary

### C4. Tests
- Segment detection with notes spanning boundaries
- Sparse clips, boundary at exact note onset
- Boundary between notes in same chord block

**Commit point**: "Segment-aware chord detection pipeline"

---

## Phase D — Polish & Edge Cases

### D1. Movable boundaries (drag to reposition)
- In scissors mode, clicking near an existing boundary initiates a drag
- Visual feedback during drag, reanalyze on release

### D2. Notes held across boundaries
- Option: include sustained notes in both segments with lower weight
- Or: pitch class attributed to both segments
- Configurable heuristic

### D3. Auto-segmentation hint (future)
- Detect likely chord changes by pitch class transitions
- Suggest boundaries as dimmed guide lines

**Commit point**: "Segmentation polish: movable boundaries, sustain handling"

---

## Phasing & Estimates

| Phase | Effort | Dependencies | Independently valuable? |
|-------|--------|-------------|------------------------|
| A     | ~2-3h  | None        | Yes — MIDI metadata     |
| B     | ~3-4h  | A1          | Yes — visual boundaries |
| C     | ~2-3h  | B           | Yes — smarter analysis  |
| D     | ~2h    | C           | Polish                  |

A2/A3 (MIDI metadata) and B2/B3 (scissors UI) can be developed in parallel.
Each phase produces a pushable commit.
