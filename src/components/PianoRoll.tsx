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
  xToTick,
  collectNoteBoundaries,
  snapToNearestBoundary,
  isMinimumDrag,
} from '../lib/piano-roll';
import type { PianoRollLayout, TickRange } from '../lib/piano-roll';

interface PianoRollProps {
  clip: Clip;
  /** Current playback time in seconds (0 when stopped) */
  playbackTime: number;
  /** Whether playback is active (controls playhead visibility) */
  isPlaying: boolean;
  /** Canvas height in CSS pixels */
  height?: number;
  /** Snapped tick range to highlight (null = no selection) */
  selectionRange: TickRange | null;
  /** Called when user completes a drag selection or clicks to clear */
  onRangeSelect: (range: TickRange | null) => void;
}

/**
 * Read CSS custom properties from the document root for canvas rendering.
 * Falls back to dark-theme defaults if properties are not set.
 */
function getThemeColors(): {
  bg: string;
  laneDark: string;
  laneLight: string;
  gridBar: string;
  gridBeat: string;
  label: string;
  noteBorder: string;
} {
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue('--mc-piano-bg').trim() || '#181818',
    laneDark: style.getPropertyValue('--mc-piano-lane-dark').trim() || '#1e1e1e',
    laneLight: style.getPropertyValue('--mc-piano-lane-light').trim() || '#222',
    gridBar: style.getPropertyValue('--mc-piano-grid-bar').trim() || '#444',
    gridBeat: style.getPropertyValue('--mc-piano-grid-beat').trim() || '#2a2a2a',
    label: style.getPropertyValue('--mc-piano-label').trim() || '#666',
    noteBorder: style.getPropertyValue('--mc-text').trim()?.replace(')', ', 0.1)').replace('rgb(', 'rgba(') || 'rgba(255,255,255,0.1)',
  };
}

export function PianoRoll({
  clip,
  playbackTime,
  isPlaying,
  height = 240,
  selectionRange,
  onRangeSelect,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<PianoRollLayout | null>(null);

  // Transient drag state (refs, not reactive — we redraw manually during drag)
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragCurrentX = useRef(0);

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

      const theme = getThemeColors();
      const layout = computeLayout(clip.gesture, clip.harmonic, width, height);
      layoutRef.current = layout;

      // Background
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, width, height);

      // Piano key lanes (horizontal stripes for each pitch)
      for (let pitch = layout.minPitch; pitch <= layout.maxPitch; pitch++) {
        const y =
          layout.topPad + (layout.maxPitch - pitch) * layout.pxPerSemitone;
        ctx.fillStyle = isBlackKey(pitch) ? theme.laneDark : theme.laneLight;
        ctx.fillRect(layout.labelWidth, y, width - layout.labelWidth, layout.pxPerSemitone);
      }

      // Grid lines (beats and bars)
      const gridLines = computeGridLines(clip.gesture, layout);
      for (const line of gridLines) {
        ctx.strokeStyle = line.isBar ? theme.gridBar : theme.gridBeat;
        ctx.lineWidth = line.isBar ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(line.x, 0);
        ctx.lineTo(line.x, height);
        ctx.stroke();
      }

      // Bar number labels (top of each bar line)
      ctx.fillStyle = theme.label;
      ctx.font = '9px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (const line of gridLines) {
        if (line.isBar) {
          ctx.fillText(line.label, line.x + 3, 2);
        }
      }

      // Pitch labels (left gutter, only C notes and edges)
      ctx.fillStyle = theme.label;
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
        ctx.strokeStyle = 'rgba(128,128,128,0.2)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }

      // Selection overlay (finalized selection from prop)
      if (selectionRange) {
        const x1 = layout.labelWidth + selectionRange.startTick * layout.pxPerTick;
        const x2 = layout.labelWidth + selectionRange.endTick * layout.pxPerTick;
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fillRect(x1, 0, x2 - x1, height);

        // Edge lines
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, 0); ctx.lineTo(x1, height);
        ctx.moveTo(x2, 0); ctx.lineTo(x2, height);
        ctx.stroke();
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
    [clip, playbackTime, isPlaying, height, selectionRange],
  );

  // ─── Mouse handlers for drag selection ─────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Ignore clicks in the label gutter
    if (x < layout.labelWidth) return;

    isDragging.current = true;
    dragStartX.current = x;
    dragCurrentX.current = x;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;

    const rect = canvas.getBoundingClientRect();
    dragCurrentX.current = e.clientX - rect.left;

    // Live preview: redraw base then overlay the drag region
    const container = containerRef.current;
    if (container) {
      draw(canvas, container.clientWidth);

      // Draw temporary drag overlay on top
      // Context is already in CSS-pixel space after draw() applies ctx.scale(dpr, dpr)
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const x1 = Math.min(dragStartX.current, dragCurrentX.current);
        const x2 = Math.max(dragStartX.current, dragCurrentX.current);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fillRect(x1, 0, x2 - x1, height);
      }
    }
  }, [draw, height]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;

    const layout = layoutRef.current;
    if (!layout) return;

    const rawStart = xToTick(dragStartX.current, layout);
    const rawEnd = xToTick(dragCurrentX.current, layout);

    // Minimum drag check — tiny drags treated as click → clear selection
    if (!isMinimumDrag(rawStart, rawEnd, clip.gesture.ticks_per_beat)) {
      onRangeSelect(null);
      return;
    }

    // Collect note boundaries for snap-to-note functionality
    const boundaries = collectNoteBoundaries(clip.gesture.onsets, clip.gesture.durations);

    const startTick = snapToNearestBoundary(
      Math.min(rawStart, rawEnd),
      boundaries,
      clip.gesture.ticks_per_beat,
    );
    const endTick = snapToNearestBoundary(
      Math.max(rawStart, rawEnd),
      boundaries,
      clip.gesture.ticks_per_beat,
    );

    // Edge case: snapping collapsed the range to zero
    if (startTick === endTick) {
      onRangeSelect(null);
      return;
    }

    onRangeSelect({ startTick, endTick });
  }, [clip.gesture.onsets, clip.gesture.durations, clip.gesture.ticks_per_beat, onRangeSelect]);

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
      <canvas
        ref={canvasRef}
        className="mc-piano-roll-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
