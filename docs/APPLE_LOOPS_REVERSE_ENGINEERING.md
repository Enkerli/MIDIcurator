# Apple Loops (AIFF/C AF) reverse‑engineering notes (work in progress)

This document summarizes what we currently know (and what is still uncertain) about **Apple Loops musical metadata**
embedded in loop audio files, with a focus on **chord sequences**.

It’s written for other reverse‑engineers: enough structure to reproduce results, with clear “known vs inferred”.

---

## Scope

- Containers:
  - **AIFF/AIFC** (`.aif`, `.aiff`) for user‑generated loops and some exports
  - **CAF** (`.caf`) for many first‑party Apple Loops
- Embedded musical metadata:
  - Embedded **SMF MIDI** (when present)
  - **Chord timeline** (the `Sequ` payload and “chord events” of type `103`)
- Out of scope (for now):
  - Pattern loops / Session Player loops (different formats/encodings)
  - Full reconstruction of Apple’s v11 loop database schema (covered elsewhere)

---

## 1) High‑level structure

### 1.1 AIFF is an IFF container

An `.aif/.aiff` file is an IFF/RIFF‑like container:

- `FORM` header
- Repeated **chunks**:
  - `chunk_id` (4 bytes ASCII)
  - `chunk_size` (u32 big‑endian)
  - `chunk_data` (`chunk_size` bytes)
  - Optional pad byte to align to even sizes

Common audio chunks (`COMM`, `SSND`, etc.) exist as usual.

Apple Loops metadata appears in one or more `APPL` chunks.

### 1.2 Apple Loops metadata is nested inside `APPL`

Inside `APPL` chunk payloads we observe a **second IFF‑like subchunk layer**:

- `subchunk_id` (4 bytes ASCII)
- `subchunk_size` (u32 big‑endian)
- `subchunk_data`
- Optional pad byte

Among these, a `Sequ` subchunk has been empirically linked to chord sequences.

> **Practical takeaway:** You can parse the AIFF’s top‑level chunks, then recursively parse IFF‑style subchunks inside
> each `APPL` payload, and look for `Sequ`.

---

## 2) The `Sequ` payload and chord events

### 2.1 “Chord events” are found by scanning for event type `103`

A `Sequ` payload appears to contain a stream of fixed‑size “events”.
Rather than fully decoding the (still‑unknown) surrounding structure, we reliably locate chord events by scanning the
payload for records where:

- `type == 103` (u16 big‑endian at offset `+0x00` of the event record)

This scanning approach is robust enough for validation and extraction.

### 2.2 Event record layout (30 bytes)

For an event starting at some offset `off` within `Sequ` payload, the fields are:

| Field | Offset | Size | Type | Notes |
|---|---:|---:|---|---|
| `type` | `+0x00` | 2 | u16 BE | chord events use `103` |
| `w1` | `+0x02` | 2 | u16 BE | unknown |
| `mask` | `+0x04` | 2 | u16 BE | pitch‑class bitmask (12 bits) |
| `w3` | `+0x06` | 2 | u16 BE | unknown (often `0x0f07`) |
| `b8` | `+0x08` | 1 | u8 | unknown (varies) |
| `b9` | `+0x09` | 1 | u8 | unknown (varies) |
| `x10` | `+0x0a` | 2 | u16 BE | unknown (often `0xb200`) |
| `x12` | `+0x0c` | 2 | u16 BE | unknown (often `0x0000`) |
| `be14` | `+0x0e` | 4 | u32 BE | unknown; stable around `0x000080xx` in many files |
| `be18` | `+0x12` | 4 | u32 BE | unknown; large values; likely a time/value in fixed‑point |
| `be22` | `+0x16` | 4 | u32 BE | **time‑within‑bar encoding** (see below) |
| `be26` | `+0x1a` | 4 | u32 BE | unknown; often `0` but not always |

**Total:** 30 bytes.

### 2.3 `mask` → chord pitch‑class intervals

`mask` is interpreted as a 12‑bit set over semitones above an implicit root:

- bit 0 → interval 0 (root)
- bit 1 → interval 1 (♭2)
- …
- bit 11 → interval 11 (maj7)

Example:

- `mask = 0b100010010001` → intervals `[0, 4, 7, 11]` → a maj7 “shape” (root unspecified)

This yields a **pitch‑class set relative to the chord root**, but **does not directly reveal the absolute root pitch
class** (that likely lives elsewhere, or is implied by other metadata we haven’t pinned down yet).

### 2.4 `be22` → event position within the bar (empirical)

`be22` behaves like a **16.16 fixed‑point** value whose low 16 bits provide a usable normalized number:

- `norm = (be22 & 0xFFFFFFFF) / 65536.0`

Empirically, a good mapping from `norm` to **event time (in beats within a bar)** is:

- `pos_beats = (1.0 - norm) * beats_per_bar`
- `pos_beats = pos_beats % beats_per_bar` (wrap, so near‑end values represent ~0)

This matches observed edits:

- a chord at bar start often yields `pos_beats ≈ beats_per_bar - ε`, which wraps to ~0
- a chord change at “beat 3.25” in 4/4 (1‑based beat count) corresponds to ~`pos_beats ≈ 2.25` (0‑based)

**Precision:** because `norm` is quantized by 16‑bit fractional steps, expect tiny rounding errors (often ~0.01 beats).

---

## 3) What we can extract today (reliably)

From a compatible `.aif` we can reliably extract:

- One or more `Sequ` payloads (nested inside `APPL`)
- A list of chord events (`type=103`)
- For each event:
  - `mask` → interval set (pitch‑class set relative to root)
  - `be22` → event position within bar (given `beats_per_bar`)
  - Additional unknown fields (`b8`, `b9`, `be14`, `be18`, etc.) that may become useful later

This is enough to print a usable **chord timeline** for validation and for downstream tooling.

---

## 4) Open questions / unknowns (explicit)

- How to derive **absolute chord roots** (not just interval sets):
  - do `b8`/`b9` encode root? (not yet proven)
  - is root stored elsewhere in `Sequ` or other subchunks?
- What do `be14`, `be18`, and `be26` represent?
  - timebase? tempo? absolute ticks? bar/region offsets?
- How to interpret multiple `Sequ` payloads in one file:
  - layers? regions? alternatives? multiple chord tracks?

---

## 5) Reference implementation approach (recommended)

A practical extractor can:

1. Parse top‑level AIFF chunks; collect `APPL` payloads
2. Parse nested IFF‑style subchunks inside each `APPL` payload
3. Collect `Sequ` subchunk payloads
4. Scan each `Sequ` payload for 30‑byte records whose `type==103`
5. For each event:
   - decode `mask` → intervals
   - decode `be22` → position within bar (with configurable `beats_per_bar`)
6. Sort events by position and print the timeline

A single‑file Python script implementing this exists alongside this document.

---

## 6) Planned roadmap (context)

The immediate next steps (beyond this doc) typically look like:

1. Print chord sequence from compatible `.aif` (user‑generated) ✅
2. Do the same for `.caf` (first‑party loops)
3. Index all Apple Loops with chord metadata (`hasChords`)
4. Rebuild a loop database including chord info
5. Extract embedded `.mid` SMF and rename based on loop filename
6. Embed global metadata into extracted MIDI files (MIDIcurator scheme)
7. Embed chord metadata into MIDI at correct positions
8. Run at scale across the whole loop library
9. Document the full project end‑to‑end

---

## License / attribution

This is reverse‑engineering documentation produced from empirical tests and does not contain Apple proprietary code.
If you publish derivatives, keep the “known vs inferred” separation clear to avoid propagating incorrect assumptions.
