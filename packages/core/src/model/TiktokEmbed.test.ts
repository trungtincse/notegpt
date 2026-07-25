import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractTiktokVideoId,
  fetchTiktokOEmbed,
  getTiktokEmbedSrc,
  parseTiktokEmbedCode,
  replaceTiktokEmbedsForPrint,
} from "./TiktokEmbed.js";

const EMBED_CODE = `<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@trng.vnh.long7/video/7638906495249206536" data-video-id="7638906495249206536" style="max-width: 605px;min-width: 325px;" > <section> <a target="_blank" title="@trng.vnh.long7" href="https://www.tiktok.com/@trng.vnh.long7?refer=embed">@trng.vnh.long7</a> </section> </blockquote> <script async src="https://www.tiktok.com/embed.js"></script>`;

describe("parseTiktokEmbedCode", () => {
  it("extracts the video id and the canonical watch URL (not the profile link) from an embed snippet", () => {
    expect(parseTiktokEmbedCode(EMBED_CODE)).toEqual({
      videoId: "7638906495249206536",
      videoUrl: "https://www.tiktok.com/@trng.vnh.long7/video/7638906495249206536",
    });
  });

  it("returns null for plain URLs or unrelated HTML", () => {
    expect(parseTiktokEmbedCode("https://www.tiktok.com/@user/video/123")).toBeNull();
    expect(parseTiktokEmbedCode("<blockquote>not a tiktok embed</blockquote>")).toBeNull();
  });
});

describe("extractTiktokVideoId", () => {
  it.each([
    ["https://www.tiktok.com/@trng.vnh.long7/video/7638906495249206536", "7638906495249206536"],
    ["https://www.tiktok.com/@trng.vnh.long7/video/7638906495249206536?is_from_webapp=1", "7638906495249206536"],
    ["www.tiktok.com/@user/video/123", "123"],
  ])("extracts the video id from %s", (link, expected) => {
    expect(extractTiktokVideoId(link)).toBe(expected);
  });

  it.each([
    ["https://www.tiktok.com/@trng.vnh.long7?refer=embed", null],
    ["https://vm.tiktok.com/ZMabcdef/", null],
    ["not a url", null],
  ])("returns null for %s", (link, expected) => {
    expect(extractTiktokVideoId(link)).toBe(expected);
  });
});

describe("getTiktokEmbedSrc", () => {
  it("builds TikTok's iframe-embeddable endpoint", () => {
    expect(getTiktokEmbedSrc("123")).toBe("https://www.tiktok.com/embed/v2/123");
  });
});

describe("fetchTiktokOEmbed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the thumbnail even though TikTok's real response reports width/height as \"100%\" (not usable pixel values)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ thumbnail_url: "https://p16-sign.tiktokcdn.com/thumb.jpg", width: "100%", height: "100%" }),
      })
    );
    expect(await fetchTiktokOEmbed("https://www.tiktok.com/@user/video/123")).toEqual({
      thumbnailUrl: "https://p16-sign.tiktokcdn.com/thumb.jpg",
      width: undefined,
      height: undefined,
    });
  });

  it("returns numeric width/height on the rare response that actually has them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ thumbnail_url: "https://x/thumb.jpg", width: "325", height: "739" }),
      })
    );
    expect(await fetchTiktokOEmbed("https://www.tiktok.com/@user/video/123")).toEqual({
      thumbnailUrl: "https://x/thumb.jpg",
      width: 325,
      height: 739,
    });
  });

  it("returns null when the response has no thumbnail_url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await fetchTiktokOEmbed("https://www.tiktok.com/@user/video/123")).toBeNull();
  });

  it("returns null when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await fetchTiktokOEmbed("https://www.tiktok.com/@user/video/123")).toBeNull();
  });
});

describe("replaceTiktokEmbedsForPrint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("swaps a TikTok embeddable for an image element using the oEmbed thumbnail (real TikTok responses report width/height as \"100%\", not pixels)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ thumbnail_url: "https://p16-sign.tiktokcdn.com/thumb.jpg", width: "100%", height: "100%" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const elements = [
      { id: "e1", type: "embeddable", x: 0, y: 0, width: 325, height: 578, link: "https://www.tiktok.com/@user/video/123" },
    ];
    const { elements: result, files } = await replaceTiktokEmbedsForPrint(elements, {});

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://www.tiktok.com/oembed?url="),
      expect.anything()
    );
    const el = result[0] as Record<string, unknown>;
    expect(el.type).toBe("image");
    expect(el.link).toBe("https://www.tiktok.com/@user/video/123");
    const fileId = el.fileId as string;
    expect((files[fileId] as Record<string, unknown>).dataURL).toBe("https://p16-sign.tiktokcdn.com/thumb.jpg");
  });

  it("leaves the element unchanged when the oEmbed fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );
    const elements = [{ id: "e1", type: "embeddable", link: "https://www.tiktok.com/@user/video/123" }];
    const { elements: result } = await replaceTiktokEmbedsForPrint(elements, {});
    expect(result).toEqual(elements);
  });

  it("leaves non-TikTok embeddables untouched", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const elements = [{ id: "e1", type: "embeddable", link: "https://youtu.be/abc123" }];
    const { elements: result } = await replaceTiktokEmbedsForPrint(elements, {});
    expect(result).toEqual(elements);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
