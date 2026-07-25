<p align="center">
  <img src="logo.svg" alt="notegpt logo" width="220" />
</p>

<h1 align="center">notegpt</h1>

<p align="center">
  Ứng dụng ghi chú markdown kết hợp chú thích vẽ tay — nơi lưu lại và note lại các câu trả lời từ ChatGPT (hoặc bất kỳ nội dung nào bạn muốn).
</p>

## Download

Tải bản mới nhất cho Linux (`.deb`, AppImage) và Windows (`.exe`) ở **[Releases](https://github.com/trungtincse/notegpt/releases/latest)**.

## Tính năng

- **Nhiều sticky note trong 1 note** — mỗi note chứa nhiều block markdown độc lập, hiển thị như các tờ giấy dán trên canvas: kéo-thả, resize tự do, đổi tên, thêm/xoá tuỳ ý.
- **3 chế độ xem**
  - **Markdown** — soạn nội dung, quản lý các sticky note qua tab bar.
  - **Annotation** — vẽ tay, tô sáng, chèn chữ/ảnh trực tiếp lên nội dung bằng canvas [Excalidraw](https://excalidraw.com/).
  - **View** — xem lại, chỉ đọc.
- **Bộ công cụ vẽ** — Select/Hand, Pen, Text, Image, Highlighter (tô sáng không xoá chữ), Eraser (không xoá nhầm sticky note), Undo, chọn màu/độ dày nét.
- **Xuất PDF** — xuất cả note (mọi sticky note + mọi nét vẽ) ra 1 file PDF vừa đúng 1 trang.
- **Tự động lưu vị trí/zoom** — mở lại note sẽ đúng góc nhìn như lần trước.
- **Lưu file cục bộ** — mỗi note là 1 file `.mdnote` trên máy, không phụ thuộc cloud.

## Bắt đầu

Yêu cầu: Node.js **22.13+**, [pnpm](https://pnpm.io/) (repo dùng `pnpm@11.14.0`, xem field `packageManager`).

```bash
pnpm install
pnpm dev:desktop
```

## Build ứng dụng

```bash
pnpm build                                    # build các package dùng chung (core, editor-ui)
pnpm --filter @notegpt/desktop dist           # AppImage + .deb (Linux)
pnpm --filter @notegpt/desktop dist:win       # .exe (Windows, cần chạy trên máy Windows hoặc CI)
```

Bản build chính thức cho các nền tảng được tạo tự động qua GitHub Actions (`.github/workflows/build-desktop.yml`) mỗi khi push một tag dạng `vX.Y.Z`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Tải kết quả build ở tab **Actions** của repo.

## Cấu trúc

Monorepo quản lý bằng pnpm workspaces:

```
apps/desktop      Ứng dụng Electron (main/preload/renderer)
packages/core     Model dữ liệu note, validation, controllers — không phụ thuộc UI
packages/editor-ui  Component React dùng chung (Excalidraw overlay, toolbar, editor shell)
```

## Công nghệ

Electron · React · TypeScript · [Excalidraw](https://excalidraw.com/) · Vite (`electron-vite`) · electron-builder
