import type { RefObject } from 'react';
import type { Clip } from '../types/clip';
import { DropZone } from './DropZone';
import { ClipCard } from './ClipCard';
import { ThemeToggle } from './ThemeToggle';

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
}: SidebarProps) {
  return (
    <div className="mc-sidebar">
      <div className="mc-sidebar-header">
        <h2>MIDI Curator</h2>
        <ThemeToggle />
      </div>

      <DropZone onFilesDropped={onFilesDropped} fileInputRef={fileInputRef} />

      <input
        type="text"
        className="mc-filter-input"
        placeholder="Filter clips..."
        value={filterTag}
        onChange={(e) => onFilterChange(e.target.value)}
      />

      <div className="mc-clip-count">
        <span>{clips.length} clips</span>
        <span className="mc-clip-count-actions">
          {clips.length > 0 && (
            <>
              <button className="mc-btn--download-all" onClick={onDownloadAll}>
                Download All
              </button>
              <button className="mc-btn--clear-all" onClick={onClearAll}>
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
