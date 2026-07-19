import { NoteController, type AnnotationScene, type NoteControllerState, type StorageAdapter } from "@notegpt/core";
import { useEffect, useMemo, useState } from "react";

export function useNoteController(storage: StorageAdapter) {
  const controller = useMemo(() => new NoteController(storage), [storage]);
  const [state, setState] = useState<NoteControllerState>(() => controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  return {
    controller,
    note: state.note,
    saveStatus: state.saveStatus,
    load: (id: string) => controller.load(id),
    createNew: (title: string) => controller.createNew(title),
    save: () => controller.save(),
    updateMarkdown: (markdown: string) => controller.updateMarkdown(markdown),
    updateAnnotation: (annotation: AnnotationScene) => controller.updateAnnotation(annotation),
  };
}
