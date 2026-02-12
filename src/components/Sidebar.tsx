import type { RefObject } from 'react';
import type { Clip } from '../types/clip';
import type { VoicingShape } from '../lib/progressions';
import { DropZone } from './DropZone';
import { ClipCard } from './ClipCard';
import { ThemeToggle } from './ThemeToggle';
import { ProgressionGenerator } from './ProgressionGenerator';

interface SidebarProps {
  clips: Clip[];
  selectedClipId: string | null;
  filterTag: string;
  onFilterChange: (value: string) => void;
  onSelectClip: (clip: Clip) => void;
  onDownloadAll: () => void;
  onClearAll: () => void;
  onFilesDropped: (files: File[]) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onLoadSamples?: () => void;
  loadingSamples?: boolean;
  onGenerateProgression?: (progressionIndex: number, keyOffset: number, voicing: VoicingShape) => void;
}

export function Sidebar({
  clips,
  selectedClipId,
  filterTag,
  onFilterChange,
  onSelectClip,
  onDownloadAll,
  onClearAll,
  onFilesDropped,
  fileInputRef,
  onLoadSamples,
  loadingSamples,
  onGenerateProgression,
}: SidebarProps) {
  return (
    <div className="mc-sidebar">
      <div className="mc-sidebar-header">
        <h2>MIDI Curator</h2>
        <ThemeToggle />
      </div>

      <DropZone onFilesDropped={onFilesDropped} fileInputRef={fileInputRef} />

      {onGenerateProgression && (
        <ProgressionGenerator onGenerate={onGenerateProgression} />
      )}

      {onLoadSamples && clips.length === 0 && (
        <button
          className="mc-btn--load-samples"
          onClick={onLoadSamples}
          disabled={loadingSamples}
        >
          {loadingSamples ? 'Loading samples...' : 'Load sample progressions'}
        </button>
      )}

      <input
        type="text"
        className="mc-filter-input"
        placeholder="Filter clips..."
        aria-label="Filter clips by tag or name"
        value={filterTag}
        onChange={(e) => onFilterChange(e.target.value)}
      />

      <div className="mc-clip-count">
        <span>{clips.length} clips</span>
        <span className="mc-clip-count-actions">
          {clips.length > 0 && (
            <>
              <button
                className="mc-btn--download-all"
                onClick={onDownloadAll}
                aria-label={`Download all ${clips.length} clips as ZIP file`}
              >
                Download All
              </button>
              <button
                className="mc-btn--clear-all"
                onClick={onClearAll}
                aria-label={`Clear all ${clips.length} clips from library`}
              >
                Clear All
              </button>
            </>
          )}
        </span>
      </div>

      <div className="mc-clip-list">
        {clips.map(clip => (
          <ClipCard
            key={clip.id}
            clip={clip}
            isSelected={selectedClipId === clip.id}
            onClick={() => onSelectClip(clip)}
          />
        ))}
      </div>
    </div>
  );
}
