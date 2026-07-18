export type EditorMode = "edit" | "annotate";

export interface ModeToggleProps {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="notegpt-mode-toggle" role="tablist" aria-label="Editor mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "edit"}
        className={mode === "edit" ? "active" : ""}
        onClick={() => onChange("edit")}
      >
        Edit
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "annotate"}
        className={mode === "annotate" ? "active" : ""}
        onClick={() => onChange("annotate")}
      >
        Annotate
      </button>
    </div>
  );
}
