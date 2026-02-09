import { useCallback, useMemo } from 'react';
import type { Clip, DetectedChord } from '../types/clip';
import type { PlaybackState } from '../lib/playback';
import type { TickRange } from '../lib/piano-roll';
import { StatsGrid } from './StatsGrid';
import { PianoRoll } from './PianoRoll';
import { ChordBar } from './ChordBar';
import { TransportBar } from './TransportBar';
import { TagEditor } from './TagEditor';
import { TransformControls } from './TransformControls';
import { ActionBar } from './ActionBar';
import { VariantInfo } from './VariantInfo';
import { downloadChordDebug } from '../lib/midi-export';
import { parseChordSymbol } from '../lib/chord-parser';

interface ClipDetailProps {
  clip: Clip;
  clips: Clip[];
  tags: string[];
  newTag: string;
  onNewTagChange: (value: string) => void;
  onAddTag: () => void;
  editingBpm: boolean;
  bpmValue: string;
  onBpmChange: (value: string) => void;
  onBpmSave: () => void;
  onStartEditBpm: () => void;
  densityMultiplier: number;
  onDensityChange: (value: number) => void;
  onGenerateSingle: () => void;
  onGenerateVariants: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onDownloadVariantsZip: () => void;
  playbackState: PlaybackState;
  playbackTime: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  selectionRange: TickRange | null;
  onRangeSelect: (range: TickRange | null) => void;
  rangeChordInfo: {
    chord: DetectedChord | null;
    pitchClasses: number[];
    noteCount: number;
  } | null;
  onOverrideChord: () => void;
  onAdaptChord?: (newChord: DetectedChord) => void;
  scissorsMode: boolean;
  onToggleScissors: () => void;
  onAddBoundary: (tick: number) => void;
  onRemoveBoundary: (tick: number) => void;
  onMoveBoundary: (fromTick: number, toTick: number) => void;
  onFilterByTag?: (tag: string) => void;
}

