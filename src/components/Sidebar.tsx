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
  /** Called when the user picks a loop DB file (.db). */
  onLoadLoopDb?: (file: File) => void;
  /** Filename of the currently-loaded loop DB, or null. */
  loopDbFileName?: string | null;
  /** Loading / result status of the DB operation. */
  loopDbStatus?: 'idle' | 'loading' | 'ok' | 'error';
  /** Number of existing clips that were enriched with loop metadata. */
  loopDbEnriched?: number;
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
  onLoadLoopDb,
  loopDbFileName,
  loopDbStatus = 'idle',
  loopDbEnriched = 0,
}: SidebarProps) {
  const loopDbInputRef = { current: null as HTMLInputElement | null };

  const loopDbLabel = loopDbStatus === 'loading'
    ? '🗄 Loading…'
    : loopDbStatus === 'error'
    ? '🗄 DB Error'
    : loopDbFileName
    ? '🗄 DB ✓'
    : '🗄 Loop DB';

  const loopDbTitle = loopDbStatus === 'error'
    ? 'Failed to load. Select LogicLoopsDatabaseV11.db from ~/Music/Audio Music Apps/Databases/'
    : loopDbStatus === 'loading'
    ? 'Loading loop database…'
    : loopDbFileName
    ? `Loop DB loaded: ${loopDbFileName}. Click to reload.`
    : 'Load LogicLoopsDatabaseV11.db from ~/Music/Audio Music Apps/Databases/';

  return (
    <div className="mc-sidebar">
      <div className="mc-sidebar-header">
        <h2>MIDI Curator</h2>
        <ThemeToggle />
      </div>

      <DropZone onFilesDropped={onFilesDropped} fileInputRef={fileInputRef} />

      {onLoadLoopDb && (
        <div className="mc-loop-db-row">
          <button
            className={[
              'mc-btn--loop-db',
              loopDbStatus === 'ok' ? 'is-loaded' : '',
              loopDbStatus === 'error' ? 'is-error' : '',
              loopDbStatus === 'loading' ? 'is-loading' : '',
            ].filter(Boolean).join(' ')}
            title={loopDbTitle}
            disabled={loopDbStatus === 'loading'}
            onClick={() => loopDbInputRef.current?.click()}
          >
            {loopDbLabel}
          </button>
          {loopDbStatus === 'ok' && loopDbFileName && (
            <span className="mc-loop-db-name" title={loopDbFileName}>
              {loopDbFileName}
              {loopDbEnriched > 0 && (
                <span className="mc-loop-db-enriched" title={`${loopDbEnriched} existing clip(s) enriched with loop metadata`}>
                  {' '}+{loopDbEnriched}
                </span>
              )}
            </span>
          )}
          {loopDbStatus === 'ok' && loopDbEnriched === 0 && loopDbFileName && (
            <span className="mc-loop-db-name mc-loop-db-name--hint">
              no matches
            </span>
          )}
          <input
            ref={el => { loopDbInputRef.current = el; }}
            type="file"
            accept=".db,.sqlite"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onLoadLoopDb(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

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
