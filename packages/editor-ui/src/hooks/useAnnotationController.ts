import { AnnotationController, type NoteController } from "@notegpt/core";
import { useMemo } from "react";

export function useAnnotationController(noteController: NoteController) {
  const controller = useMemo(() => new AnnotationController(noteController), [noteController]);

  return {
    updateScene: (elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) =>
      controller.updateScene(elements, appState, files),
  };
}
