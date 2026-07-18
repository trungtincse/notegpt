import { EditorShell } from "@notegpt/editor-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalFsStorageAdapter } from "./adapters/LocalFsStorageAdapter.js";

interface NoteListEntry {
  filePath: string;
  title: string;
  updatedAt: string;
}

export function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteListEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const adapter = useMemo(() => (folderPath ? new LocalFsStorageAdapter(folderPath) : null), [folderPath]);

  const refreshNotes = useCallback(async () => {
    if (!adapter) return;
    const summaries = await adapter.listNotes();
    setNotes(summaries.map((s) => ({ filePath: s.id, title: s.title, updatedAt: s.updatedAt })));
  }, [adapter]);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

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
        <ul className="notegpt-note-list">
          {notes.map((n) => (
            <li
              key={n.filePath}
              className={n.filePath === selectedFilePath ? "active" : ""}
              onClick={() => setSelectedFilePath(n.filePath)}
            >
              {n.title}
            </li>
          ))}
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
