import { describe, expect, it } from "vitest";
import {
  extractYoutubeVideoId,
  getYoutubeThumbnailUrl,
  getYoutubeWatchUrl,
  replaceYoutubeEmbedsForPrint,
} from "./YoutubeEmbed.js";

describe("extractYoutubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=10s", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=5", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("extracts the video id from %s", (link, expected) => {
    expect(extractYoutubeVideoId(link)).toBe(expected);
  });

  it.each([
    ["https://www.youtube.com/embed/videoseries?list=PL123", null],
    ["https://example.com/watch?v=dQw4w9WgXcQ", null],
    ["not a url at all", null],
  ])("returns null for %s", (link, expected) => {
    expect(extractYoutubeVideoId(link)).toBe(expected);
  });
});

describe("getYoutubeThumbnailUrl / getYoutubeWatchUrl", () => {
  it("builds the static thumbnail and watch-page URLs from a video id", () => {
    expect(getYoutubeThumbnailUrl("abc123")).toBe("https://i.ytimg.com/vi/abc123/maxresdefault.jpg");
    expect(getYoutubeWatchUrl("abc123")).toBe("https://www.youtube.com/watch?v=abc123");
  });
});

describe("replaceYoutubeEmbedsForPrint", () => {
  it("swaps a YouTube embeddable for an image element pointing at the thumbnail, linked to the watch page, plus a centered logo overlay element", () => {
    const elements = [{ id: "e1", type: "embeddable", x: 0, y: 0, width: 560, height: 315, link: "https://www.youtube.com/embed/abc123?enablejsapi=1" }];
    const { elements: result, files } = replaceYoutubeEmbedsForPrint(elements, {});

    expect(result).toHaveLength(2);
    const el = result[0] as Record<string, unknown>;
    expect(el.type).toBe("image");
    expect(el.link).toBe("https://www.youtube.com/watch?v=abc123");
    expect(el.x).toBe(0);
    expect(el.width).toBe(560);
    const fileId = el.fileId as string;
    expect(fileId).toBeTruthy();
    expect((files[fileId] as Record<string, unknown>).dataURL).toBe("https://i.ytimg.com/vi/abc123/maxresdefault.jpg");

    const logoEl = result[1] as Record<string, unknown>;
    expect(logoEl.type).toBe("image");
    expect(logoEl.width).toBeLessThan(560);
    expect(logoEl.height).toBeLessThan(315);
    // Centered over the thumbnail's box.
    expect((logoEl.x as number) + (logoEl.width as number) / 2).toBeCloseTo(0 + 560 / 2);
    expect((logoEl.y as number) + (logoEl.height as number) / 2).toBeCloseTo(0 + 315 / 2);
    const logoFileId = logoEl.fileId as string;
    expect((files[logoFileId] as Record<string, unknown>).mimeType).toBe("image/svg+xml");
  });

  it("leaves non-YouTube embeddables and other element types untouched", () => {
    const elements = [
      { id: "e1", type: "embeddable", link: "https://vimeo.com/12345" },
      { id: "e2", type: "rectangle", link: null },
    ];
    const { elements: result, files } = replaceYoutubeEmbedsForPrint(elements, {});
    expect(result).toEqual(elements);
    expect(files).toEqual({});
  });

  it("skips deleted elements", () => {
    const elements = [{ id: "e1", type: "embeddable", isDeleted: true, link: "https://youtu.be/abc123" }];
    const { elements: result } = replaceYoutubeEmbedsForPrint(elements, {});
    expect(result).toEqual(elements);
  });
});
