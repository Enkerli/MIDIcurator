# MIDIcurator — Roadmap & Prioritized Next Steps

*Updated 2026-02-09. Previous segmentation plan (Phases A–D) is complete.*

---

## Done (Segmentation)

All phases shipped in commit `ad2f711`:
- **Phase A**: Clip-level `Segmentation` type, MCURATOR v1 MIDI metadata
  (marker + JSON text events), round-trip import/export
- **Phase B**: Scissors tool (S key), boundary snapping, click-to-cut,
  Shift+click/right-click to remove
- **Phase C**: `detectChordsForSegments()` with sustained-note inclusion,
  segment-aware ChordBar rendering, reanalysis on every boundary change
- **Phase D**: Draggable boundaries (click-drag in scissors mode),
  sustained notes attributed to segments where they're sounding

---

## Prioritized Next Steps

### Tier 1 — Quick Wins (low effort, high value)

#### 1.1 Empty segments display "–" instead of inherited chord
**Status**: Bug fix
**Effort**: ~30 min
**Files**: `src/components/ChordBar.tsx`, possibly `src/lib/chord-detect.ts`

Empty segments (no note onsets within their range) currently show a chord
inherited via resonance. When a segment has been *explicitly created* by
the scissors tool and contains no notes, it should display "–" (empty).

The resonance principle should remain for *bar-level* detection but not
for explicitly segmented regions. The fix is likely in
`detectChordsForSegments()` — don't apply resonance when the segment has
an explicit boundary, or have ChordBar distinguish "inherited" from
"detected" chords.

#### 1.2 Keyboard navigation: arrow keys for clips & segments
**Status**: New feature
**Effort**: ~1–2h
**Files**: `src/components/MidiCurator.tsx`, `src/components/Sidebar.tsx`

- **Up/Down arrows**: navigate between clips in the sidebar list
- **Left/Right arrows** (or Tab/Shift-Tab): navigate between segments in
  the current clip (when segmentation exists)
- Follows standard list navigation conventions
- Arrows only active when no input is focused

#### 1.3 Auto-tag single-chord clips
**Status**: New feature
**Effort**: ~1–2h
**Files**: `src/components/MidiCurator.tsx` or new `src/lib/auto-tag.ts`

Heuristic: if a clip has ≤5 distinct pitch classes, tag it as
"single-chord" (or with the chord symbol itself). This enables:
- bulk filtering in the sidebar
- quick visual scan of which clips are harmonically simple
- verification workflow: group single-chord clips, user confirms labels

---

### Tier 2 — Medium Effort, High Value

#### 2.1 Dual ChordBar: "realized" + "underlying" (competence/performance)
**Status**: New feature (significant)
**Effort**: ~4–6h
**Files**: New `src/components/LeadsheetBar.tsx`, `src/types/clip.ts`,
  `src/components/ClipDetail.tsx`

Two layers of harmonic annotation:

1. **Realized** (current ChordBar): shows what's actually played, in
   MIDI-time proportional segments. Already implemented.

2. **Underlying** (new "leadsheet" bar): bar-quantized chord symbols
   entered manually, like a lead sheet. Format:
   `Fm7 | Am7 D7 | Abm7 Db7 | Bbm7 Eb7 |`

   Rules:
   - All chords within a bar have equal duration (halves if 2, thirds if 3)
   - A chord can be repeated across bars to make duration explicit
   - Input via text field or click-to-set per bar

This second layer informs:
- identification of extensions vs NCTs (non-chord tones)
- functional analysis (future: Roman numerals relative to underlying key)
- comparison between intended harmony and actual realization

#### 2.2 Enharmonic spelling by chord role
**Status**: Known issue / research
**Effort**: ~4–8h (potentially complex)
**Files**: `src/lib/chord-dictionary.ts`, `src/lib/chord-detect.ts`,
  new `src/lib/spelling.ts`

Current problem: "E♭° diminished triad" is spelled "E♭ F♯ A" — the F♯
should be G♭ (minor third, not augmented second).

This requires a spelling engine that:
- assigns note names based on **interval function within the chord**
  (root, third, fifth, seventh, etc.)
- uses flats/sharps consistently per chord context
- handles edge cases (augmented sixths, enharmonic pivot chords)

Approach:
- Each chord quality defines a **spelling template** (intervals from root
  as letter-name offsets, not just semitones)
- Root name + template → spelled note names
- Extras/NCTs spelled by nearest diatonic interpretation

**Flag**: This has been complicated in prior work. Consider phasing it
alongside the dual ChordBar (§2.1) and an external validation/testing
phase. The underlying chord layer would provide context for correct
spelling of realized notes.

---

### Tier 3 — Larger Features (high value, higher effort)

#### 3.1 Auto-segmentation hints
**Effort**: ~3–4h
Detect likely chord changes by pitch-class transitions. Display as
dimmed guide lines on the piano roll. User can accept/reject.

#### 3.2 Segment info in StatsGrid
**Effort**: ~1h
Show segment count and chord progression summary in the stats panel.

#### 3.3 Timeline zoom
**Effort**: ~3–4h
Zoom the piano roll timeline. Essential for segmentation precision with
dense patterns. See `docs/OPEN_NOTES.md §7.1`.

---

### Tier 4 — Wishlist / Future ("smidgen" territory)

#### 4.1 Chord paint tool (arp shape)
Create melodic patterns that follow chord tones: user draws a shape
(up/down, note durations quantized to grid), tool fills in pitches from
the current segment's chord. Exists in some DAWs but could be done
better.

#### 4.2 Chord roller tool (pads)
"Paint roller" that fills a segment with the full chord as a pad (all
notes sounding together for the segment duration). Opposite of
arpeggiation. Useful for quickly hearing the harmonic content.

#### 4.3 Functional harmony layer
Roman numeral analysis, T/PD/D classification, cross-key concordance.
Depends on §2.1 (underlying chord layer) and §2.2 (correct spelling).
See `docs/OPEN_NOTES.md §2`.

#### 4.4 Concordance analysis of melodic patterns
Intervallic, functional, and pitch-class concordance.
See `docs/OPEN_NOTES.md §1`.

#### 4.5 iPadOS touch support
Selection and segmentation don't work reliably on iPadOS.
See `docs/OPEN_NOTES.md §7.2`.

---

## Research Notes

### Apple Loops chord metadata
**Finding**: Apple Loops (.caf/.aiff) store **key + scale type** (Major,
Minor, Neither, Both) in the `basc` AIFF chunk (2 bytes each at offsets
0x08–0x0B), plus tempo, time signature, and beat count. There is **no
per-bar chord progression metadata** in the Apple Loops format. Logic
Pro's chord display for Apple Loops appears to be derived from real-time
analysis, not from embedded tags.

The `trns` chunk stores transient markers (sample-frame positions), and
`cate` stores categorization. None of these carry chord-level data.

Sources:
- [Reverse Engineering Apple Loops](https://apmatthews.tumblr.com/post/73069916661/reverse-engineering-apple-loops)
- [Notes for Apple Loops Developers](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/ALU_Notes/ALU%20Notes/ALU%20Notes.html)

**Implication**: MCURATOR's MIDI metadata approach (marker + JSON text
events) is already more expressive than Apple's format for chord
annotation. No need to emulate Apple Loops' metadata scheme.

---

## Design Principles (reminders)

- **Curation over production** — not a DAW
- **Analysis is assistive, not authoritative** — users override
- **Accuracy matters** — correct spellings and labels are what distinguish
  useful learning tools from offhand demos
- **Preserve meaning before optimizing mechanism**
