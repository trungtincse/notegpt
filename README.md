<div align="center">

![NoteGPT logo](apps/desktop/build/icons/128x128.png)

</div>

# Chào mừng đến với NoteGPT

**NoteGPT** là ứng dụng ghi chú được thiết kế để giúp bạn **lưu trữ, tổ chức và chú thích kiến thức** một cách trực quan. Ứng dụng đặc biệt phù hợp để lưu lại các câu trả lời từ ChatGPT, tài liệu kỹ thuật, bài viết hoặc bất kỳ nội dung nào ở định dạng **Markdown**. 

Không giống các ứng dụng ghi chú truyền thống, NoteGPT kết hợp **Markdown** và **Annotation** trong cùng một không gian làm việc. Bạn có thể vừa soạn thảo nội dung, vừa đánh dấu, khoanh vùng hoặc ghi chú trực tiếp lên nội dung đó mà không cần chuyển sang ứng dụng khác.

## Những gì bạn có thể làm

* 📝 Soạn thảo ghi chú bằng Markdown với đầy đủ các định dạng như tiêu đề, danh sách, bảng, liên kết, hình ảnh và khối mã nguồn.
* 📌 Chia một tài liệu thành nhiều **sticky note** độc lập để sắp xếp thông tin theo từng chủ đề hoặc ý tưởng.
* ✏️ Đánh dấu, tô sáng, khoanh vùng và thêm chú thích trực tiếp lên nội dung để làm nổi bật những phần quan trọng.
* 💡 Lưu lại các câu trả lời từ ChatGPT và bổ sung ghi chú cá nhân ngay trên cùng một tài liệu.
* 📚 Xem lại toàn bộ ghi chú bất cứ lúc nào trong chế độ chỉ đọc.
## Download
Tải bản mới nhất cho Linux (`.deb`, AppImage) và Windows (`.exe`) ở **[Releases](https://github.com/trungtincse/notegpt/releases/latest)**. 

---

# Ba chế độ làm việc

Bạn có thể chuyển đổi giữa các chế độ bằng nút ở góc trên bên phải.

## 📝 Markdown

Đây là nơi bạn tạo và chỉnh sửa nội dung.

Trong chế độ này, bạn có thể:

* Viết hoặc dán nội dung Markdown.
* Tạo nhiều **sticky note** trong cùng một tài liệu.
* Chỉnh sửa, sắp xếp hoặc xoá từng sticky note.
* Chuẩn bị nội dung trước khi bắt đầu chú thích.

## ✏️ Annotation

Sau khi hoàn thành nội dung, chuyển sang **Annotation** để ghi chú trực tiếp lên tài liệu.

Bạn có thể:

* Vẽ tự do.
* Tô sáng nội dung quan trọng.
* Khoanh tròn hoặc đánh dấu các đoạn cần chú ý.
* Thêm ghi chú trực quan để dễ xem lại sau này.

Mọi annotation sẽ được lưu cùng với tài liệu.

## 👀 View

Chế độ **View** dành cho việc đọc lại.

Trong chế độ này:

* Nội dung được hiển thị ở chế độ chỉ đọc.
* Không thể chỉnh sửa Markdown.
* Không thể tạo hoặc chỉnh sửa annotation.
* Phù hợp khi bạn chỉ muốn xem lại hoặc trình chiếu ghi chú.

---

# Quy trình sử dụng được khuyến nghị

1. Tạo hoặc dán nội dung vào **Markdown**.
2. Sắp xếp nội dung thành các sticky note nếu cần.
3. Chuyển sang **Annotation** để đánh dấu những điểm quan trọng.
4. Sử dụng **View** khi chỉ muốn đọc lại ghi chú.

Hy vọng NoteGPT sẽ giúp bạn lưu giữ kiến thức hiệu quả hơn và biến những câu trả lời từ AI thành tài liệu cá nhân dễ tìm kiếm, dễ xem lại và dễ chia sẻ.




## Dành cho developer

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
