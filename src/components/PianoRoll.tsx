import { useRef, useEffect, useCallback } from 'react';
import type { Clip } from '../types/clip';
import {
  computeLayout,
  computeNoteRects,
  computeGridLines,
  timeToX,
  velocityColor,
  isBlackKey,
  noteName,
} from '../lib/piano-roll';
import type { PianoRollLayout } from '../lib/piano-roll';

interface PianoRollProps {
  clip: Clip;
  /** Current playback time in seconds (0 when stopped) */
  playbackTime: number;
  /** Whether playback is active (controls playhead visibility) */
  isPlaying: boolean;
  /** Canvas height in CSS pixels */
  height?: number;
}

export function PianoRoll({
  clip,
  playbackTime,
  isPlaying,
  height = 240,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<PianoRollLayout | null>(null);

  const draw = useCallback(
    (canvas: HTMLCanvasElement, width: number) => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const layout = computeLayout(clip.gesture, clip.harmonic, width, height);
      layoutRef.current = layout;

      // Background
      ctx.fillStyle = '#181818';
      ctx.fillRect(0, 0, width, height);

      // Piano key lanes (horizontal stripes for each pitch)
      for (let pitch = layout.minPitch; pitch <= layout.maxPitch; pitch++) {
        const y =
          layout.topPad + (layout.maxPitch - pitch) * layout.pxPerSemitone;
        ctx.fillStyle = isBlackKey(pitch) ? '#1e1e1e' : '#222';
        ctx.fillRect(layout.labelWidth, y, width - layout.labelWidth, layout.pxPerSemitone);
      }

      // Grid lines (beats and bars)
      const gridLines = computeGridLines(clip.gesture, layout);
      for (const line of gridLines) {
        ctx.strokeStyle = line.isBar ? '#444' : '#2a2a2a';
        ctx.lineWidth = line.isBar ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(line.x, 0);
        ctx.lineTo(line.x, height);
        ctx.stroke();
      }

      // Pitch labels (left gutter, only C notes and edges)
      ctx.fillStyle = '#666';
      ctx.font = '9px system-ui';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let pitch = layout.minPitch; pitch <= layout.maxPitch; pitch++) {
        if (pitch % 12 === 0 || pitch === layout.minPitch || pitch === layout.maxPitch) {
          const y =
            layout.topPad +
            (layout.maxPitch - pitch) * layout.pxPerSemitone +
            layout.pxPerSemitone / 2;
          ctx.fillText(noteName(pitch), layout.labelWidth - 4, y);
        }
      }

      // Note rectangles
      const rects = computeNoteRects(clip.gesture, clip.harmonic, layout);
      for (const rect of rects) {
        ctx.fillStyle = velocityColor(rect.velocity);
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

        // Subtle border for definition
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }

      // Playhead
      if (isPlaying && playbackTime > 0) {
        const px = timeToX(
          playbackTime,
          clip.bpm,
          clip.gesture.ticks_per_beat,
          layout,
        );
        if (px >= layout.labelWidth && px <= width) {
          ctx.strokeStyle = '#ff6a4a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px, 0);
          ctx.lineTo(px, height);
          ctx.stroke();
        }
      }
    },
    [clip, playbackTime, isPlaying, height],
  );

  // Observe container width for responsive sizing
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) draw(canvas, width);
      }
    });

    observer.observe(container);

    // Initial draw
    const width = container.clientWidth;
    if (width > 0) draw(canvas, width);

    return () => observer.disconnect();
  }, [draw]);

  return (
    <div ref={containerRef} className="mc-piano-roll-container">
      <canvas ref={canvasRef} className="mc-piano-roll-canvas" />
    </div>
  );
}
