import { EditorShell } from "@notegpt/editor-ui";
import { ChevronDown, FolderOpen, MoreHorizontal, Pin, PinOff, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LocalFsStorageAdapter } from "./adapters/LocalFsStorageAdapter.js";
import { NoteSearchModal } from "./NoteSearchModal.js";
import { computeSearchResults, type NoteListEntry } from "./searchNotes.js";

type SectionId = "pinned" | "recents" | "all";

const SEARCH_DEBOUNCE_MS = 200;
const RECENTS_REFRESH_DELAY_MS = 300;

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
    recents: true,
    all: false,
  });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Set alongside selectedFilePath by handleNewNote, read once by the EditorShell it causes to
  // mount (via its initialMode prop) so a brand new, still-empty note opens straight on
  // Annotation instead of Markdown — cleared right after by the effect below so navigating back
  // to that same note later goes back to the normal (content-based) default instead of forcing
  // Annotation forever.
  const [newNoteFilePath, setNewNoteFilePath] = useState<string | null>(null);
  useEffect(() => {
    if (newNoteFilePath) setNewNoteFilePath(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilePath]);
  // Shows the bundled intro note (view mode first) the very first time the app is ever opened,
  // replacing the empty-state placeholder in <main> until the user picks a real note or folder.
  // Persisted via mdnote:getHasSeenWelcome/markWelcomeSeen so it never reappears on later
  // launches once shown. It's seeded to a real .mdnote file in userData (see
  // ensureWelcomeNoteFile) so edits — including annotations — persist like any other note.
  const [showingWelcome, setShowingWelcome] = useState(false);
  const [welcomeFilePath, setWelcomeFilePath] = useState<string | null>(null);
  // folderPath is irrelevant here: the welcome note's address is the absolute file path
  // returned by ensureWelcomeNoteFile, and only loadNote/saveNote (which ignore folderPath)
  // are ever called on this adapter. Reused as the fallback storage for any note opened via
  // an in-note link (see handleOpenNoteLink) before a folder has ever been picked, for the
  // same reason — that path is just as folderPath-agnostic.
  const pathAdapter = useMemo(() => new LocalFsStorageAdapter(""), []);
  const [draftTitle, setDraftTitle] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  // The same note can render in more than one section at once (e.g. pinned + all notes), so
  // "which row is being edited/has its menu open" is keyed by section id + filePath, not just
  // filePath — otherwise every duplicate row would open its input/menu at the same time, and
  // two `autoFocus` rename inputs mounting together would steal focus from each other and
  // fire onBlur/commitRename before the user could type anything.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [openMenuSectionId, setOpenMenuSectionId] = useState<string | null>(null);

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

  const searchResults = useMemo(() => computeSearchResults(notes, trimmedQuery), [notes, trimmedQuery]);

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

  // A window opened via handleOpenNoteLink (see below) is told which note to show through a
  // `?openNote=` query param on its own load URL — main.ts's createWindow sets it — instead of
  // some IPC round-trip, since the window doesn't exist yet at the point the link is clicked.
  useEffect(() => {
    const openNote = new URLSearchParams(window.location.search).get("openNote");
    if (openNote) setSelectedFilePath(openNote);
  }, []);

  useEffect(() => {
    void window.mdnote.getHasSeenWelcome().then(async (seen) => {
      if (seen) return;
      const filePath = await window.mdnote.ensureWelcomeNoteFile();
      setWelcomeFilePath(filePath);
      setShowingWelcome(true);
      void window.mdnote.markWelcomeSeen();
    });
  }, []);

  useEffect(() => {
    if (!openMenuPath) return;
    const closeMenu = () => {
      setOpenMenuPath(null);
      setOpenMenuSectionId(null);
    };
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openMenuPath]);

  const handleOpenFolder = useCallback(async () => {
    const picked = await window.mdnote.pickFolder();
    if (picked) {
      setFolderPath(picked);
      setSelectedFilePath(null);
      setShowingWelcome(false);
    }
  }, []);

  // Help > Guideline — reopens the same bundled intro note first-launch shows, on demand
  // (unlike the first-launch flow, this doesn't touch hasSeenWelcome; it's just "show me that
  // note again", not a first-run event). ensureWelcomeNoteFile() is idempotent — it only seeds
  // the file the very first time it's ever called, so this just resolves its (by-now-existing)
  // path the rest of the time.
  const handleShowGuideline = useCallback(async () => {
    const filePath = await window.mdnote.ensureWelcomeNoteFile();
    setWelcomeFilePath(filePath);
    setSelectedFilePath(null);
    setShowingWelcome(true);
  }, []);

  // Opens in its own window (see main.ts's openNoteInNewWindow/createWindow) rather than
  // replacing the current one, so clicking a link to another note doesn't lose your place in
  // the note you clicked it from.
  const handleOpenNoteLink = useCallback((filePath: string) => {
    void window.mdnote.openNoteInNewWindow(filePath);
  }, []);

  const handleNewNote = useCallback(async () => {
    if (!adapter) return;
    // Electron's renderer doesn't support window.prompt(); title comes from the sidebar input instead.
    const title = draftTitle.trim() || "Untitled";
    const note = await adapter.createNote({ title });
    const filePath = adapter.getFilePathForNote(note.id);
    setDraftTitle("");
    await refreshNotes();
    if (filePath) {
      setNewNoteFilePath(filePath);
      setSelectedFilePath(filePath);
    }
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

  const handleStartRename = useCallback((sectionId: string, filePath: string, currentTitle: string) => {
    setRenamingSectionId(sectionId);
    setRenamingPath(filePath);
    setRenameDraft(currentTitle);
  }, []);

  const commitRename = useCallback(async () => {
    const path = renamingPath;
    const title = renameDraft.trim();
    setRenamingPath(null);
    setRenamingSectionId(null);
    if (!path || !adapter || !title) return;
    const newPath = await adapter.renameNote(path, title);
    await refreshNotes();
    await refreshPinnedAndRecent();
    if (path === selectedFilePath) {
      setSelectedFilePath(newPath);
      setReloadToken((t) => t + 1);
    }
  }, [renamingPath, renameDraft, adapter, refreshNotes, refreshPinnedAndRecent, selectedFilePath]);

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
    const offShowGuideline = window.mdnote.onMenuShowGuideline(() => void handleShowGuideline());
    return () => {
      offOpenFolder();
      offNewNote();
      offShowGuideline();
    };
  }, [handleOpenFolder, handleNewNote, handleShowGuideline]);

  const renderRowActions = (entry: NoteListEntry, sectionId: string) => {
    const isPinned = pinnedSet.has(entry.filePath);
    const menuOpen = openMenuPath === entry.filePath && openMenuSectionId === sectionId;
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
            if (menuOpen) {
              setOpenMenuPath(null);
              setOpenMenuSectionId(null);
            } else {
              setOpenMenuPath(entry.filePath);
              setOpenMenuSectionId(sectionId);
            }
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div className="notegpt-note-more-menu" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="notegpt-note-more-menu-item"
              onClick={() => {
                setOpenMenuPath(null);
                setOpenMenuSectionId(null);
                handleStartRename(sectionId, entry.filePath, entry.title);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="notegpt-note-more-menu-item danger"
              onClick={() => {
                setOpenMenuPath(null);
                setOpenMenuSectionId(null);
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
                setOpenMenuSectionId(null);
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

  const renderNoteRow = (entry: NoteListEntry, titleContent: ReactNode, sectionId: string) => (
    <li
      key={entry.filePath}
      className={entry.filePath === selectedFilePath ? "active" : ""}
      onClick={() => setSelectedFilePath(entry.filePath)}
    >
      <div className="notegpt-note-list-text">
        {renamingPath === entry.filePath && renamingSectionId === sectionId ? (
          <input
            type="text"
            className="notegpt-note-rename-input"
            autoFocus
            value={renameDraft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") {
                setRenamingPath(null);
                setRenamingSectionId(null);
              }
            }}
            onBlur={() => void commitRename()}
          />
        ) : (
          titleContent
        )}
      </div>
      {renderRowActions(entry, sectionId)}
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
            {entries.map((entry) => renderNoteRow(entry, <div className="notegpt-note-list-title">{entry.title}</div>, id))}
            {entries.length === 0 && <li className="notegpt-note-list-empty">No notes yet.</li>}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="notegpt-app">
      <aside className="notegpt-sidebar">
        <button className="notegpt-open-folder-btn" onClick={() => void handleOpenFolder()}>
          <FolderOpen size={16} />
          Open Folder…
        </button>
        {folderPath && (
          <div className="notegpt-current-folder" title={folderPath}>
            {folderPath}
          </div>
        )}
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
          <button onClick={() => void handleNewNote()} disabled={!adapter} title="New Note" aria-label="New Note">
            <Plus size={16} />
          </button>
        </div>
        <button
          type="button"
          className="notegpt-note-search"
          disabled={!adapter}
          onClick={() => setSearchModalOpen(true)}
        >
          <Search size={14} className="notegpt-note-search-icon" />
          <span className="notegpt-note-search-label">{searchInput || "Search notes…"}</span>
        </button>
        {renderSection("pinned", "Pinned", pinnedEntries, true)}
        {renderSection("recents", "Recents", recentEntries, true)}
        {renderSection("all", "All Notes", notes, false)}
      </aside>
      <main className="notegpt-main">
        {selectedFilePath ? (
          // storage is deliberately always pathAdapter, never `adapter` (which is folderPath-
          // scoped and starts null until getLastFolder() resolves): folderPath only matters for
          // createNote/listNotes, neither of which EditorShell ever calls, so there's no reason
          // for its storage prop to change identity after mount. It used to fall back to
          // `adapter ?? pathAdapter`, but `adapter` flipping from null to a real instance
          // shortly after a note-link-opened window mounts made useNoteController build a brand
          // new NoteController mid-load — unsubscribing from the in-flight load right as it was
          // about to resolve, with nothing left to ever call load() again on the new one. That
          // silently stuck the note on its loading state forever, with no error to point at it.
          <EditorShell
            key={`${selectedFilePath}:${reloadToken}`}
            storage={pathAdapter}
            noteId={selectedFilePath}
            initialMode={selectedFilePath === newNoteFilePath ? "annotation" : undefined}
            onOpenNoteLink={handleOpenNoteLink}
            onPickNoteLink={window.mdnote.pickMdnoteFile}
            onReadClipboardUriList={window.mdnote.readClipboardUriList}
          />
        ) : showingWelcome && welcomeFilePath ? (
          <EditorShell
            key="welcome"
            storage={pathAdapter}
            noteId={welcomeFilePath}
            initialMode="view"
            onOpenNoteLink={handleOpenNoteLink}
            onReadClipboardUriList={window.mdnote.readClipboardUriList}
          />
        ) : (
          <div style={{ padding: 24, color: "#888" }}>
            {folderPath ? "Select or create a note." : "Open a folder to get started."}
          </div>
        )}
      </main>
      <NoteSearchModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        results={searchResults}
        trimmedQuery={trimmedQuery}
        selectedFilePath={selectedFilePath}
        onSelectNote={(filePath) => {
          setSelectedFilePath(filePath);
          setSearchModalOpen(false);
          setSearchInput("");
        }}
      />
    </div>
  );
}
