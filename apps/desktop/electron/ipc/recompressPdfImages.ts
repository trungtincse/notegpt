import { encode as encodeJpeg } from "jpeg-js";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { inflateSync } from "node:zlib";

// Chromium's printToPDF rasterizes Excalidraw's whole canvas (background, hand-drawn strokes,
// markdown text, and every pasted photo — all drawn onto one shared <canvas>, not separate DOM
// elements) into a single lossless FlateDecode bitmap per page. A note with real photographic
// content compresses poorly that way (~5:1, confirmed against a real 19MB export where one
// 4024x7954 image alone accounted for 18.7MB of it) since deflate isn't built for photo noise.
// There's no way to make Chromium emit JPEG for that canvas capture directly, so this
// re-encodes the oversized raw bitmap streams as JPEG after the fact — the only lever left
// that actually reduces the bytes Chromium itself chose to write.
const MIN_RECOMPRESS_BYTES = 20_000;
const JPEG_QUALITY = 80;

// `PDFDict.lookupMaybe` throws (rather than returning undefined) when the value is present
// but isn't one of the requested types — e.g. a `/Filter` that's an array of filters instead
// of a single name. That's exactly "doesn't match the narrow shape this handles", so these
// treat it the same as absent instead of letting it crash the whole export.
function nameAt(dict: PDFDict, key: string): string | undefined {
  try {
    return dict.lookupMaybe(PDFName.of(key), PDFName)?.asString();
  } catch {
    return undefined;
  }
}

function numberAt(dict: PDFDict, key: string): number | undefined {
  try {
    return dict.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber();
  } catch {
    return undefined;
  }
}

function dictAt(dict: PDFDict, key: string): PDFDict | undefined {
  try {
    return dict.lookupMaybe(PDFName.of(key), PDFDict);
  } catch {
    return undefined;
  }
}

/** Number of color channels for `dict`'s `/ColorSpace` entry, or null for anything this
 * doesn't know how to safely re-encode. Handles the two shapes actually seen in practice:
 * a plain `/DeviceRGB`/`/DeviceGray` name, or (what Chromium's own PDF writer actually emits)
 * `[/ICCBased <stream ref>]`, where the referenced stream's own `/N` entry gives the channel
 * count — 1 (gray) or 3 (RGB) are handled; 4 (CMYK) and anything else is left alone. */
function colorSpaceChannels(dict: PDFDict, key: string): number | null {
  const name = nameAt(dict, key);
  if (name === "/DeviceRGB") return 3;
  if (name === "/DeviceGray") return 1;

  let arr: PDFArray | undefined;
  try {
    arr = dict.lookupMaybe(PDFName.of(key), PDFArray);
  } catch {
    return null;
  }
  if (!arr || arr.size() < 2) return null;

  let csName: string | undefined;
  try {
    csName = arr.lookupMaybe(0, PDFName)?.asString();
  } catch {
    return null;
  }
  if (csName !== "/ICCBased") return null;

  let iccStream: PDFRawStream | undefined;
  try {
    iccStream = arr.lookupMaybe(1, PDFRawStream);
  } catch {
    return null;
  }
  if (!iccStream) return null;

  const n = numberAt(iccStream.dict, "N");
  return n === 1 || n === 3 ? n : null;
}

/** Re-encodes any oversized, plain 8-bit gray/RGB (including ICCBased-tagged RGB/gray, which
 * is what Chromium's own PDF writer actually emits) FlateDecode image stream as JPEG, in
 * place. Deliberately narrow: skips anything with an unusual colorspace (Indexed, CMYK) or
 * bit depth, and only swaps in the JPEG if it actually comes out smaller — a silently-skipped
 * or unusually-encoded image is far better than a corrupted PDF. */
export async function recompressLargeRasterImages(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);

  for (const [, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const { dict } = obj;

    if (nameAt(dict, "Subtype") !== "/Image") continue;
    if (nameAt(dict, "Filter") !== "/FlateDecode") continue;
    if (obj.getContentsSize() < MIN_RECOMPRESS_BYTES) continue;

    const width = numberAt(dict, "Width");
    const height = numberAt(dict, "Height");
    const bitsPerComponent = numberAt(dict, "BitsPerComponent");
    if (!width || !height || bitsPerComponent !== 8) continue;

    const channels = colorSpaceChannels(dict, "ColorSpace");
    if (channels === null) continue;

    // A Predictor (PNG-style row filtering, applied on top of the raw Flate stream) would
    // mean the inflated bytes below aren't literal pixel values — skip rather than risk
    // decoding a filtered stream as if it were plain RGB/Gray.
    const decodeParms = dictAt(dict, "DecodeParms");
    const predictor = decodeParms ? numberAt(decodeParms, "Predictor") : undefined;
    if (predictor && predictor > 1) continue;

    let raw: Buffer;
    try {
      raw = inflateSync(Buffer.from(obj.getContents()));
    } catch {
      continue;
    }
    if (raw.length < width * height * channels) continue;

    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0, p = 0; i < width * height; i++, p += channels) {
      const r = raw[p];
      const g = channels === 3 ? raw[p + 1] : r;
      const b = channels === 3 ? raw[p + 2] : r;
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }

    let jpegBytes: Uint8Array;
    try {
      jpegBytes = encodeJpeg({ data: rgba, width, height }, JPEG_QUALITY).data;
    } catch {
      continue;
    }
    // Never make the PDF bigger — leave the original lossless stream in place if JPEG
    // somehow didn't win (e.g. a tiny/near-solid-color image with little to gain).
    if (jpegBytes.length >= obj.getContentsSize()) continue;

    dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
    dict.delete(PDFName.of("DecodeParms"));
    // pdf-lib has no public API to replace a stream's own bytes in place — `/Length` is
    // recomputed automatically from this at save time (see PDFStream.updateDict, which
    // every save() calls before writing).
    (obj as unknown as { contents: Uint8Array }).contents = jpegBytes;
  }

  return pdfDoc.save();
}
