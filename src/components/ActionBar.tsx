interface ActionBarProps {
  onGenerateSingle: () => void;
  onGenerateVariants: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

export function ActionBar({
  onGenerateSingle,
  onGenerateVariants,
  onDownload,
  onDelete,
}: ActionBarProps) {
  return (
    <div className="mc-action-bar">
      <button className="mc-btn mc-btn--primary" onClick={onGenerateSingle}>
        Generate 1 Variant
      </button>
      <button className="mc-btn mc-btn--secondary" onClick={onGenerateVariants}>
        Generate 5 Variants
      </button>
      <button className="mc-btn mc-btn--success" onClick={onDownload}>
        Download MIDI
      </button>
      <button className="mc-btn mc-btn--danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
