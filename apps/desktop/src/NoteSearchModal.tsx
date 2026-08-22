import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatRelativeDate, highlightMatches, type NoteSearchResult } from "./searchNotes.js";

export interface NoteSearchModalProps {
  open: boolean;
  onClose: () => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  results: NoteSearchResult[];
  trimmedQuery: string;
  selectedFilePath: string | null;
  onSelectNote: (filePath: string) => void;
}

/** Centered search modal (Ctrl+F-style overlay, not the inline sidebar list this replaces) —
 * opened by clicking the sidebar's search box (see App.tsx), which hands off actual typing to
 * this component's own input so it can autofocus the moment the modal appears. */
export function NoteSearchModal({
  open,
  onClose,
  searchInput,
  onSearchInputChange,
  results,
  trimmedQuery,
  selectedFilePath,
  onSelectNote,
}: NoteSearchModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes regardless of which element inside the modal has focus — the sidebar's own
  // note-list rows have no such handler to conflict with since this is a separate overlay.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="notegpt-search-modal-backdrop" onClick={onClose}>
      <div className="notegpt-search-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notegpt-search-modal-header">
          <Search size={16} className="notegpt-search-modal-icon" />
          <input
            ref={inputRef}
            type="text"
            className="notegpt-search-modal-input"
            placeholder="Search notes…"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
          />
          {searchInput && (
            <button type="button" className="notegpt-search-modal-clear" onClick={() => onSearchInputChange("")}>
              Clear
            </button>
          )}
          <button type="button" className="notegpt-search-modal-close" aria-label="Close search" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <ul className="notegpt-search-modal-results">
          {results.length === 0 ? (
            <li className="notegpt-search-modal-empty">{trimmedQuery ? "No notes match your search." : "Type to search your notes."}</li>
          ) : (
            results.map(({ entry, titleMatches, snippet }) => (
              <li
                key={entry.filePath}
                className={entry.filePath === selectedFilePath ? "active" : ""}
                onClick={() => onSelectNote(entry.filePath)}
              >
                <div className="notegpt-search-modal-result-text">
                  <div className="notegpt-search-modal-result-title">
                    {titleMatches ? highlightMatches(entry.title, trimmedQuery) : entry.title}
                  </div>
                  {snippet && <div className="notegpt-search-modal-result-snippet">{highlightMatches(snippet, trimmedQuery)}</div>}
                </div>
                <div className="notegpt-search-modal-result-date">{formatRelativeDate(entry.updatedAt)}</div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
