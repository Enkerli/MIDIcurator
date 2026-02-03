import type { Clip } from '../types/clip';
import type { PlaybackState } from '../lib/playback';
import { StatsGrid } from './StatsGrid';
import { PianoRoll } from './PianoRoll';
import { ChordBar } from './ChordBar';
import { TransportBar } from './TransportBar';
import { TagEditor } from './TagEditor';
import { TransformControls } from './TransformControls';
import { ActionBar } from './ActionBar';
import { VariantInfo } from './VariantInfo';

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
}: ClipDetailProps) {
  const sourceClip = clip.source ? clips.find(c => c.id === clip.source) : undefined;
  const variantCount = clips.filter(c => c.source === clip.id).length;
  const hasFilenameMatch = clip.filename.match(/(\d+)[-_\s]?bpm/i);

  return (
    <div className="mc-main">
      <h1>{clip.filename}</h1>

      <div className="mc-piano-roll-section">
        <TransportBar
          state={playbackState}
          currentTime={playbackTime}
          onPlay={onPlay}
          onPause={onPause}
          onStop={onStop}
        />
        {clip.harmonic.barChords && clip.harmonic.barChords.length > 0 && (
          <ChordBar barChords={clip.harmonic.barChords} />
        )}
        <PianoRoll
          clip={clip}
          playbackTime={playbackTime}
          isPlaying={playbackState === 'playing'}
          height={240}
        />
      </div>

      <StatsGrid
        clip={clip}
        editingBpm={editingBpm}
        bpmValue={bpmValue}
        onBpmChange={onBpmChange}
        onBpmSave={onBpmSave}
        onStartEditBpm={onStartEditBpm}
      />

      <div className="mc-debug-info">
        <div style={{ marginBottom: 8 }}>
          <strong>Timing Debug Info:</strong>
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
