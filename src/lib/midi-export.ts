import type { Gesture, Harmonic, Clip } from '../types/clip';
import { createZip } from './zip';

export function encodeVariableLength(value: number): number[] {
  const bytes: number[] = [];
  bytes.push(value & 0x7F);

  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7F) | 0x80);
    value >>= 7;
  }

  return bytes;
}

export function createMIDIHeader(format: number, ticksPerBeat: number): number[] {
  return [
    0x4D, 0x54, 0x68, 0x64,                            // "MThd"
    0x00, 0x00, 0x00, 0x06,                             // Header length (6 bytes)
    0x00, format,                                        // Format type
    0x00, 0x01,                                          // Number of tracks
    (ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF,    // Ticks per beat
  ];
}

export function createMIDITrack(
  gesture: Gesture,
  harmonic: Harmonic,
  bpm: number,
  _ticksPerBeat: number,
): number[] {
  const events: Array<{ delta: number; data: number[] }> = [];

  // Set tempo event
  const microsecondsPerBeat = Math.round(60000000 / bpm);
  events.push({
    delta: 0,
    data: [
      0xFF, 0x51, 0x03, // Meta event: Set Tempo
      (microsecondsPerBeat >> 16) & 0xFF,
      (microsecondsPerBeat >> 8) & 0xFF,
      microsecondsPerBeat & 0xFF,
    ],
  });

  // Create note events
  const noteEvents: Array<{
    tick: number;
    type: 'on' | 'off';
    note: number;
    velocity: number;
  }> = [];

  for (let i = 0; i < gesture.onsets.length; i++) {
    noteEvents.push({
      tick: gesture.onsets[i]!,
      type: 'on',
      note: harmonic.pitches[i]!,
      velocity: gesture.velocities[i]!,
    });
    noteEvents.push({
      tick: gesture.onsets[i]! + gesture.durations[i]!,
      type: 'off',
      note: harmonic.pitches[i]!,
      velocity: 0,
    });
  }

  // Sort by tick
  noteEvents.sort((a, b) => a.tick - b.tick);

  // Convert to delta times
  let currentTick = 0;
  for (const event of noteEvents) {
    const delta = event.tick - currentTick;
    currentTick = event.tick;

    const status = event.type === 'on' ? 0x90 : 0x80;
    events.push({
      delta,
      data: [status, event.note, event.velocity],
    });
  }

  // End of track
  events.push({
    delta: 0,
    data: [0xFF, 0x2F, 0x00],
  });

  // Encode events
  const trackData: number[] = [];
  for (const event of events) {
    trackData.push(...encodeVariableLength(event.delta));
    trackData.push(...event.data);
  }

  // Create track chunk
  const trackLength = trackData.length;
  return [
    0x4D, 0x54, 0x72, 0x6B, // "MTrk"
    (trackLength >> 24) & 0xFF,
    (trackLength >> 16) & 0xFF,
    (trackLength >> 8) & 0xFF,
    trackLength & 0xFF,
    ...trackData,
  ];
}

export function createMIDI(gesture: Gesture, harmonic: Harmonic, bpm: number): Uint8Array {
  const ticksPerBeat = gesture.ticks_per_beat || 480;
  const header = createMIDIHeader(1, ticksPerBeat);
  const track = createMIDITrack(gesture, harmonic, bpm, ticksPerBeat);

  return new Uint8Array([...header, ...track]);
}

// DOM-dependent download helpers (future Electron IPC boundary)

export function downloadMIDI(clip: Clip): void {
  const midiData = createMIDI(clip.gesture, clip.harmonic, clip.bpm);
  const blob = new Blob([midiData], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = clip.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadAllClips(clips: Clip[]): void {
  clips.forEach((clip, index) => {
    setTimeout(() => downloadMIDI(clip), 100 * index);
  });
}

export async function downloadVariantsAsZip(
  variants: Clip[],
  sourceFilename: string,
): Promise<void> {
  const files = variants.map(variant => {
    const midiData = createMIDI(variant.gesture, variant.harmonic, variant.bpm);
    const actualDensity = variant.gesture.density.toFixed(2);
    const baseName = sourceFilename.replace(/\.mid$/i, '');
    const filename = `${baseName}_d${actualDensity}.mid`;
    return { name: filename, data: midiData };
  });

  const zipData = createZip(files);
  const blob = new Blob([zipData], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${sourceFilename.replace(/\.mid$/i, '')}_variants.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate chord detection debug JSON with detailed timing and note info.
 */
export function generateChordDebugJSON(clip: Clip): string {
  const { gesture, harmonic, bpm } = clip;
  const ticksPerBar = gesture.ticks_per_bar;
  const ticksPerBeat = gesture.ticks_per_beat;

  // Build per-bar analysis with detailed note info
  const barAnalysis = harmonic.barChords?.map(bc => {
    const barStart = bc.bar * ticksPerBar;
    const barEnd = barStart + ticksPerBar;

    // Find notes in this bar (onset in bar OR sustaining into bar)
    const notesInBar: Array<{
      index: number;
      pitch: number;
      pitchClass: number;
      pitchName: string;
      onset: number;
      duration: number;
      endTick: number;
      sustainedFromPrevious: boolean;
    }> = [];

    for (let i = 0; i < gesture.onsets.length; i++) {
      const onset = gesture.onsets[i]!;
      const dur = gesture.durations[i]!;
      const noteEnd = onset + dur;
      const pitch = harmonic.pitches[i]!;

      // Include if note is sounding in this bar
      if ((onset >= barStart && onset < barEnd) ||
          (onset < barStart && noteEnd > barStart)) {
        const pc = ((pitch % 12) + 12) % 12;
        const noteNames = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
        notesInBar.push({
          index: i,
          pitch,
          pitchClass: pc,
          pitchName: noteNames[pc]!,
          onset,
          duration: dur,
          endTick: noteEnd,
          sustainedFromPrevious: onset < barStart,
        });
      }
    }

    return {
      bar: bc.bar,
      barStartTick: barStart,
      barEndTick: barEnd,
      detectedChord: bc.chord ? {
        symbol: bc.chord.symbol,
        root: bc.chord.root,
        rootName: bc.chord.rootName,
        quality: bc.chord.qualityKey,
        qualityName: bc.chord.qualityName,
      } : null,
      pitchClasses: bc.pitchClasses,
      segments: bc.segments,
      notesInBar,
      noteCount: notesInBar.length,
      distinctPitchClasses: [...new Set(notesInBar.map(n => n.pitchClass))].sort((a, b) => a - b),
    };
  }) ?? [];

  const debug = {
    exportedAt: new Date().toISOString(),
    filename: clip.filename,
    clipId: clip.id,
    bpm,
    timing: {
      ticksPerBeat,
      ticksPerBar,
      numBars: gesture.num_bars,
      totalNotes: gesture.onsets.length,
    },
    overallChord: harmonic.detectedChord ? {
      symbol: harmonic.detectedChord.symbol,
      root: harmonic.detectedChord.root,
      rootName: harmonic.detectedChord.rootName,
      quality: harmonic.detectedChord.qualityKey,
    } : null,
    barChords: barAnalysis,
  };

  return JSON.stringify(debug, null, 2);
}

/**
 * Download chord debug JSON for a clip.
 */
export function downloadChordDebug(clip: Clip): void {
  const json = generateChordDebugJSON(clip);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${clip.filename.replace(/\.mid$/i, '')}_chord-debug.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