export function ClipDetail({
  clip,
  clips,
  tags,
  newTag,
  onNewTagChange,
  onAddTag,
  editingBpm,
  bpmValue,
  onBpmChange,
  onBpmSave,
  onStartEditBpm,
  densityMultiplier,
  onDensityChange,
  onGenerateSingle,
  onGenerateVariants,
  onDownload,
  onDelete,
  onDownloadVariantsZip,
  playbackState,
  playbackTime,
  onPlay,
  onPause,
  onStop,
  selectionRange,
  onRangeSelect,
  rangeChordInfo,
  onOverrideChord,
  onAdaptChord,
  scissorsMode,
  onToggleScissors,
  onAddBoundary,
  onRemoveBoundary,
  onMoveBoundary,
  onFilterByTag,
}: ClipDetailProps) {
  const sourceClip = clip.source ? clips.find(c => c.id === clip.source) : undefined;
  const variantCount = clips.filter(c => c.source === clip.id).length;
  const hasFilenameMatch = clip.filename.match(/(\d+)[-_\s]?bpm/i);

  // Compute totalTicks to match the piano roll's extent exactly.
  // This ensures the ChordBar bars align with the PianoRoll grid.
  const totalTicks = useMemo(() => {
    const { onsets, durations, ticks_per_beat } = clip.gesture;
    const lastTick = Math.max(
      ...onsets.map((onset, i) => onset + durations[i]!),
    );
    return lastTick + ticks_per_beat;
  }, [clip.gesture]);

  // Handle inline chord editing from chord bar
  const handleChordBarEdit = useCallback(
    (startTick: number, endTick: number, newSymbol: string) => {
      const parsed = parseChordSymbol(newSymbol);
      if (parsed && onAdaptChord) {
        // First select the range, then adapt
        onRangeSelect({ startTick, endTick });
        // Use setTimeout to ensure selection is applied before adaptation
        setTimeout(() => onAdaptChord(parsed), 0);
      }
    },
    [onRangeSelect, onAdaptChord],
  );

  return (
    <div className="mc-main">
      <h1>{clip.filename}</h1>

      <div className="mc-piano-roll-section">
        <div className="mc-piano-roll-toolbar">
          <TransportBar
            state={playbackState}
            currentTime={playbackTime}
            onPlay={onPlay}
            onPause={onPause}
            onStop={onStop}
          />
          <button
            className={`mc-btn--tool ${scissorsMode ? 'mc-btn--tool-active' : ''}`}
            onClick={onToggleScissors}
            title={scissorsMode ? 'Exit scissors mode (S or Esc)' : 'Scissors tool — click to place segment boundaries (S)'}
          >
            ✂
          </button>
        </div>
        {clip.harmonic.barChords && clip.harmonic.barChords.length > 0 && (
          <ChordBar
            barChords={clip.harmonic.barChords}
            ticksPerBar={clip.gesture.ticks_per_bar}
            ticksPerBeat={clip.gesture.ticks_per_beat}
            totalTicks={totalTicks}
            selectionRange={selectionRange}
            onSegmentClick={(startTick, endTick) => onRangeSelect({ startTick, endTick })}
            onChordEdit={handleChordBarEdit}
            segmentChords={clip.segmentation?.segmentChords}
          />
        )}
        <PianoRoll
          clip={clip}
          playbackTime={playbackTime}
          isPlaying={playbackState === 'playing'}
          height={240}
          selectionRange={selectionRange}
          onRangeSelect={onRangeSelect}
          scissorsMode={scissorsMode}
          boundaries={clip.segmentation?.boundaries ?? []}
          onBoundaryAdd={onAddBoundary}
          onBoundaryRemove={onRemoveBoundary}
          onBoundaryMove={onMoveBoundary}
        />
      </div>

      <StatsGrid
        clip={clip}
        editingBpm={editingBpm}
        bpmValue={bpmValue}
        onBpmChange={onBpmChange}
        onBpmSave={onBpmSave}
        onStartEditBpm={onStartEditBpm}
        playbackTime={playbackTime}
        isPlaying={playbackState === 'playing'}
        rangeChordInfo={rangeChordInfo}
        onOverrideChord={onOverrideChord}
        onAdaptChord={onAdaptChord}
      />

      <div className="mc-debug-info">
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Timing Debug Info:</strong>
          <button
            className="mc-btn--small"
            onClick={() => downloadChordDebug(clip)}
            title="Download detailed chord detection data as JSON"
          >
            Export Chord Debug
          </button>
        </div>
        <div>
          Ticks per beat:{' '}
          <span className="mc-debug-highlight">
            {clip.gesture.ticks_per_beat || 'not stored'}
          </span>
        </div>
        <div>Ticks per bar: {clip.gesture.ticks_per_bar}</div>
        <div>Bars: {clip.gesture.num_bars}</div>
        <div>
          BPM: <span className="mc-debug-highlight">{clip.bpm}</span>
          {hasFilenameMatch && (
            <span className="mc-debug-filename-tag">(from filename)</span>
          )}
        </div>
        <div className="mc-debug-separator">
          First note: tick {clip.gesture.onsets[0]}, pitch {clip.harmonic.pitches[0]}
        </div>
        <div>Last note: tick {clip.gesture.onsets[clip.gesture.onsets.length - 1]}</div>
        <div className="mc-debug-hint">
          Click the BPM value above to edit it if the tempo is wrong
        </div>
      </div>

      <TagEditor
        tags={tags}
        newTag={newTag}
        onNewTagChange={onNewTagChange}
        onAddTag={onAddTag}
        onTagClick={onFilterByTag}
      />

      <TransformControls
        densityMultiplier={densityMultiplier}
        onDensityChange={onDensityChange}
        noteCount={clip.gesture.onsets.length}
      />

      <ActionBar
        onGenerateSingle={onGenerateSingle}
        onGenerateVariants={onGenerateVariants}
        onDownload={onDownload}
        onDelete={onDelete}
      />

      <div className="mc-zip-download">
        <button className="mc-btn--zip" onClick={onDownloadVariantsZip}>
          Download All Variants as ZIP ({variantCount})
        </button>
      </div>

      <VariantInfo clip={clip} sourceClip={sourceClip} />
    </div>
  );
}
