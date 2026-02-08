import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { Clip, DetectedChord } from '../types/clip';
import { useDatabase } from '../hooks/useDatabase';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { usePlayback } from '../hooks/usePlayback';
import { parseMIDI, extractNotes, extractBPM, extractTimeSignature } from '../lib/midi-parser';
import { extractGesture, extractHarmonic } from '../lib/gesture';
import { transformGesture } from '../lib/transform';
import { downloadMIDI, downloadAllClips, downloadVariantsAsZip } from '../lib/midi-export';
import { getNotesInTickRange, detectChordBlocks } from '../lib/piano-roll';
import type { TickRange } from '../lib/piano-roll';
import { detectChord } from '../lib/chord-detect';
import { spliceSegment, isTrivialSegments, removeRestSegments } from '../lib/chord-segments';
import { substituteSegmentPitches } from '../lib/chord-substitute';
import { Sidebar } from './Sidebar';
import { ClipDetail } from './ClipDetail';
import { KeyboardShortcutsBar } from './KeyboardShortcutsBar';

export function MidiCurator() {
  const { db, clips, refreshClips } = useDatabase();
  const { playbackState, currentTime, play, pause, stop, toggle } = usePlayback();
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState('');
  const [newTag, setNewTag] = useState('');
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmValue, setBpmValue] = useState('');
  const [densityMultiplier, setDensityMultiplier] = useState(1.0);
  const [selectionRange, setSelectionRange] = useState<TickRange | null>(null);
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
      };

      await db.addClip(variant);
    }

    refreshClips();
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
    };

    await db.addClip(variant);
    refreshClips();
  }, [selectedClip, db, densityMultiplier, refreshClips]);

  const handleFileUpload = useCallback(async (files: File[]) => {
    if (!db) return;

    for (const file of files) {
      if (!file.name.match(/\.mid$/i)) continue;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const midiData = parseMIDI(arrayBuffer);
        const notes = extractNotes(midiData);

        if (notes.length === 0) continue;

        let bpm: number | null = null;
        const bpmMatch = file.name.match(/(\d+)[-_\s]?bpm/i);
        if (bpmMatch) {
          bpm = parseInt(bpmMatch[1]!);
        }
        if (!bpm) {
          bpm = extractBPM(midiData);
        }

        const timeSig = extractTimeSignature(midiData);
        const gesture = extractGesture(notes, midiData.ticksPerBeat, timeSig);
        const harmonic = extractHarmonic(notes, gesture);

        const clip: Clip = {
          id: crypto.randomUUID(),
          filename: file.name,
          imported_at: Date.now(),
          bpm,
          gesture,
          harmonic,
          rating: null,
          notes: '',
        };

        await db.addClip(clip);
      } catch (error) {
        console.error('Error importing', file.name, error);
      }
    }

    refreshClips();
  }, [db, refreshClips]);

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
    if (selectedClip) downloadMIDI(selectedClip);
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

  // Escape key clears range selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectionRange) {
        setSelectionRange(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionRange]);

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

  const filteredClips = filterTag
    ? clips.filter(c => c.filename.toLowerCase().includes(filterTag.toLowerCase()))
    : clips;

  return (
    <div className="mc-app">
      <div className="mc-layout">
        <Sidebar
          clips={filteredClips}
          selectedClipId={selectedClip?.id ?? null}
          filterTag={filterTag}
          onFilterChange={setFilterTag}
          onSelectClip={selectClip}
          onDownloadAll={() => downloadAllClips(filteredClips)}
          onClearAll={clearAllClips}
          onFilesDropped={handleFileUpload}
          fileInputRef={fileInputRef}
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
          />
        ) : (
          <div className="mc-main">
            <div className="mc-welcome">
              <h2>Welcome to MIDI Curator</h2>
              <p>Drop MIDI files to get started, or select a clip from the sidebar.</p>
            </div>
          </div>
        )}
      </div>

      <KeyboardShortcutsBar />
    </div>
  );
}
