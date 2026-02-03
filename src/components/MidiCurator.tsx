import { useState, useCallback, useRef } from 'react';
import type { Clip } from '../types/clip';
import { useDatabase } from '../hooks/useDatabase';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { parseMIDI, extractNotes, extractBPM } from '../lib/midi-parser';
import { extractGesture, extractHarmonic } from '../lib/gesture';
import { transformGesture } from '../lib/transform';
import { downloadMIDI, downloadAllClips, downloadVariantsAsZip } from '../lib/midi-export';
import { Sidebar } from './Sidebar';
import { ClipDetail } from './ClipDetail';
import { KeyboardShortcutsBar } from './KeyboardShortcutsBar';

export function MidiCurator() {
  const { db, clips, refreshClips } = useDatabase();
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState('');
  const [newTag, setNewTag] = useState('');
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmValue, setBpmValue] = useState('');
  const [densityMultiplier, setDensityMultiplier] = useState(1.0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectClip = useCallback(async (clip: Clip) => {
    setSelectedClip(clip);
    setBpmValue(clip.bpm.toString());
    setEditingBpm(false);
    if (db) {
      const clipTags = await db.getClipTags(clip.id);
      setTags(clipTags);
    }
  }, [db]);

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
      await db.deleteClip(selectedClip.id);
      setSelectedClip(null);
      setTags([]);
      refreshClips();
    }
  }, [selectedClip, db, refreshClips]);

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

        // Try filename BPM first, fall back to tempo events
        let bpm: number | null = null;
        const bpmMatch = file.name.match(/(\d+)[-_\s]?bpm/i);
        if (bpmMatch) {
          bpm = parseInt(bpmMatch[1]!);
        }
        if (!bpm) {
          bpm = extractBPM(midiData);
        }

        const gesture = extractGesture(notes, midiData.ticksPerBeat);
        const harmonic = extractHarmonic(notes);

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

  // Keyboard shortcuts (only active when a clip is selected)
  useKeyboardShortcuts(
    selectedClip
      ? {
          onDownload: handleDownloadCurrent,
          onGenerateVariants: generateVariants,
          onGenerateSingle: generateSingleVariant,
          onDelete: deleteClip,
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
