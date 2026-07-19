import { EditorShell } from "@notegpt/editor-ui";
import { ChevronDown, MoreHorizontal, Pin, PinOff } from "lucide-react";
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

type SectionId = "pinned" | "recents" | "all";

const SEARCH_DEBOUNCE_MS = 200;
const SNIPPET_RADIUS = 40;
const RECENTS_REFRESH_DELAY_MS = 300;

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

/** Orders `notes` by `paths` (most-relevant-first), dropping any path with no matching note
 * (a pinned/recent path from a different folder, or one whose file was since deleted). */
function orderByPathList(notes: NoteListEntry[], paths: string[]): NoteListEntry[] {
  const byPath = new Map(notes.map((n) => [n.filePath, n]));
  const ordered: NoteListEntry[] = [];
  for (const path of paths) {
    const entry = byPath.get(path);
    if (entry) ordered.push(entry);
  }
  return ordered;
}

export function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteListEntry[]>([]);
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionId, boolean>>({
    pinned: false,
    recents: false,
    all: false,
  });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [draftTitle, setDraftTitle] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);

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

  const refreshPinnedAndRecent = useCallback(async () => {
    const [pinned, recent] = await Promise.all([window.mdnote.getPinnedFiles(), window.mdnote.getRecentFiles()]);
    setPinnedPaths(pinned);
    setRecentPaths(recent);
  }, []);

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

  const pinnedEntries = useMemo(() => orderByPathList(notes, pinnedPaths), [notes, pinnedPaths]);
  const pinnedSet = useMemo(() => new Set(pinnedPaths), [pinnedPaths]);
  const recentEntries = useMemo(
    () => orderByPathList(notes, recentPaths).filter((entry) => !pinnedSet.has(entry.filePath)),
    [notes, recentPaths, pinnedSet]
  );

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

  useEffect(() => {
    void refreshPinnedAndRecent();
  }, [refreshPinnedAndRecent]);

  // The main process records "recently opened" as a side effect of EditorShell loading a
  // note (readNote IPC), which App.tsx has no direct hook into — poll for it shortly after
  // selection instead of threading a callback through the editor.
  useEffect(() => {
    if (!selectedFilePath) return;
    const timer = setTimeout(() => void refreshPinnedAndRecent(), RECENTS_REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [selectedFilePath, refreshPinnedAndRecent]);

  useEffect(() => {
    void window.mdnote.getLastFolder().then((lastFolder) => {
      if (lastFolder) setFolderPath(lastFolder);
    });
  }, []);

  useEffect(() => {
    if (!openMenuPath) return;
    const closeMenu = () => setOpenMenuPath(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openMenuPath]);

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

  const handleDeleteNote = useCallback(
    async (filePath: string, title: string) => {
      if (!adapter) return;
      // window.confirm() works fine in Electron's renderer (unlike window.prompt(), see above).
      if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
      await adapter.deleteNote(filePath);
      if (selectedFilePath === filePath) setSelectedFilePath(null);
      await refreshNotes();
      await refreshPinnedAndRecent();
    },
    [adapter, selectedFilePath, refreshNotes, refreshPinnedAndRecent]
  );

  const handleTogglePin = useCallback(async (filePath: string) => {
    const updated = await window.mdnote.togglePinnedFile(filePath);
    setPinnedPaths(updated);
  }, []);

  const handleStartRename = useCallback((filePath: string, currentTitle: string) => {
    setRenamingPath(filePath);
    setRenameDraft(currentTitle);
  }, []);

  const commitRename = useCallback(async () => {
    const path = renamingPath;
    const title = renameDraft.trim();
    setRenamingPath(null);
    if (!path || !adapter || !title) return;
    await adapter.renameNote(path, title);
    await refreshNotes();
    if (path === selectedFilePath) setReloadToken((t) => t + 1);
  }, [renamingPath, renameDraft, adapter, refreshNotes, selectedFilePath]);

  const handleExportPdf = useCallback(
    (filePath: string, title: string) => {
      if (!folderPath) return;
      void window.mdnote.exportNotePdf(folderPath, filePath, title);
    },
    [folderPath]
  );

  const toggleSection = useCallback((id: SectionId) => {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  useEffect(() => {
    const offOpenFolder = window.mdnote.onMenuOpenFolder(() => void handleOpenFolder());
    const offNewNote = window.mdnote.onMenuNewNote(() => void handleNewNote());
    return () => {
      offOpenFolder();
      offNewNote();
    };
  }, [handleOpenFolder, handleNewNote]);

  const renderRowActions = (entry: NoteListEntry) => {
    const isPinned = pinnedSet.has(entry.filePath);
    return (
      <div className="notegpt-note-list-actions">
        <button
          type="button"
          className={`notegpt-note-pin-btn${isPinned ? " pinned" : ""}`}
          title={isPinned ? "Unpin" : "Pin"}
          aria-label={isPinned ? `Unpin "${entry.title}"` : `Pin "${entry.title}"`}
          onClick={(e) => {
            e.stopPropagation();
            void handleTogglePin(entry.filePath);
          }}
        >
          {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button
          type="button"
          className="notegpt-note-more-btn"
          title="More"
          aria-label={`More actions for "${entry.title}"`}
          onClick={(e) => {
            e.stopPropagation();
            setOpenMenuPath((current) => (current === entry.filePath ? null : entry.filePath));
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        {openMenuPath === entry.filePath && (
          <div className="notegpt-note-more-menu" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="notegpt-note-more-menu-item"
              onClick={() => {
                setOpenMenuPath(null);
                handleStartRename(entry.filePath, entry.title);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="notegpt-note-more-menu-item danger"
              onClick={() => {
                setOpenMenuPath(null);
                void handleDeleteNote(entry.filePath, entry.title);
              }}
            >
              Delete
            </button>
            <button
              type="button"
              className="notegpt-note-more-menu-item"
              onClick={() => {
                setOpenMenuPath(null);
                handleExportPdf(entry.filePath, entry.title);
              }}
            >
              Export PDF
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderNoteRow = (entry: NoteListEntry, titleContent: ReactNode) => (
    <li
      key={entry.filePath}
      className={entry.filePath === selectedFilePath ? "active" : ""}
      onClick={() => setSelectedFilePath(entry.filePath)}
    >
      <div className="notegpt-note-list-text">
        {renamingPath === entry.filePath ? (
          <input
            type="text"
            className="notegpt-note-rename-input"
            autoFocus
            value={renameDraft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setRenamingPath(null);
            }}
            onBlur={() => void commitRename()}
          />
        ) : (
          titleContent
        )}
      </div>
      {renderRowActions(entry)}
    </li>
  );

  const renderSection = (id: SectionId, label: string, entries: NoteListEntry[], hideWhenEmpty: boolean) => {
    if (hideWhenEmpty && entries.length === 0) return null;
    const collapsed = collapsedSections[id];
    return (
      <div className="notegpt-note-section" key={id}>
        <button
          type="button"
          className={`notegpt-note-section-header${collapsed ? " collapsed" : ""}`}
          onClick={() => toggleSection(id)}
        >
          <ChevronDown size={14} className="notegpt-note-section-header-icon" />
          {label}
        </button>
        {!collapsed && (
          <ul className="notegpt-note-list">
            {entries.map((entry) => renderNoteRow(entry, <div className="notegpt-note-list-title">{entry.title}</div>))}
            {entries.length === 0 && <li className="notegpt-note-list-empty">No notes yet.</li>}
          </ul>
        )}
      </div>
    );
  };

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
        {trimmedQuery ? (
          <ul className="notegpt-note-list">
            {searchResults.map(({ entry, titleMatches, snippet }) =>
              renderNoteRow(
                entry,
                <>
                  <div className="notegpt-note-list-title">
                    {titleMatches ? highlightMatches(entry.title, trimmedQuery) : entry.title}
                  </div>
                  {snippet && <div className="notegpt-note-list-snippet">{highlightMatches(snippet, trimmedQuery)}</div>}
                </>
              )
            )}
            {adapter && searchResults.length === 0 && <li className="notegpt-note-list-empty">No notes match your search.</li>}
          </ul>
        ) : (
          <>
            {renderSection("pinned", "Pinned", pinnedEntries, true)}
            {renderSection("recents", "Recents", recentEntries, true)}
            {renderSection("all", "All Notes", notes, false)}
          </>
        )}
      </aside>
      <main className="notegpt-main">
        {adapter && selectedFilePath ? (
          <EditorShell key={`${selectedFilePath}:${reloadToken}`} storage={adapter} noteId={selectedFilePath} />
        ) : (
          <div style={{ padding: 24, color: "#888" }}>
            {folderPath ? "Select or create a note." : "Open a folder to get started."}
          </div>
        )}
      </main>
    </div>
  );
}
