/** Mirrors Excalidraw's elements/appState/files shape without depending on the excalidraw package. */
export interface AnnotationScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export function createEmptyAnnotationScene(): AnnotationScene {
  return { elements: [], appState: {}, files: {} };
}
