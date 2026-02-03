import type { RefObject } from 'react';
import type { Clip } from '../types/clip';
import { DropZone } from './DropZone';
import { ClipCard } from './ClipCard';

interface SidebarProps {
  clips: Clip[];
  selectedClipId: string | null;
  filterTag: string;
  onFilterChange: (value: string) => void;
  onSelectClip: (clip: Clip) => void;
  onDownloadAll: () => void;
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
  onFilesDropped,
  fileInputRef,
}: SidebarProps) {
  return (
    <div className="mc-sidebar">
      <h2>MIDI Curator</h2>

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
        {clips.length > 0 && (
          <button className="mc-btn--download-all" onClick={onDownloadAll}>
            Download All
          </button>
        )}
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
