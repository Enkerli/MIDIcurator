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
  snapForScissors,
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
  /** Whether scissors mode is active */
  scissorsMode?: boolean;
  /** Existing segmentation boundary tick positions */
  boundaries?: number[];
  /** Called when user clicks to add a boundary in scissors mode */
  onBoundaryAdd?: (tick: number) => void;
  /** Called when user right-clicks or shift-clicks to remove a boundary */
  onBoundaryRemove?: (tick: number) => void;
  /** Called when user drags a boundary to a new position */
  onBoundaryMove?: (fromTick: number, toTick: number) => void;
}

/** Tolerance in pixels for clicking on an existing boundary to remove it. */
const BOUNDARY_HIT_PX = 8;

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
  scissorsMode = false,
  boundaries = [],
  onBoundaryAdd,
  onBoundaryRemove,
  onBoundaryMove,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<PianoRollLayout | null>(null);

  // Transient drag state (refs, not reactive — we redraw manually during drag)
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragCurrentX = useRef(0);

  // Scissors hover state (ref, not reactive — redraw on mousemove)
  const scissorsHoverTick = useRef<number | null>(null);

  // Boundary drag state (for moving existing boundaries)
  const isDraggingBoundary = useRef(false);
  const draggingBoundaryTick = useRef<number | null>(null);
  const draggingBoundaryCurrentTick = useRef<number | null>(null);

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

      // ─── Segmentation boundaries (always rendered when present) ─────
      if (boundaries.length > 0) {
        for (const tick of boundaries) {
          // If this boundary is being dragged, render at drag position instead
          const isBeingDragged = isDraggingBoundary.current && draggingBoundaryTick.current === tick;
          const renderTick = isBeingDragged && draggingBoundaryCurrentTick.current !== null
            ? draggingBoundaryCurrentTick.current
            : tick;

          const bx = layout.labelWidth + renderTick * layout.pxPerTick;
          const alpha = isBeingDragged ? 0.6 : 1;
          // Dashed orange line
          ctx.strokeStyle = isBeingDragged ? `rgba(232, 135, 42, ${alpha})` : '#e8872a';
          ctx.lineWidth = isBeingDragged ? 2 : 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(bx, 0);
          ctx.lineTo(bx, height);
          ctx.stroke();
          ctx.setLineDash([]);

          // Small triangle marker at top
          ctx.fillStyle = isBeingDragged ? `rgba(232, 135, 42, ${alpha})` : '#e8872a';
          ctx.beginPath();
          ctx.moveTo(bx - 4, 0);
          ctx.lineTo(bx + 4, 0);
          ctx.lineTo(bx, 7);
          ctx.closePath();
          ctx.fill();
        }
      }

      // ─── Scissors hover guide line ──────────────────────────────────
      if (scissorsMode && scissorsHoverTick.current !== null) {
        const hx = layout.labelWidth + scissorsHoverTick.current * layout.pxPerTick;
        ctx.strokeStyle = 'rgba(232, 135, 42, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx, height);
        ctx.stroke();
        ctx.setLineDash([]);
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
    [clip, playbackTime, isPlaying, height, selectionRange, scissorsMode, boundaries],
  );

  // ─── Mouse handlers ─────────────────────────────────────────────────

  /**
   * Find an existing boundary near a pixel x position (within BOUNDARY_HIT_PX).
   * Returns the boundary tick or null.
   */
  const findBoundaryNear = useCallback((x: number): number | null => {
    const layout = layoutRef.current;
    if (!layout || boundaries.length === 0) return null;

    for (const tick of boundaries) {
      const bx = layout.labelWidth + tick * layout.pxPerTick;
      if (Math.abs(x - bx) <= BOUNDARY_HIT_PX) return tick;
    }
    return null;
  }, [boundaries]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Ignore clicks in the label gutter
    if (x < layout.labelWidth) return;

    if (scissorsMode) {
      const rawTick = xToTick(x, layout);
      const hitBoundary = findBoundaryNear(x);

      // Shift+click or right-click on existing boundary → remove it
      if (hitBoundary !== null && (e.shiftKey || e.button === 2)) {
        onBoundaryRemove?.(hitBoundary);
        return;
      }

      // Click on existing boundary → start dragging it
      if (hitBoundary !== null) {
        isDraggingBoundary.current = true;
        draggingBoundaryTick.current = hitBoundary;
        draggingBoundaryCurrentTick.current = hitBoundary;
        return;
      }

      // Click on empty space → add new boundary
      const snappedTick = snapForScissors(
        rawTick,
        clip.gesture.onsets,
        clip.gesture.durations,
        clip.gesture.ticks_per_beat,
        e.shiftKey,
      );
      onBoundaryAdd?.(snappedTick);
      return;
    }

    // Normal selection mode
    isDragging.current = true;
    dragStartX.current = x;
    dragCurrentX.current = x;
  }, [scissorsMode, clip.gesture, findBoundaryNear, onBoundaryAdd, onBoundaryRemove]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (scissorsMode) {
      // Boundary drag in progress
      if (isDraggingBoundary.current) {
        const rawTick = xToTick(x, layout);
        draggingBoundaryCurrentTick.current = snapForScissors(
          rawTick,
          clip.gesture.onsets,
          clip.gesture.durations,
          clip.gesture.ticks_per_beat,
          e.shiftKey,
        );
        // Redraw with boundary at new position
        const container = containerRef.current;
        if (container) draw(canvas, container.clientWidth);
        return;
      }

      // Scissors mode: show hover guide line
      if (x < layout.labelWidth) {
        scissorsHoverTick.current = null;
      } else {
        const rawTick = xToTick(x, layout);
        scissorsHoverTick.current = snapForScissors(
          rawTick,
          clip.gesture.onsets,
          clip.gesture.durations,
          clip.gesture.ticks_per_beat,
          e.shiftKey,
        );
      }

      // Redraw with hover guide
      const container = containerRef.current;
      if (container) {
        draw(canvas, container.clientWidth);
      }
      return;
    }

    // Normal selection mode: drag preview
    if (!isDragging.current) return;

    dragCurrentX.current = x;

    // Live preview: redraw base then overlay the drag region
    const container = containerRef.current;
    if (container) {
      draw(canvas, container.clientWidth);

      // Draw temporary drag overlay on top
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const x1 = Math.min(dragStartX.current, dragCurrentX.current);
        const x2 = Math.max(dragStartX.current, dragCurrentX.current);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fillRect(x1, 0, x2 - x1, height);
      }
    }
  }, [scissorsMode, clip.gesture, draw, height]);

  const handleMouseUp = useCallback(() => {
    // Finish boundary drag
    if (isDraggingBoundary.current) {
      isDraggingBoundary.current = false;
      const from = draggingBoundaryTick.current;
      const to = draggingBoundaryCurrentTick.current;
      if (from !== null && to !== null && from !== to) {
        onBoundaryMove?.(from, to);
      }
      draggingBoundaryTick.current = null;
      draggingBoundaryCurrentTick.current = null;
      return;
    }

    if (scissorsMode) return; // Scissors mode uses click, not drag

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
    const noteBounds = collectNoteBoundaries(clip.gesture.onsets, clip.gesture.durations);

    const startTick = snapToNearestBoundary(
      Math.min(rawStart, rawEnd),
      noteBounds,
      clip.gesture.ticks_per_beat,
    );
    const endTick = snapToNearestBoundary(
      Math.max(rawStart, rawEnd),
      noteBounds,
      clip.gesture.ticks_per_beat,
    );

    // Edge case: snapping collapsed the range to zero
    if (startTick === endTick) {
      onRangeSelect(null);
      return;
    }

    onRangeSelect({ startTick, endTick });
  }, [scissorsMode, clip.gesture.onsets, clip.gesture.durations, clip.gesture.ticks_per_beat, onRangeSelect, onBoundaryMove]);

  const handleMouseLeave = useCallback(() => {
    // Cancel any boundary drag on leave
    if (isDraggingBoundary.current) {
      isDraggingBoundary.current = false;
      draggingBoundaryTick.current = null;
      draggingBoundaryCurrentTick.current = null;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) draw(canvas, container.clientWidth);
      return;
    }

    if (scissorsMode) {
      // Clear hover guide
      scissorsHoverTick.current = null;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        draw(canvas, container.clientWidth);
      }
      return;
    }
    // Normal mode: treat as mouseup
    handleMouseUp();
  }, [scissorsMode, draw, handleMouseUp]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (scissorsMode) {
      e.preventDefault(); // Prevent browser context menu in scissors mode
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const hitBoundary = findBoundaryNear(x);
      if (hitBoundary !== null) {
        onBoundaryRemove?.(hitBoundary);
      }
    }
  }, [scissorsMode, findBoundaryNear, onBoundaryRemove]);

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
        className={`mc-piano-roll-canvas ${scissorsMode ? 'mc-piano-roll-canvas--scissors' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}
