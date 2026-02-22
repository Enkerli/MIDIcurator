import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { Clip, DetectedChord, Leadsheet, Segmentation, SegmentChordInfo, LoopMeta } from '../types/clip';
import { useDatabase } from '../hooks/useDatabase';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { usePlayback } from '../hooks/usePlayback';
import { parseMIDI, extractNotes, extractBPM, extractTimeSignature, extractMcuratorSegments } from '../lib/midi-parser';
import { isAppleLoopFile, parseAppleLoop, formatChordTimeline, enrichChordEventsWithMidiRoots, appleLoopEventsToLeadsheet } from '../lib/apple-loops-parser';
import { extractGesture, extractHarmonic, toDetectedChord } from '../lib/gesture';
import { transformGesture } from '../lib/transform';
import { downloadMIDI, downloadAllAsZip, downloadVariantsAsZip } from '../lib/midi-export';
import { getNotesInTickRange, detectChordBlocks, segmentFromLeadsheet } from '../lib/piano-roll';
import type { TickRange } from '../lib/piano-roll';
import { detectChord, detectChordsForSegments } from '../lib/chord-detect';
import { spliceSegment, isTrivialSegments, removeRestSegments } from '../lib/chord-segments';
import { substituteSegmentPitches } from '../lib/chord-substitute';
import { parseLeadsheet } from '../lib/leadsheet-parser';
import { loadLoopDb, lookupLoopMeta, getLoadedDbFileName, keyTypeLabel, rootPcName } from '../lib/loop-database';
import { PROGRESSIONS, transposeProgression } from '../lib/progressions';
import type { VoicingShape } from '../lib/progressions';
import { generateProgressionClip } from '../lib/generate-clip';
import { Sidebar } from './Sidebar';
import { ClipDetail } from './ClipDetail';
import { KeyboardShortcutsBar } from './KeyboardShortcutsBar';

/**
 * Derive a Segmentation from a leadsheet + gesture, snapping chord boundaries
 * to nearby note events. Returns undefined if the leadsheet yields no internal
 * boundaries (e.g. a single-chord leadsheet with no chord changes).
 * Module-level so it can be called before React hooks are initialised (e.g. at import time).
 */
function computeSegmentationFromLeadsheet(
  gesture: Clip['gesture'],
  harmonic: Clip['harmonic'],
  leadsheet: Leadsheet,
): Segmentation | undefined {
  const { onsets, durations, ticks_per_bar, ticks_per_beat, num_bars } = gesture;
  const totalTicks = num_bars * ticks_per_bar;
  const boundaries = segmentFromLeadsheet(leadsheet, ticks_per_bar, ticks_per_beat, totalTicks, onsets, durations);
  if (boundaries.length === 0) return undefined;
  const segResults = detectChordsForSegments(harmonic.pitches, onsets, durations, boundaries, totalTicks);
  const segmentChords: SegmentChordInfo[] = segResults.map(sr => ({
    index: sr.index,
    startTick: sr.startTick,
    endTick: sr.endTick,
    chord: toDetectedChord(sr.chord),
    pitchClasses: sr.pitchClasses,
  }));
  return { boundaries, segmentChords };
}

