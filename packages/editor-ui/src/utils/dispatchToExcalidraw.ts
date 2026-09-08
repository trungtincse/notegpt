/** Excalidraw's imperative API has no undo/delete methods, only `history.clear()`
 * (wipes history) and `resetScene()` (wipes the canvas) — neither is "undo one
 * step" or "delete selection" — and no method at all for its Shift+1 zoom-to-fit
 * action. Its keyboard shortcuts do all three, so buttons living outside Excalidraw's
 * own chrome (Toolbar, AnnotationOverlay's Footer zoom-to-fit button) dispatch a
 * synthetic key event at its container to trigger the same internal handlers. */
export function dispatchToExcalidraw(key: string, options: KeyboardEventInit = {}): void {
  const container = document.querySelector<HTMLElement>(".notegpt-annotation-overlay .excalidraw");
  if (!container) return;
  container.focus();
  container.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
}
