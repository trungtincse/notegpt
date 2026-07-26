// Retina-equivalent pixel density — plenty sharp for a printed/PDF-viewed page, and the cap
// this multiplies against (each image element's own on-canvas width/height) is already sized
// for legible reading, not a poster print.
const PRINT_PIXEL_DENSITY = 2;

interface ImageElementLike {
  type?: unknown;
  isDeleted?: unknown;
  fileId?: unknown;
  width?: unknown;
  height?: unknown;
}

interface BinaryFileLike {
  mimeType?: unknown;
  dataURL?: unknown;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to load image"));
    img.src = src;
  });
}

/** Shrinks each "image" element's file down to no more pixels than it will ever actually show
 * at print time (its own on-canvas width/height × PRINT_PIXEL_DENSITY) — a real exported PDF
 * was found to embed every image as a lossless FlateDecode bitmap, never DCTDecode/JPEG,
 * because Chromium's printToPDF rasterizes the whole Excalidraw canvas as one bitmap
 * regardless of any source image's own format/compression. That makes final PDF size driven
 * almost entirely by how many pixels get painted — a pasted photo shown at 340px on canvas but
 * stored at, say, 4000px wide (or a YouTube/TikTok thumbnail fetched at full resolution — see
 * replaceYoutubeEmbedsForPrint/replaceTiktokEmbedsForPrint) otherwise bloats the PDF for zero
 * visible benefit. Only ever shrinks, never upscales; leaves a file alone if it isn't
 * referenced by any visible image element, isn't already oversized, or fails to decode
 * (corrupt data). */
export async function shrinkImagesForPrint(
  elements: unknown[],
  files: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const maxSizeByFileId = new Map<string, { width: number; height: number }>();
  for (const element of elements) {
    const el = element as ImageElementLike;
    if (el.isDeleted || el.type !== "image" || typeof el.fileId !== "string") continue;
    if (typeof el.width !== "number" || typeof el.height !== "number") continue;

    const targetWidth = el.width * PRINT_PIXEL_DENSITY;
    const targetHeight = el.height * PRINT_PIXEL_DENSITY;
    const existing = maxSizeByFileId.get(el.fileId);
    // The same file can back more than one element — keep whichever bound is largest so no
    // element ends up worse than it needs.
    maxSizeByFileId.set(el.fileId, {
      width: Math.max(existing?.width ?? 0, targetWidth),
      height: Math.max(existing?.height ?? 0, targetHeight),
    });
  }

  const nextFiles = { ...files };
  await Promise.all(
    Array.from(maxSizeByFileId.entries()).map(async ([fileId, target]) => {
      const file = files[fileId] as BinaryFileLike | undefined;
      if (!file || typeof file.dataURL !== "string" || file.mimeType === "image/svg+xml") return;

      try {
        const img = await loadImage(file.dataURL);
        if (img.naturalWidth <= target.width && img.naturalHeight <= target.height) return;

        const scale = Math.min(target.width / img.naturalWidth, target.height / img.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        nextFiles[fileId] = { ...file, dataURL: canvas.toDataURL("image/png") };
      } catch {
        // Leave the original file in place.
      }
    })
  );
  return nextFiles;
}
