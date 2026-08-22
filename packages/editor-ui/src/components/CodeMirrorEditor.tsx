import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { buildMediaLink, detectMediaKind, resolveLocalFilePath } from "@notegpt/core";
import { useEffect, useRef } from "react";
import { debounce } from "../utils/debounce.js";

export interface CodeMirrorEditorProps {
  /** Identifies which note is loaded; content is only pushed into the view when this changes. */
  docId: string;
  initialValue: string;
  editable: boolean;
  onChange: (markdown: string) => void;
  /** Reads the OS clipboard's raw `text/uri-list` payload via Electron's own `clipboard` module
   * (see preload.ts) instead of the DOM `paste` event's `clipboardData` — a fallback for when a
   * file copied from a GNOME/GTK file manager (Nautilus, ...) reaches the DOM event as a `File`
   * with `clipboardData.types` reporting only `"Files"` (no text formats at all) and no `.path`
   * either, even though the OS clipboard genuinely has a `text/uri-list` target (confirmed via
   * GTK's own clipboard API) — see handleMediaPaste's own doc comment. Omitted in contexts with
   * no such bridge (e.g. a future web build), where this fallback just never fires. */
  onReadClipboardUriList?: () => string | null;
}

const CHANGE_DEBOUNCE_MS = 300;

/** No Node `path` module in the renderer — just the last path segment, for the placeholder
 * alt text shown in the raw markdown source (MarkdownPreview's renderer override never reads
 * it; the file itself is located from the link, see buildMediaLink). */
function basename(absolutePath: string): string {
  return absolutePath.split(/[\\/]/).pop() || absolutePath;
}

/** Extensions markdown-it/browsers can actually display as an `<img>` — used only to recognize
 * a *bare* pasted URL as a picture link worth auto-wrapping; deliberately not exhaustive (this
 * is a paste convenience, not a MIME sniff). */
const IMAGE_URL_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif)([?#][^\s]*)?$/i;

/** True only when the *entire* pasted text is one bare image URL, e.g. from a browser's "Copy
 * Image Address" — a paragraph of prose that happens to mention a URL must never be silently
 * rewritten into image syntax. */
function isBareImageUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed) && IMAGE_URL_EXTENSIONS.test(trimmed);
}

function insertAtCursor(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}

/** Mirrors AnnotationOverlay's onPaste media-file detection (same two cases: a real `File` with
 * Electron's `.path` augmentation on Windows/macOS, or a `text/uri-list`/bare-path fallback for
 * Linux file managers that never populate `clipboardData.files` — see resolveLocalFilePath's own
 * doc comment), but inserts markdown syntax into the document instead of an Excalidraw
 * embeddable, since this is a plain text document, not a canvas. Handles, in order:
 *
 * 1. A local image FILE (on disk, found by any of: `File.path`, the DOM `clipboardData`'s own
 *    text formats, or — when neither of those has anything, which is what at least some GTK/
 *    Electron combinations actually do for a Nautilus "Copy" (a `File` with no `.path`, and
 *    `clipboardData.types` reporting only `"Files"`, no text at all) — `onReadClipboardUriList`,
 *    which reads the OS clipboard directly and bypasses Chromium's DOM-level sanitization).
 *    Linked via the same `mdnote-media:` protocol as a local video/audio file (see
 *    mediaProtocol.ts's MIME_TYPES, which now serves image extensions too) rather than read into
 *    a base64 data URL: a link survives editing the note as plain text, doesn't bloat it for a
 *    large photo, and stays consistent with how a local video/audio file is already handled
 *    below. Deliberately has no base64 fallback for a pasted image with no backing file on disk
 *    at all (a raw screenshot/"Copy Image" with nothing to link to) — that case just falls
 *    through unhandled rather than inlining it.
 * 2. A local video/audio file — markdown has no "embed audio/video" syntax of its own;
 *    MarkdownPreview's image-renderer override recognizes this same `mdnote-media:` link shape
 *    and swaps in a real <audio>/<video> element at render time instead of a broken <img>.
 * 3. A bare image URL (e.g. "Copy Image Address") — wrapped into image syntax instead of
 *    landing as plain/autolinked text, so it renders as a picture immediately.
 */
function handleMediaPaste(event: ClipboardEvent, view: EditorView, onReadClipboardUriList?: () => string | null): boolean {
  const pastedFile = event.clipboardData?.files[0] as (File & { path?: string }) | undefined;
  // eslint-disable-next-line no-console
  console.log("[notegpt-debug] paste event v2", {
    types: event.clipboardData?.types,
    pastedFile: pastedFile ? { name: pastedFile.name, type: pastedFile.type, path: pastedFile.path } : null,
    uriList: event.clipboardData?.getData("text/uri-list"),
    plainText: event.clipboardData?.getData("text/plain"),
    hasBridge: typeof onReadClipboardUriList,
    bridgeResult: onReadClipboardUriList?.(),
  });
  const clipboardText = () =>
    event.clipboardData?.getData("text/uri-list") ||
    event.clipboardData?.getData("text/plain") ||
    onReadClipboardUriList?.() ||
    "";

  let imagePath = pastedFile?.path && isImagePath(pastedFile.path) ? pastedFile.path : null;
  if (!imagePath) {
    const resolvedPath = resolveLocalFilePath(clipboardText());
    if (resolvedPath && isImagePath(resolvedPath)) imagePath = resolvedPath;
  }
  if (imagePath) {
    event.preventDefault();
    insertAtCursor(view, `![${basename(imagePath)}](${buildMediaLink(imagePath)})`);
    return true;
  }

  let mediaPath = pastedFile?.path ?? null;
  let mediaKind = mediaPath ? detectMediaKind(mediaPath, pastedFile?.type ?? "") : null;
  if (!mediaKind) {
    const resolvedPath = resolveLocalFilePath(clipboardText());
    if (resolvedPath) {
      const kind = detectMediaKind(resolvedPath, "");
      if (kind) {
        mediaPath = resolvedPath;
        mediaKind = kind;
      }
    }
  }
  if (mediaPath && mediaKind) {
    event.preventDefault();
    insertAtCursor(view, `![${mediaKind}: ${basename(mediaPath)}](${buildMediaLink(mediaPath)})`);
    return true;
  }

  const pastedText = event.clipboardData?.getData("text/plain") ?? "";
  if (isBareImageUrl(pastedText)) {
    event.preventDefault();
    insertAtCursor(view, `![](${pastedText.trim()})`);
    return true;
  }

  return false;
}

export function CodeMirrorEditor({ docId, initialValue, editable, onChange, onReadClipboardUriList }: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadClipboardUriListRef = useRef(onReadClipboardUriList);
  onReadClipboardUriListRef.current = onReadClipboardUriList;

  useEffect(() => {
    if (!hostRef.current) return;

    const debouncedOnChange = debounce((doc: string) => onChangeRef.current(doc), CHANGE_DEBOUNCE_MS);

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        EditorView.lineWrapping,
        editableCompartment.current.of(EditorView.editable.of(editable)),
        EditorView.domEventHandlers({ paste: (event, view) => handleMediaPaste(event, view, onReadClipboardUriListRef.current) }),
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
