import type { PlaybackState } from '../lib/playback';

interface TransportBarProps {
  state: PlaybackState;
  currentTime: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

export function TransportBar({
  state,
  currentTime,
  onPlay,
  onPause,
  onStop,
}: TransportBarProps) {
  return (
    <div className="mc-transport">
      <button
        className={`mc-transport-btn ${state === 'playing' ? 'mc-transport-btn--active' : ''}`}
        onClick={state === 'playing' ? onPause : onPlay}
        title={state === 'playing' ? 'Pause (Space)' : 'Play (Space)'}
      >
        {state === 'playing' ? '\u275A\u275A' : '\u25B6'}
      </button>
      <button
        className="mc-transport-btn"
        onClick={onStop}
        title="Stop"
        disabled={state === 'stopped'}
      >
        &#x25A0;
      </button>
      <span className="mc-transport-time">{formatTime(currentTime)}</span>
      <span className="mc-transport-state">
        {state === 'playing' && 'Playing'}
        {state === 'paused' && 'Paused'}
        {state === 'stopped' && ''}
      </span>
    </div>
  );
}
