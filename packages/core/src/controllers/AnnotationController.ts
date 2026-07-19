import type { AnnotationScene } from "../model/AnnotationScene.js";
import type { NoteController } from "./NoteController.js";

interface ElementLike {
  fileId?: string | null;
  isDeleted?: boolean;
}

/** Drops entries from `files` that no longer have a live (non-deleted) element referencing them. */
export function gcUnreferencedFiles(scene: AnnotationScene): AnnotationScene {
  const liveFileIds = new Set(
    (scene.elements as ElementLike[])
      .filter((el) => !el.isDeleted && el.fileId)
      .map((el) => el.fileId as string)
  );
  const files = Object.fromEntries(
    Object.entries(scene.files).filter(([fileId]) => liveFileIds.has(fileId))
  );
  return { ...scene, files };
}

export class AnnotationController {
  constructor(private readonly noteController: NoteController) {}

  updateScene(elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>, paneWidth: number): void {
    const scene = gcUnreferencedFiles({ elements, appState, files, paneWidth });

    // Excalidraw's onChange fires continuously even without user interaction
    // (internal appState churn). Skip the update entirely when nothing the app
    // actually persists has changed, or every idle tick would mark the note
    // dirty and re-trigger autosave forever.
    const current = this.noteController.getState().note?.annotation;
    if (current && JSON.stringify(current) === JSON.stringify(scene)) return;

    this.noteController.updateAnnotation(scene);
  }
}
