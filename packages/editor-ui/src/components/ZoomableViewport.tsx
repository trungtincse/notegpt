import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

export interface ZoomableViewportProps {
  children: ReactNode;
  minScale?: number;
  maxScale?: number;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const DEFAULT_MIN_SCALE = 0.5;
const DEFAULT_MAX_SCALE = 3;
/** Tuned so one mouse-wheel tick (~100 deltaY) or a trackpad pinch step feels like a smooth, gradual zoom. */
const ZOOM_SENSITIVITY = 0.0015;
const BUTTON_ZOOM_FACTOR = 1.2;

const IDENTITY_TRANSFORM: Transform = { scale: 1, x: 0, y: 0 };

/**
 * Pans and zooms its children as a single flat surface via CSS transform,
 * instead of native scrolling. That's what keeps rendered markdown text and
 * the annotations drawn on top of it moving and scaling together as one
 * image, rather than as two independently-scrollable/zoomable layers.
 *
 * The wheel listener is attached natively with `capture: true`, not via
 * React's onWheel: React's synthetic wheel handler is passive by default, so
 * calling preventDefault() there is a silent no-op — and capture is needed
 * so this sees the event (and can stop it) before Excalidraw's own listener
 * further down the tree does, which would otherwise pan/zoom just the
 * annotation canvas out of sync with the text underneath.
 */
export function ZoomableViewport({ children, minScale = DEFAULT_MIN_SCALE, maxScale = DEFAULT_MAX_SCALE }: ZoomableViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const clampTransform = useCallback((next: Transform): Transform => {
    const container = containerRef.current;
    const surface = surfaceRef.current;
    if (!container || !surface) return next;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    // offsetWidth/Height reflect layout size, unaffected by the transform applied to this
    // same element, so they're the surface's natural (unscaled) size regardless of zoom.
    const scaledWidth = surface.offsetWidth * next.scale;
    const scaledHeight = surface.offsetHeight * next.scale;

    const clampAxis = (value: number, containerSize: number, scaledSize: number) => {
      if (scaledSize <= containerSize) return (containerSize - scaledSize) / 2;
      return Math.min(0, Math.max(containerSize - scaledSize, value));
    };

    return {
      scale: next.scale,
      x: clampAxis(next.x, containerWidth, scaledWidth),
      y: clampAxis(next.y, containerHeight, scaledHeight),
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!event.ctrlKey && !event.metaKey) {
        setTransform((current) => clampTransform({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
        return;
      }

      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      setTransform((current) => {
        const nextScale = Math.min(maxScale, Math.max(minScale, current.scale * Math.exp(-event.deltaY * ZOOM_SENSITIVITY)));
        // Keep the point under the cursor fixed on screen while the scale changes.
        const contentX = (pointerX - current.x) / current.scale;
        const contentY = (pointerY - current.y) / current.scale;
        return clampTransform({ scale: nextScale, x: pointerX - contentX * nextScale, y: pointerY - contentY * nextScale });
      });
    };

    container.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => container.removeEventListener("wheel", onWheel, { capture: true });
  }, [clampTransform, minScale, maxScale]);

  const zoomBy = useCallback(
    (factor: number) => {
      setTransform((current) => {
        const nextScale = Math.min(maxScale, Math.max(minScale, current.scale * factor));
        const container = containerRef.current;
        const centerX = container ? container.clientWidth / 2 : 0;
        const centerY = container ? container.clientHeight / 2 : 0;
        const contentX = (centerX - current.x) / current.scale;
        const contentY = (centerY - current.y) / current.scale;
        return clampTransform({ scale: nextScale, x: centerX - contentX * nextScale, y: centerY - contentY * nextScale });
      });
    },
    [clampTransform, minScale, maxScale]
  );

  const reset = useCallback(() => setTransform(() => clampTransform(IDENTITY_TRANSFORM)), [clampTransform]);

  // Excalidraw's own drag-to-pan is disabled in view mode (AnnotationOverlay goes
  // pointer-events: none there), so this is the only way to pan by dragging — without
  // it, dragging would either do nothing or (worse, if Excalidraw ever regains pointer
  // input) move just the annotation canvas, not the markdown text underneath it.
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: transform.x, originY: transform.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    },
    [transform.x, transform.y]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setTransform((current) =>
        clampTransform({ ...current, x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) })
      );
    },
    [clampTransform]
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  return (
    <div
      className={`notegpt-zoom-viewport${isDragging ? " notegpt-zoom-viewport--dragging" : ""}`}
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="notegpt-zoom-surface"
        ref={surfaceRef}
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      >
        {children}
      </div>
      <div className="notegpt-zoom-controls">
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)}>
          −
        </button>
        <button type="button" title="Reset zoom" aria-label="Reset zoom" onClick={reset}>
          {Math.round(transform.scale * 100)}%
        </button>
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)}>
          +
        </button>
      </div>
    </div>
  );
}