export function MidiCurator() {
  const { db, clips, tagIndex, refreshClips } = useDatabase();
  const { playbackState, currentTime, play, pause, stop, toggle } = usePlayback();
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState('');
  const [newTag, setNewTag] = useState('');
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmValue, setBpmValue] = useState('');
  const [densityMultiplier, setDensityMultiplier] = useState(1.0);
  const [selectionRange, setSelectionRange] = useState<TickRange | null>(null);
  const [scissorsMode, setScissorsMode] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [loopDbFileName, setLoopDbFileName] = useState<string | null>(null);
  const [loopDbStatus, setLoopDbStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [loopDbEnriched, setLoopDbEnriched] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectClip = useCallback(async (clip: Clip) => {
    // Stop playback when switching clips
    stop();
    setSelectedClip(clip);
    setSelectionRange(null);
    setBpmValue(clip.bpm.toString());
    setEditingBpm(false);
    if (db) {
      const clipTags = await db.getClipTags(clip.id);
      setTags(clipTags);
    }
  }, [db, stop]);

  const saveBpm = useCallback(async () => {
    if (!selectedClip || !db) return;
    const newBpm = parseInt(bpmValue);
    if (isNaN(newBpm) || newBpm < 1 || newBpm > 999) return;

    const updated = { ...selectedClip, bpm: newBpm };
    await db.updateClip(updated);
    setSelectedClip(updated);
    setEditingBpm(false);
    refreshClips();
  }, [selectedClip, db, bpmValue, refreshClips]);

  const addTag = useCallback(async () => {
    if (!selectedClip || !newTag.trim() || !db) return;
    await db.addTag(selectedClip.id, newTag.trim());
    setTags(prev => [...prev, newTag.trim()]);
    setNewTag('');
  }, [selectedClip, newTag, db]);

  const deleteClip = useCallback(async () => {
    if (!selectedClip || !db) return;
    if (confirm(`Delete "${selectedClip.filename}"?`)) {
      stop();
      await db.deleteClip(selectedClip.id);
      setSelectedClip(null);
      setTags([]);
      refreshClips();
    }
  }, [selectedClip, db, refreshClips, stop]);

  const generateVariants = useCallback(async () => {
    if (!selectedClip || !db) return;

    const densityOptions = [0.5, 0.75, 1.0, 1.25, 1.5];

    for (let i = 0; i < 5; i++) {
      const densityMult = densityOptions[i]!;
      const { gesture: transformed, harmonic: transformedHarmonic } = transformGesture(
        selectedClip.gesture,
        selectedClip.harmonic,
        { densityMultiplier: densityMult, quantizeStrength: 0.5, velocityScale: 1.0 },
      );

      const actualDensity = transformed.density.toFixed(2);

      const variant: Clip = {
        id: crypto.randomUUID(),
        filename: `${selectedClip.filename.replace('.mid', '')}_d${actualDensity}.mid`,
        imported_at: Date.now(),
        bpm: selectedClip.bpm,
        gesture: transformed,
        harmonic: transformedHarmonic,
        rating: null,
        notes: `Generated from ${selectedClip.filename} (density: ${densityMult}x, actual: ${actualDensity})`,
        source: selectedClip.id,
        sourceFilename: selectedClip.filename,
      };

      await db.addClip(variant);
    }

    refreshClips();
    setAnnouncement('Generated 5 variants with different densities');
  }, [selectedClip, db, refreshClips]);

  const generateSingleVariant = useCallback(async () => {
    if (!selectedClip || !db) return;

    const { gesture: transformed, harmonic: transformedHarmonic } = transformGesture(
      selectedClip.gesture,
      selectedClip.harmonic,
      { densityMultiplier, quantizeStrength: 0.5, velocityScale: 1.0 },
    );

    const actualDensity = transformed.density.toFixed(2);

    const variant: Clip = {
      id: crypto.randomUUID(),
      filename: `${selectedClip.filename.replace('.mid', '')}_d${actualDensity}.mid`,
      imported_at: Date.now(),
      bpm: selectedClip.bpm,
      gesture: transformed,
      harmonic: transformedHarmonic,
      rating: null,
      notes: `Generated from ${selectedClip.filename} (density: ${densityMultiplier.toFixed(2)}x, actual: ${actualDensity})`,
      source: selectedClip.id,
      sourceFilename: selectedClip.filename,
    };

    await db.addClip(variant);
    refreshClips();
    setAnnouncement(`Generated 1 variant with density ${actualDensity}`);
  }, [selectedClip, db, densityMultiplier, refreshClips]);

  /**
   * Import a single MIDI ArrayBuffer into the database.
   * Shared by direct .mid import and Apple Loops extraction.
   *
   * @param midiBuffer  Raw SMF bytes
   * @param filename    Display filename for the clip
   * @param extraTags   Additional tags to apply (e.g. "apple-loop")
   * @param extraNotes  Extra notes string for the clip
   */
  const importMidiBuffer = useCallback(async (
    midiBuffer: ArrayBuffer,
    filename: string,
    extraTags: string[] = [],
    extraNotes: string = '',
    providedLeadsheet?: Leadsheet | null,
    loopMeta?: LoopMeta,
  ) => {
    if (!db) return;

    const midiData = parseMIDI(midiBuffer);
    const notes = extractNotes(midiData);

    if (notes.length === 0) return;

    let bpm: number | null = null;
    const bpmMatch = filename.match(/(\d+)[-_\s]?bpm/i);
    if (bpmMatch) {
      bpm = parseInt(bpmMatch[1]!);
    }
    if (!bpm) {
      bpm = extractBPM(midiData);
    }

    const timeSig = extractTimeSignature(midiData);
    const gesture = extractGesture(notes, midiData.ticksPerBeat, timeSig);
    const harmonic = extractHarmonic(notes, gesture);

    // Extract MCURATOR segmentation metadata (if present)
    const mcurator = extractMcuratorSegments(midiData);
    let segmentation: Segmentation | undefined;
    if (mcurator && mcurator.boundaries.length > 0) {
      const clipEndTick = gesture.num_bars * gesture.ticks_per_bar;
      const segResults = detectChordsForSegments(
        harmonic.pitches,
        gesture.onsets,
        gesture.durations,
        mcurator.boundaries,
        clipEndTick,
      );
      const segmentChords: SegmentChordInfo[] = segResults.map(sr => ({
        index: sr.index,
        startTick: sr.startTick,
        endTick: sr.endTick,
        chord: toDetectedChord(sr.chord),
        pitchClasses: sr.pitchClasses,
      }));
      segmentation = { boundaries: mcurator.boundaries, segmentChords };
    }

    // Restore leadsheet from MCURATOR metadata, or use provided leadsheet (e.g., from Apple Loops)
    let leadsheet: Leadsheet | undefined;
    if (providedLeadsheet) {
      leadsheet = providedLeadsheet;
    } else if (mcurator?.leadsheetText) {
      leadsheet = parseLeadsheet(mcurator.leadsheetText, gesture.num_bars);
      // Restore per-chord beat timing that was serialized by the exporter.
      // parseLeadsheet gives equal-division positions; timing overrides replace those.
      if (leadsheet && mcurator.leadsheetTiming) {
        const timing = mcurator.leadsheetTiming;
        for (const bar of leadsheet.bars) {
          for (let j = 0; j < bar.chords.length; j++) {
            const entry = timing[`${bar.bar}:${j}`];
            if (entry) {
              bar.chords[j]!.beatPosition = entry[0];
              bar.chords[j]!.duration = entry[1];
            }
          }
        }
      }
    }

    const clipNotes = [mcurator?.clipNotes, extraNotes].filter(Boolean).join('; ');

    // If we have a leadsheet but no segmentation yet, auto-derive one.
    if (leadsheet && !segmentation) {
      segmentation = computeSegmentationFromLeadsheet(gesture, harmonic, leadsheet);
    }

    // Prefer live DB lookup (passed in), fall back to embedded MIDI metadata.
    const resolvedLoopMeta = loopMeta ?? mcurator?.loopMeta;

    const clip: Clip = {
      id: crypto.randomUUID(),
      filename,
      imported_at: Date.now(),
      bpm,
      gesture,
      harmonic,
      rating: null,
      notes: clipNotes,
      sourceFilename: mcurator?.variantOf,
      segmentation,
      leadsheet,
      loopMeta: resolvedLoopMeta,
    };

    await db.addClip(clip);

    // Auto-tag: clips with ≤5 distinct pitch classes likely contain
    // a single chord.  Tag with "single-chord" and the chord symbol.
    const uniquePcs = new Set(harmonic.pitchClasses);
    if (uniquePcs.size <= 5 && uniquePcs.size >= 2) {
      await db.addTag(clip.id, 'single-chord');
      if (harmonic.detectedChord?.symbol) {
        await db.addTag(clip.id, harmonic.detectedChord.symbol);
      }
    }

    // Apply extra tags (e.g. "apple-loop")
    for (const tag of extraTags) {
      await db.addTag(clip.id, tag);
    }
  }, [db]);

  const handleFileUpload = useCallback(async (files: File[]) => {
    if (!db) return;

    for (const file of files) {
      try {
        // ── Apple Loops files (.aif, .aiff, .caf) ──────────────────
        if (isAppleLoopFile(file.name)) {
          const arrayBuffer = await file.arrayBuffer();
          const result = parseAppleLoop(arrayBuffer);

          if (!result.midi) {
            console.warn('Apple Loop has no embedded MIDI:', file.name);
            continue;
          }

          // Parse MIDI to get notes and determine number of bars
          const midiData = parseMIDI(result.midi);
          const midiNotes = extractNotes(midiData);
          const timeSig = extractTimeSignature(midiData);
          const tempGesture = extractGesture(midiNotes, midiData.ticksPerBeat, timeSig);
          // Prefer numberOfBeats from basc chunk (exact loop length) over MIDI note content,
          // which may be shorter than the declared loop if the last bar has sparse notes.
          const numBars = result.numberOfBeats
            ? Math.round(result.numberOfBeats / result.beatsPerBar)
            : tempGesture.num_bars;

          // Enrich chord events with roots inferred from MIDI (for b8=15 case)
          let chordEvents = result.chordEvents;
          if (chordEvents.some(e => e.accidentalHint !== undefined)) {
            chordEvents = enrichChordEventsWithMidiRoots(chordEvents, midiNotes as any);
          }

          // Build a .mid filename from the loop filename
          const baseName = file.name.replace(/\.(aif|aiff|caf)$/i, '');
          const midiFilename = `${baseName}.mid`;

          // Build extra notes with chord timeline (if chord events found)
          let extraNotes = `Source: Apple Loop (${result.format.toUpperCase()})`;
          if (chordEvents.length > 0) {
            extraNotes += ` | Chords: ${formatChordTimeline(chordEvents)}`;
          }

          // Convert chord events to leadsheet structure
          const leadsheet = appleLoopEventsToLeadsheet(chordEvents, numBars, result.beatsPerBar);


          const loopMeta = lookupLoopMeta(file.name);
          await importMidiBuffer(result.midi, midiFilename, ['apple-loop'], extraNotes, leadsheet, loopMeta);
          continue;
        }

        // ── Standard MIDI files (.mid) ──────────────────────────────
        if (!file.name.match(/\.midi?$/i)) continue;

        const arrayBuffer = await file.arrayBuffer();
        await importMidiBuffer(arrayBuffer, file.name);
      } catch (error) {
        console.error('Error importing', file.name, error);
      }
    }

    refreshClips();
  }, [db, refreshClips, importMidiBuffer]);

  const clearAllClips = useCallback(async () => {
    if (!db) return;
    if (confirm('Clear all clips? This will remove everything from the database.')) {
      stop();
      setSelectedClip(null);
      setTags([]);
      await db.clearAllClips();
      refreshClips();
    }
  }, [db, refreshClips, stop]);

  const handleDownloadCurrent = useCallback(() => {
    if (!selectedClip) return;
    downloadMIDI(selectedClip);
  }, [selectedClip]);

  const handleDownloadVariantsZip = useCallback(() => {
    if (!selectedClip) return;
    const variants = clips.filter(c => c.source === selectedClip.id);
    if (variants.length > 0) {
      downloadVariantsAsZip(variants, selectedClip.filename);
    } else {
      alert('No variants found for this clip');
    }
  }, [selectedClip, clips]);

  // ─── Range selection chord detection ──────────────────────────────

  const rangeChordInfo = useMemo(() => {
    if (!selectionRange || !selectedClip) return null;

    const indices = getNotesInTickRange(
      selectedClip.gesture.onsets,
      selectedClip.gesture.durations,
      selectionRange.startTick,
      selectionRange.endTick,
    );

    if (indices.length === 0) return null;

    // Detect chord blocks (notes that start and end together)
    const blocks = detectChordBlocks(
      indices,
      selectedClip.gesture.onsets,
      selectedClip.gesture.durations,
    );

    // Get pitch classes for each block and detect chords
    const ticksPerBeat = selectedClip.gesture.ticks_per_beat || 480;
    const ticksPerBar = selectedClip.gesture.ticks_per_bar;

    const blockInfo = blocks.map(b => {
      const pitches = b.noteIndices.map(i => selectedClip.harmonic.pitches[i]!);
      const pcs = [...new Set(pitches.map(p => ((p % 12) + 12) % 12))].sort((a, b) => a - b);
      const chord = detectChord(pitches);

      // Calculate beat position within bar for scoring
      const barStart = Math.floor(b.startTick / ticksPerBar) * ticksPerBar;
      const localTick = b.startTick - barStart;
      const beat = Math.floor(localTick / ticksPerBeat);

      // Score: prefer more notes, strong beats (1 and 4), simple triads
      const noteCountScore = b.noteIndices.length * 10;
      const beatBonus = (beat === 0 || beat === 3) ? 5 : 0;
      const simpleTriadBonus = chord && ['maj', 'min', '5'].includes(chord.quality.key) ? 3 : 0;
      const score = noteCountScore + beatBonus + simpleTriadBonus;

      return { pitches, pcs, pcsKey: pcs.join(','), chord, score };
    });

    // Strategy: merge all block pitches first — within a selection,
    // arpeggiated/broken patterns collectively spell one harmony.
    const allPitches = blockInfo.flatMap(b => b.pitches);
    let match = detectChord(allPitches);

    if (!match) {
      // Merged set too dense / unrecognizable — fall back to best single block
      const best = blockInfo.reduce((a, b) => b.score > a.score ? b : a);
      match = detectChord(best.pitches);
    }

    const pitchClasses = [...new Set(allPitches.map(p => ((p % 12) + 12) % 12))];

    const chord: DetectedChord | null = match
      ? {
          root: match.root,
          rootName: match.rootName,
          qualityKey: match.quality.key,
          symbol: match.symbol,
          qualityName: match.quality.fullName,
          observedPcs: match.observedPcs,
          templatePcs: match.templatePcs,
          extras: match.extras,
          missing: match.missing,
          bassPc: match.bassPc,
          bassName: match.bassName,
        }
      : null;

    return { chord, pitchClasses, noteCount: indices.length };
  }, [selectionRange, selectedClip]);

  const handleOverrideBarChords = useCallback(async () => {
    if (!selectedClip || !db || !selectionRange || !rangeChordInfo?.chord) return;

    const { ticks_per_bar } = selectedClip.gesture;
    const startBar = Math.floor(selectionRange.startTick / ticks_per_bar);
    const endBar = Math.floor((selectionRange.endTick - 1) / ticks_per_bar);

    const existingBarChords = selectedClip.harmonic.barChords ?? [];
    const updatedBarChords = existingBarChords.map((bc) => {
      // Skip bars outside the selection range
      if (bc.bar < startBar || bc.bar > endBar) return bc;

      // Calculate bar-relative tick positions
      const barStartTick = bc.bar * ticks_per_bar;
      const localStart = Math.max(0, selectionRange.startTick - barStartTick);
      const localEnd = Math.min(ticks_per_bar, selectionRange.endTick - barStartTick);

      // Whole bar override? Set chord directly, clear segments
      if (localStart === 0 && localEnd === ticks_per_bar) {
        return { ...bc, chord: rangeChordInfo.chord, segments: undefined };
      }

      // Sub-bar override: splice into segments
      const splicedSegments = spliceSegment(
        bc.segments,
        bc.chord,
        ticks_per_bar,
        localStart,
        localEnd,
        rangeChordInfo.chord,
      );

      // Remove segments that cover rests (no notes) - rests carry no chord info
      const newSegments = removeRestSegments(
        splicedSegments,
        barStartTick,
        selectedClip.gesture.onsets,
        selectedClip.gesture.durations,
      );

      // If result is trivial (single full-bar segment), simplify to chord field
      if (isTrivialSegments(newSegments, ticks_per_bar)) {
        return { ...bc, chord: newSegments[0]?.chord ?? null, segments: undefined };
      }

      // If no segments left (all were rests), keep the bar's detected chord
      if (newSegments.length === 0) {
        return bc;
      }

      return { ...bc, segments: newSegments };
    });

    const updated: Clip = {
      ...selectedClip,
      harmonic: { ...selectedClip.harmonic, barChords: updatedBarChords },
    };

    await db.updateClip(updated);
    setSelectedClip(updated);
    refreshClips();
  }, [selectedClip, db, selectionRange, rangeChordInfo, refreshClips]);

  // ─── Chord substitution (adapt notes to new chord) ─────────────────
  const handleAdaptChord = useCallback(async (newChord: DetectedChord) => {
    if (!selectedClip || !db || !selectionRange) return;

    // 1. Substitute pitches in the selected range
    const newPitches = substituteSegmentPitches(
      selectedClip.harmonic.pitches,
      selectedClip.gesture.onsets,
      selectionRange.startTick,
      selectionRange.endTick,
      newChord,
    );

    // 2. Re-extract harmonic info with the new pitches
    const updatedHarmonic = extractHarmonic(
      selectedClip.gesture.onsets.map((onset, i) => ({
        midi: newPitches[i]!,
        velocity: selectedClip.gesture.velocities[i]!,
        ticks: onset,
        durationTicks: selectedClip.gesture.durations[i]!,
      })),
      selectedClip.gesture,
    );

    // 3. Merge old segments with new harmonic data, then update the adapted segment
    const { ticks_per_bar } = selectedClip.gesture;
    const startBar = Math.floor(selectionRange.startTick / ticks_per_bar);
    const endBar = Math.floor((selectionRange.endTick - 1) / ticks_per_bar);

    // IMPORTANT: extractHarmonic creates fresh barChords with NO segments.
    // We need to preserve existing user-defined segments from the old clip.
    const existingBarChords = selectedClip.harmonic.barChords ?? [];

    const updatedBarChords = updatedHarmonic.barChords?.map((newBc) => {
      // Find the OLD bar that may have user-defined segments
      const oldBc = existingBarChords.find((bc) => bc.bar === newBc.bar);

      // Calculate bar-relative tick positions
      const barStartTick = newBc.bar * ticks_per_bar;
      const localStart = Math.max(0, selectionRange.startTick - barStartTick);
      const localEnd = Math.min(ticks_per_bar, selectionRange.endTick - barStartTick);

      // For bars outside the adapted range, preserve old segments entirely
      if (newBc.bar < startBar || newBc.bar > endBar) {
        return { ...newBc, segments: oldBc?.segments };
      }

      // Whole bar: set chord directly, clear segments
      if (localStart === 0 && localEnd === ticks_per_bar) {
        return { ...newBc, chord: newChord, segments: undefined };
      }

      // Sub-bar: splice the new chord into OLD segments (not the empty newBc.segments!)
      const splicedSegments = spliceSegment(
        oldBc?.segments,
        oldBc?.chord ?? newBc.chord,
        ticks_per_bar,
        localStart,
        localEnd,
        newChord,
      );

      // Remove segments covering rests (no notes)
      const newSegments = removeRestSegments(
        splicedSegments,
        barStartTick,
        selectedClip.gesture.onsets,
        selectedClip.gesture.durations,
      );

      // If result is trivial (single full-bar segment), simplify to chord field
      if (isTrivialSegments(newSegments, ticks_per_bar)) {
        return { ...newBc, chord: newSegments[0]?.chord ?? null, segments: undefined };
      }

      // If no segments left (all were rests), keep the bar's auto-detected chord
      if (newSegments.length === 0) {
        return newBc;
      }

      return { ...newBc, segments: newSegments };
    });

    const updated: Clip = {
      ...selectedClip,
      harmonic: { ...updatedHarmonic, barChords: updatedBarChords },
    };

    await db.updateClip(updated);
    setSelectedClip(updated);
    setSelectionRange(null); // Clear selection after adapting
    refreshClips();
  }, [selectedClip, db, selectionRange, refreshClips]);

  // ─── Leadsheet (underlying chords) ──────────────────────────────
  const handleLeadsheetChange = useCallback(async (inputText: string) => {
    if (!selectedClip || !db) return;
    if (inputText === '') {
      // Clear leadsheet
      const updated: Clip = { ...selectedClip, leadsheet: undefined };
      await db.updateClip(updated);
      setSelectedClip(updated);
      refreshClips();
      return;
    }
    const leadsheet = parseLeadsheet(inputText, selectedClip.gesture.num_bars);
    // Auto-segment from the new leadsheet (replaces any prior leadsheet-derived boundaries).
    // Manually-placed boundaries that differ from the leadsheet are also replaced — the
    // assumption is that typing a new leadsheet means you want a fresh segmentation.
    const segmentation = computeSegmentationFromLeadsheet(selectedClip.gesture, selectedClip.harmonic, leadsheet);
    const updated: Clip = { ...selectedClip, leadsheet, segmentation };
    await db.updateClip(updated);
    setSelectedClip(updated);
    refreshClips();
  }, [selectedClip, db, refreshClips]);

  /**
   * Handle a drag on a chord boundary divider in LeadsheetBar.
   * Updates the beatPosition/duration of the chords on either side of the boundary
   * directly on the Leadsheet object (bypassing text serialization to preserve beat timing).
   *
   * @param barIndex       0-based bar index
   * @param boundaryIndex  0-based divider index (boundary between chord[n] and chord[n+1])
   * @param newBeatPosition new beat-position of chord[n+1] within the bar
   */
  const handleLeadsheetBoundaryMove = useCallback(async (
    barIndex: number,
    boundaryIndex: number,
    newBeatPosition: number,
  ) => {
    if (!selectedClip?.leadsheet || !db) return;

    const tpb = selectedClip.gesture.ticks_per_beat;
    const tpBar = selectedClip.gesture.ticks_per_bar;
    const beatsPerBar = tpBar / tpb;

    // Deep-clone the leadsheet bars so we don't mutate state
    const newBars = selectedClip.leadsheet.bars.map(bar => ({
      ...bar,
      chords: bar.chords.map(c => ({ ...c })),
    }));

    const bar = newBars.find(b => b.bar === barIndex);
    if (!bar) return;

    const chords = bar.chords;
    const leftChord = chords[boundaryIndex];
    const rightChord = chords[boundaryIndex + 1];
    if (!leftChord || !rightChord) return;

    // Determine the start of leftChord (beats from bar start)
    const leftStart = leftChord.beatPosition !== undefined
      ? leftChord.beatPosition
      : (boundaryIndex / chords.length) * beatsPerBar;

    // Determine the end of rightChord (beats from bar start)
    const rightEnd = rightChord.beatPosition !== undefined && rightChord.duration !== undefined
      ? rightChord.beatPosition + rightChord.duration
      : ((boundaryIndex + 2) / chords.length) * beatsPerBar;

    // Update left chord: keep its start, new duration up to the new boundary
    leftChord.beatPosition = leftStart;
    leftChord.duration = newBeatPosition - leftStart;

    // Update right chord: new start at boundary, keep its end
    rightChord.beatPosition = newBeatPosition;
    rightChord.duration = rightEnd - newBeatPosition;

    // Also initialise any chords in the bar that don't yet have explicit timing
    // (This happens the first time the user drags, when chords were equal-divided)
    for (let k = 0; k < chords.length; k++) {
      const c = chords[k]!;
      if (c.beatPosition === undefined) {
        c.beatPosition = (k / chords.length) * beatsPerBar;
        c.duration = beatsPerBar / chords.length;
      }
    }

    const updatedLeadsheet: Leadsheet = {
      ...selectedClip.leadsheet,
      bars: newBars,
    };
    const updated: Clip = { ...selectedClip, leadsheet: updatedLeadsheet };
    await db.updateClip(updated);
    setSelectedClip(updated);
    // No refreshClips() — no need to re-parse, and avoids re-render flicker during drag
  }, [selectedClip, db]);

  const [loadingSamples, setLoadingSamples] = useState(false);

  const handleLoadSamples = useCallback(async () => {
    if (!db || loadingSamples) return;
    setLoadingSamples(true);
    try {
      const base = import.meta.env.BASE_URL;
      const res = await fetch(`${base}samples/manifest.json`);
      if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
      const manifest: Array<{ filename: string }> = await res.json();

      for (const entry of manifest) {
        const midiRes = await fetch(`${base}samples/${entry.filename}`);
        if (!midiRes.ok) continue;
        const arrayBuffer = await midiRes.arrayBuffer();
        // Create a File object so the existing pipeline can handle it
        const file = new File([arrayBuffer], entry.filename, { type: 'audio/midi' });
        await handleFileUpload([file]);
      }
    } catch (error) {
      console.error('Error loading samples:', error);
    } finally {
      setLoadingSamples(false);
    }
  }, [db, loadingSamples, handleFileUpload]);

  const handleLoadLoopDb = useCallback(async (file: File) => {
    if (!db) return;
    setLoopDbStatus('loading');
    try {
      const buffer = await file.arrayBuffer();
      await loadLoopDb(buffer, file.name);
      setLoopDbFileName(getLoadedDbFileName());

      // Back-fill: enrich existing apple-loop clips that have no loopMeta yet.
      // The lookup uses the clip filename (e.g. "Something.mid") which
      // lookupLoopMeta converts to "Something.caf" for the DB match.
      const allClips = await db.getAllClips();
      let enriched = 0;
      for (const clip of allClips) {
        if (clip.loopMeta) continue;           // already has metadata
        const meta = lookupLoopMeta(clip.filename);
        if (!meta) continue;
        await db.updateClip({ ...clip, loopMeta: meta });
        enriched++;
      }
      setLoopDbEnriched(enriched);
      if (enriched > 0) refreshClips();
      setLoopDbStatus('ok');
    } catch (err) {
      console.error('Failed to load loop database:', err);
      setLoopDbStatus('error');
    }
  }, [db, refreshClips]);

  const handleGenerateProgression = useCallback(async (
    progressionIndex: number,
    keyOffset: number,
    voicing: VoicingShape,
  ) => {
    if (!db) return;

    const baseProg = PROGRESSIONS[progressionIndex];
    if (!baseProg) return;

    const prog = transposeProgression(baseProg, keyOffset);
    const { notes, leadsheetText, filename, ppq } = generateProgressionClip(prog, voicing, 120);

    if (notes.length === 0) return;

    const gesture = extractGesture(notes, ppq);
    const harmonic = extractHarmonic(notes, gesture);
    const leadsheet = parseLeadsheet(leadsheetText, gesture.num_bars);

    const clip: Clip = {
      id: crypto.randomUUID(),
      filename,
      imported_at: Date.now(),
      bpm: 120,
      gesture,
      harmonic,
      rating: null,
      notes: '',
      leadsheet,
    };

    await db.addClip(clip);
    refreshClips();
    selectClip(clip);
  }, [db, refreshClips, selectClip]);

  const filteredClips = useMemo(() => {
    if (!filterTag) return clips;
    // Field-scoped filter: "field:value" emitted by metadata chip clicks
    const fieldMatch = filterTag.match(/^(\w+):(.+)$/);
    if (fieldMatch) {
      const [, field, val] = fieldMatch;
      const q = val.toLowerCase();

      // Special problem filters for QA / triage
      if (field === 'problem') {
        if (q === 'metadata') {
          // Clips with no loopMeta at all, or with sparse metadata (no instrument AND no genre)
          return clips.filter(c => {
            if (!c.loopMeta) return true;
            const m = c.loopMeta;
            return !m.instrumentType && !m.genre;
          });
        }
        if (q === 'chord') {
          // Clips with at least one bar whose chord symbol contains '?' or '[' (unrecognised quality)
          return clips.filter(c => {
            const chords = c.harmonic?.barChords;
            if (!chords) return false;
            return chords.some(b => b.chord && (b.chord.symbol.includes('?') || b.chord.symbol.includes('[')));
          });
        }
        return [];
      }

      return clips.filter(c => {
        const m = c.loopMeta;
        if (!m) return false;
        switch (field) {
          case 'instrument':
            return m.instrumentType.toLowerCase().includes(q) ||
                   m.instrumentSubType.toLowerCase().includes(q);
          case 'genre':
            return m.genre.toLowerCase().includes(q);
          case 'key':
            return `${rootPcName(m.rootPc)} ${keyTypeLabel(m.keyType)}`.toLowerCase().includes(q);
          case 'looptype':
            return String(m.gbLoopType) === q;
          case 'descriptor':
            return m.descriptors.split(',').some(d => d.trim().toLowerCase().includes(q));
          case 'collection':
            return (m.collection ?? '').toLowerCase().includes(q);
          case 'jampak':
            return (m.jamPack ?? '').toLowerCase().includes(q);
          default:
            return false;
        }
      });
    }
    // Free-text fallback: match filename, user tags, or any loopMeta field
    const q = filterTag.toLowerCase();
    return clips.filter(c => {
      if (c.filename.toLowerCase().includes(q)) return true;
      const clipTags = tagIndex.get(c.id);
      if (clipTags?.some(t => t.toLowerCase().includes(q))) return true;
      const m = c.loopMeta;
      if (!m) return false;
      const metaTerms = [
        m.instrumentType, m.instrumentSubType, m.genre,
        m.descriptors, m.collection, m.author, m.jamPack ?? '',
        `${rootPcName(m.rootPc)} ${keyTypeLabel(m.keyType)}`,
      ];
      return metaTerms.some(t => t && t.toLowerCase().includes(q));
    });
  }, [clips, filterTag, tagIndex]);

  // Escape key clears range selection or exits scissors mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (scissorsMode) {
          setScissorsMode(false);
        } else if (selectionRange) {
          setSelectionRange(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionRange, scissorsMode]);

  // Enter key sets chord segment (when selection exists with detected chord)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger in input fields
      if (e.target instanceof HTMLElement && e.target.matches('input, textarea')) return;

      if (e.key === 'Enter' && selectionRange && rangeChordInfo?.chord) {
        e.preventDefault();
        handleOverrideBarChords();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionRange, rangeChordInfo, handleOverrideBarChords]);

  // S key toggles scissors mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.matches('input, textarea')) return;
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey && selectedClip) {
        e.preventDefault();
        setScissorsMode(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClip]);

  // Arrow key navigation: Up/Down for clips, Left/Right for segments
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.matches('input, textarea')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const isUpDown = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      const isLeftRight = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (!isUpDown && !isLeftRight) return;

      e.preventDefault();

      // Up/Down: navigate clips in the filtered list
      if (isUpDown && filteredClips.length > 0) {
        const currentIdx = selectedClip
          ? filteredClips.findIndex(c => c.id === selectedClip.id)
          : -1;
        let nextIdx: number;
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < filteredClips.length - 1 ? currentIdx + 1 : 0;
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : filteredClips.length - 1;
        }
        selectClip(filteredClips[nextIdx]!);
        return;
      }

      // Left/Right: navigate segments in the current clip
      if (isLeftRight && selectedClip?.segmentation?.segmentChords) {
        const segs = selectedClip.segmentation.segmentChords;
        if (segs.length === 0) return;

        // Find current segment based on selection range
        let currentSegIdx = -1;
        if (selectionRange) {
          currentSegIdx = segs.findIndex(
            s => s.startTick === selectionRange.startTick && s.endTick === selectionRange.endTick,
          );
        }

        let nextSegIdx: number;
        if (e.key === 'ArrowRight') {
          nextSegIdx = currentSegIdx < segs.length - 1 ? currentSegIdx + 1 : 0;
        } else {
          nextSegIdx = currentSegIdx > 0 ? currentSegIdx - 1 : segs.length - 1;
        }
        const seg = segs[nextSegIdx]!;
        setSelectionRange({ startTick: seg.startTick, endTick: seg.endTick });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredClips, selectedClip, selectionRange, selectClip]);

  // ─── Segmentation boundary management ──────────────────────────────

  /**
   * Compute segment chords for a clip given its boundaries.
   * Returns the full Segmentation object with segmentChords populated.
   */
  const computeSegmentation = useCallback((clip: Clip, boundaries: number[]): Segmentation | undefined => {
    if (boundaries.length === 0) return undefined;

    const { onsets, durations, ticks_per_bar, num_bars } = clip.gesture;
    const clipEndTick = num_bars * ticks_per_bar;

    const segResults = detectChordsForSegments(
      clip.harmonic.pitches,
      onsets,
      durations,
      boundaries,
      clipEndTick,
    );

    const segmentChords: SegmentChordInfo[] = segResults.map(sr => ({
      index: sr.index,
      startTick: sr.startTick,
      endTick: sr.endTick,
      chord: toDetectedChord(sr.chord),
      pitchClasses: sr.pitchClasses,
    }));

    return { boundaries, segmentChords };
  }, []);

  /**
   * Update the clip with new boundaries (recomputing segment chords), persist, and refresh.
   */
  const updateBoundaries = useCallback(async (boundaries: number[]) => {
    if (!selectedClip || !db) return;

    const segmentation = computeSegmentation(selectedClip, boundaries);
    const updated: Clip = { ...selectedClip, segmentation };

    await db.updateClip(updated);
    setSelectedClip(updated);
    refreshClips();
  }, [selectedClip, db, computeSegmentation, refreshClips]);

  const addBoundary = useCallback(async (tick: number) => {
    if (!selectedClip) return;
    const existing = selectedClip.segmentation?.boundaries ?? [];
    if (existing.includes(tick)) return;
    const boundaries = [...existing, tick].sort((a, b) => a - b);
    await updateBoundaries(boundaries);
  }, [selectedClip, updateBoundaries]);

  const removeBoundary = useCallback(async (tick: number) => {
    if (!selectedClip?.segmentation) return;
    const boundaries = selectedClip.segmentation.boundaries.filter(b => b !== tick);
    await updateBoundaries(boundaries);
  }, [selectedClip, updateBoundaries]);

  const moveBoundary = useCallback(async (fromTick: number, toTick: number) => {
    if (!selectedClip?.segmentation) return;
    const boundaries = selectedClip.segmentation.boundaries
      .map(b => b === fromTick ? toTick : b)
      .sort((a, b) => a - b);
    // Deduplicate (in case moved onto another boundary)
    const deduped = [...new Set(boundaries)];
    await updateBoundaries(deduped);
  }, [selectedClip, updateBoundaries]);

  /**
   * Auto-segment the current clip using its leadsheet chord boundaries.
   * Each chord change point becomes a segment boundary, snapped to the
   * nearest note onset or note-end within half a beat.
   */
  const handleSegmentFromLeadsheet = useCallback(async () => {
    if (!selectedClip?.leadsheet || !db) return;
    const segmentation = computeSegmentationFromLeadsheet(
      selectedClip.gesture, selectedClip.harmonic, selectedClip.leadsheet,
    );
    const updated: Clip = { ...selectedClip, segmentation };
    await db.updateClip(updated);
    setSelectedClip(updated);
    refreshClips();
  }, [selectedClip, db, refreshClips]);

  const handleTogglePlayback = useCallback(() => {
    if (selectedClip) toggle(selectedClip);
  }, [selectedClip, toggle]);

  // Keyboard shortcuts (only active when a clip is selected)
  useKeyboardShortcuts(
    selectedClip
      ? {
          onDownload: handleDownloadCurrent,
          onGenerateVariants: generateVariants,
          onGenerateSingle: generateSingleVariant,
          onDelete: deleteClip,
          onTogglePlayback: handleTogglePlayback,
        }
      : {},
  );

  return (
    <div className="mc-app">
      {/* Live region for accessibility announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
      <div className="mc-layout">
        <Sidebar
          clips={filteredClips}
          selectedClipId={selectedClip?.id ?? null}
          filterTag={filterTag}
          onFilterChange={setFilterTag}
          onSelectClip={selectClip}
          onDownloadAll={() => downloadAllAsZip(filteredClips)}
          onClearAll={clearAllClips}
          onFilesDropped={handleFileUpload}
          fileInputRef={fileInputRef}
          onLoadSamples={handleLoadSamples}
          loadingSamples={loadingSamples}
          onGenerateProgression={handleGenerateProgression}
          onLoadLoopDb={handleLoadLoopDb}
          loopDbFileName={loopDbFileName}
          loopDbStatus={loopDbStatus}
          loopDbEnriched={loopDbEnriched}
        />

        {selectedClip ? (
          <ClipDetail
            clip={selectedClip}
            clips={clips}
            tags={tags}
            newTag={newTag}
            onNewTagChange={setNewTag}
            onAddTag={addTag}
            editingBpm={editingBpm}
            bpmValue={bpmValue}
            onBpmChange={setBpmValue}
            onBpmSave={saveBpm}
            onStartEditBpm={() => setEditingBpm(true)}
            densityMultiplier={densityMultiplier}
            onDensityChange={setDensityMultiplier}
            onGenerateSingle={generateSingleVariant}
            onGenerateVariants={generateVariants}
            onDownload={handleDownloadCurrent}
            onDelete={deleteClip}
            onDownloadVariantsZip={handleDownloadVariantsZip}
            playbackState={playbackState}
            playbackTime={currentTime}
            onPlay={() => play(selectedClip)}
            onPause={pause}
            onStop={stop}
            selectionRange={selectionRange}
            onRangeSelect={setSelectionRange}
            rangeChordInfo={rangeChordInfo}
            onOverrideChord={handleOverrideBarChords}
            onAdaptChord={handleAdaptChord}
            scissorsMode={scissorsMode}
            onToggleScissors={() => setScissorsMode(prev => !prev)}
            onAddBoundary={addBoundary}
            onRemoveBoundary={removeBoundary}
            onMoveBoundary={moveBoundary}
            onFilterByTag={setFilterTag}
            onLeadsheetChange={handleLeadsheetChange}
            onLeadsheetBoundaryMove={handleLeadsheetBoundaryMove}
            onSegmentFromLeadsheet={selectedClip?.leadsheet ? handleSegmentFromLeadsheet : undefined}
          />
        ) : (
          <div className="mc-main">
            <div className="mc-welcome">
              <h2>Welcome to MIDI Curator</h2>
              <p>Drop MIDI files to get started, or select a clip from the sidebar.</p>
              {clips.length === 0 && (
                <button
                  className="mc-btn--samples"
                  onClick={handleLoadSamples}
                  disabled={loadingSamples}
                >
                  {loadingSamples ? 'Loading...' : 'Load Sample Progressions'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <KeyboardShortcutsBar />
    </div>
  );
}
