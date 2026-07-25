import { ensureMarkdownElements, type Note } from "@notegpt/core";

const INTRO_BLOCK_ID = "welcome-intro";
const STICKY_NOTES_BLOCK_ID = "welcome-sticky-notes";
const TOOLS_BLOCK_ID = "welcome-tools-export";

const MARKDOWN_BY_BLOCK_ID: Record<string, { title: string; markdown: string }> = {
  [INTRO_BLOCK_ID]: {
    title: "Giới thiệu",
    markdown: [
      "# Chào mừng đến với notegpt",
      "",
      "App ghi chú kết hợp **markdown** và **annotation** (vẽ tay trên Excalidraw), dùng để lưu lại và chú thích các câu trả lời từ ChatGPT (hoặc bất kỳ nội dung markdown nào).",
      "",
      "## 3 chế độ xem (đổi ở góc trên bên phải)",
      '- **Markdown** — soạn nội dung text, chia thành nhiều "sticky note" độc lập.',
      "- **Annotation** — vẽ/tô/chú thích trực tiếp lên nội dung.",
      "- **View** — xem lại, chỉ đọc, không vẽ được.",
      "",
      "Xem tiếp ở tab 'Sticky notes' và 'Công cụ vẽ & Export' bên cạnh.",
    ].join("\n"),
  },
  [STICKY_NOTES_BLOCK_ID]: {
    title: "Sticky notes",
    markdown: [
      "# Nhiều ghi chú như sticky note",
      "",
      "Mỗi note (như note này) là 1 block markdown độc lập, hiển thị như 1 tờ sticky note trên canvas ở tab Annotation:",
      "",
      "- Kéo-thả / resize tự do trên canvas.",
      "- Đổi tên tab: double-click vào tên tab ở trên để sửa.",
      "- Xoá 1 note: bấm nút 'x' trên tab, hoặc chọn sticky note trên canvas rồi bấm phím Delete.",
      "- Thêm note mới: bấm nút '+' cạnh các tab.",
      "",
      "Xoá bằng canvas sẽ tự động xoá luôn nội dung text tương ứng — không cần làm 2 bước.",
    ].join("\n"),
  },
  [TOOLS_BLOCK_ID]: {
    title: "Công cụ vẽ & Export",
    markdown: [
      "# Công cụ vẽ (tab Annotation)",
      "",
      "- Select / Hand — chọn, di chuyển, hoặc kéo canvas.",
      "- Pen — vẽ tay tự do.",
      "- Text / Image — chèn chữ hoặc ảnh.",
      "- Highlighter — tô sáng (vàng, mờ) lên nội dung, không xoá được chữ bên dưới.",
      "- Eraser — xoá nét vẽ/annotation. Sticky note (nội dung markdown) không thể bị Eraser xoá nhầm.",
      "- Chọn màu và độ dày nét ở giữa toolbar.",
      "- Undo và Delete selected ở cuối toolbar.",
      "",
      "## Xuất PDF",
      "Menu export sẽ xuất toàn bộ note (mọi sticky note + mọi nét vẽ) ra 1 file PDF vừa đúng 1 trang, không bị cắt hay chia trang.",
    ].join("\n"),
  },
};

const BLOCK_IDS = [INTRO_BLOCK_ID, STICKY_NOTES_BLOCK_ID, TOOLS_BLOCK_ID];

export const WELCOME_NOTE_ID = "welcome-note";

/** The bundled first-launch intro note — not a real user file, so this returns a fresh copy
 * on every call rather than a shared mutable constant. */
export function createWelcomeNote(): Note {
  const elements = ensureMarkdownElements([], BLOCK_IDS);
  return {
    id: WELCOME_NOTE_ID,
    title: "Giới thiệu notegpt",
    markdownBlocks: BLOCK_IDS.map((id) => ({ id, ...MARKDOWN_BY_BLOCK_ID[id] })),
    annotation: { elements, appState: {}, files: {} },
    schemaVersion: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
