/** Mirrors Excalidraw's elements/appState/files shape without depending on the excalidraw package. */
export interface AnnotationScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  /** The on-screen width (px) of the annotation pane when this scene was last saved.
   * Elements' own x/y/width are stored in scene coordinates, independent of viewport size —
   * but knowing the pane width they were drawn against is what lets a consumer (e.g. PDF
   * export) later tell whether an element sits under the centered text column or extends
   * into the margins beside it, regardless of what size the window happens to be later. */
  paneWidth?: number;
}

export function createEmptyAnnotationScene(): AnnotationScene {
  return { elements: [], appState: {}, files: {} };
}
