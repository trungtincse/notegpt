import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { debounce } from "../utils/debounce.js";

export interface CodeMirrorEditorProps {
  /** Identifies which note is loaded; content is only pushed into the view when this changes. */
  docId: string;
  initialValue: string;
  editable: boolean;
  onChange: (markdown: string) => void;
}

const CHANGE_DEBOUNCE_MS = 300;

export function CodeMirrorEditor({ docId, initialValue, editable, onChange }: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const debouncedOnChange = debounce((doc: string) => onChangeRef.current(doc), CHANGE_DEBOUNCE_MS);

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        editableCompartment.current.of(EditorView.editable.of(editable)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) debouncedOnChange(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally re-create the view only when the note identity changes.
  }, [docId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: editableCompartment.current.reconfigure(EditorView.editable.of(editable)) });
  }, [editable]);

  return <div ref={hostRef} className="notegpt-codemirror-editor" />;
}
