import { EditorShell } from "@notegpt/editor-ui";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LocalFsStorageAdapter } from "./adapters/LocalFsStorageAdapter.js";

interface NoteListEntry {
  filePath: string;
  title: string;
  markdown: string;
  annotationText: string;
  updatedAt: string;
}

interface NoteSearchResult {
  entry: NoteListEntry;
  titleMatches: boolean;
  snippet: string | null;
}

const SEARCH_DEBOUNCE_MS = 200;
const SNIPPET_RADIUS = 40;

/** A short excerpt around the first match, so results whose title doesn't match still show *why* they matched. */
function buildSnippet(text: string, query: string): string | null {
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) return null;
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Wraps every case-insensitive occurrence of `query` in `text` with <mark>, preserving the source text's original casing. */
function highlightMatches(text: string, query: string): ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(query, cursor);
  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(<mark key={index}>{text.slice(index, index + query.length)}</mark>);
    cursor = index + query.length;
    index = lowerText.indexOf(query, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteListEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Debounced so fast typing doesn't re-filter/re-render the list on every keystroke;
  // the input itself stays bound to searchInput so typing never feels laggy.
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const adapter = useMemo(() => (folderPath ? new LocalFsStorageAdapter(folderPath) : null), [folderPath]);

  const refreshNotes = useCallback(async () => {
    if (!adapter) return;
    try {
      const summaries = await adapter.listNotes();
      setNotes(
        // `?? ""` guards against a stale main-process build (electron/ipc/fileHandlers.ts
        // changes require a full app restart, not just a renderer reload) still returning
        // summaries without markdown/annotationText — otherwise `.toLowerCase()` below on
        // `undefined` throws during render and blanks the whole window.
        summaries.map((s) => ({
          filePath: s.id,
          title: s.title,
          markdown: s.markdown ?? "",
          annotationText: s.annotationText ?? "",
          updatedAt: s.updatedAt,
        }))
      );
    } catch {
      // The remembered folder may have been moved or deleted since last launch.
      setFolderPath(null);
    }
  }, [adapter]);

  const trimmedQuery = searchQuery.trim().toLowerCase();

  const searchResults = useMemo((): NoteSearchResult[] => {
    if (!trimmedQuery) return notes.map((entry) => ({ entry, titleMatches: false, snippet: null }));
    return notes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(trimmedQuery) ||
          n.markdown.toLowerCase().includes(trimmedQuery) ||
          n.annotationText.toLowerCase().includes(trimmedQuery)
      )
      .map((entry) => {
        const titleMatches = entry.title.toLowerCase().includes(trimmedQuery);
        const snippet = titleMatches ? null : (buildSnippet(entry.markdown, trimmedQuery) ?? buildSnippet(entry.annotationText, trimmedQuery));
        return { entry, titleMatches, snippet };
      });
  }, [notes, trimmedQuery]);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

  useEffect(() => {
    void window.mdnote.getLastFolder().then((lastFolder) => {
      if (lastFolder) setFolderPath(lastFolder);
    });
  }, []);

  const handleOpenFolder = useCallback(async () => {
    const picked = await window.mdnote.pickFolder();
    if (picked) {
      setFolderPath(picked);
      setSelectedFilePath(null);
    }
  }, []);

  const handleNewNote = useCallback(async () => {
    if (!adapter) return;
    // Electron's renderer doesn't support window.prompt(); title comes from the sidebar input instead.
    const title = draftTitle.trim() || "Untitled";
    const note = await adapter.createNote({ title });
    const filePath = adapter.getFilePathForNote(note.id);
    setDraftTitle("");
    await refreshNotes();
    if (filePath) setSelectedFilePath(filePath);
  }, [adapter, draftTitle, refreshNotes]);

  useEffect(() => {
    const offOpenFolder = window.mdnote.onMenuOpenFolder(() => void handleOpenFolder());
    const offNewNote = window.mdnote.onMenuNewNote(() => void handleNewNote());
    return () => {
      offOpenFolder();
      offNewNote();
    };
  }, [handleOpenFolder, handleNewNote]);

  return (
    <div className="notegpt-app">
      <aside className="notegpt-sidebar">
        <button onClick={() => void handleOpenFolder()}>Open Folder…</button>
        <div className="notegpt-new-note-form">
          <input
            type="text"
            placeholder="New note title"
            value={draftTitle}
            disabled={!adapter}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleNewNote();
            }}
          />
          <button onClick={() => void handleNewNote()} disabled={!adapter}>
            New Note
          </button>
        </div>
        <input
          type="search"
          className="notegpt-note-search"
          placeholder="Search notes…"
          value={searchInput}
          disabled={!adapter}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <ul className="notegpt-note-list">
          {searchResults.map(({ entry, titleMatches, snippet }) => (
            <li
              key={entry.filePath}
              className={entry.filePath === selectedFilePath ? "active" : ""}
              onClick={() => setSelectedFilePath(entry.filePath)}
            >
              <div className="notegpt-note-list-title">
                {titleMatches ? highlightMatches(entry.title, trimmedQuery) : entry.title}
              </div>
              {snippet && <div className="notegpt-note-list-snippet">{highlightMatches(snippet, trimmedQuery)}</div>}
            </li>
          ))}
          {adapter && searchResults.length === 0 && (
            <li className="notegpt-note-list-empty">{trimmedQuery ? "No notes match your search." : "No notes yet."}</li>
          )}
        </ul>
      </aside>
      <main className="notegpt-main">
        {adapter && selectedFilePath ? (
          <EditorShell storage={adapter} noteId={selectedFilePath} />
        ) : (
          <div style={{ padding: 24, color: "#888" }}>
            {folderPath ? "Select or create a note." : "Open a folder to get started."}
          </div>
        )}
      </main>
    </div>
  );
}
