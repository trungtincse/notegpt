import { describe, expect, it } from "vitest";
import { buildMediaLink, detectMediaKind, parseMediaLink, resolveLocalFilePath } from "./mediaLink.js";

describe("media link encoding", () => {
  it("round-trips an absolute path through build/parse", () => {
    const link = buildMediaLink("/home/user/Videos/clip.mp4");
    expect(parseMediaLink(link)).toBe("/home/user/Videos/clip.mp4");
  });

  it("round-trips a path with spaces and special characters", () => {
    const path = "/home/user/My Videos/a & b (2026).mp4";
    expect(parseMediaLink(buildMediaLink(path))).toBe(path);
  });

  it("parseMediaLink rejects unrelated links", () => {
    expect(parseMediaLink("https://example.com")).toBeNull();
    expect(parseMediaLink(undefined)).toBeNull();
  });
});

describe("detectMediaKind", () => {
  it("detects video by MIME type", () => {
    expect(detectMediaKind("clip.mp4", "video/mp4")).toBe("video");
  });

  it("detects audio by MIME type", () => {
    expect(detectMediaKind("song.mp3", "audio/mpeg")).toBe("audio");
  });

  it("falls back to extension when MIME type is generic", () => {
    expect(detectMediaKind("clip.mov", "application/octet-stream")).toBe("video");
    expect(detectMediaKind("song.flac", "application/octet-stream")).toBe("audio");
  });

  it("returns null for a non-media file", () => {
    expect(detectMediaKind("document.pdf", "application/pdf")).toBeNull();
  });
});

describe("resolveLocalFilePath", () => {
  it("decodes a file:// URI from a text/uri-list payload", () => {
    expect(resolveLocalFilePath("file:///home/user/Videos/clip.mp4")).toBe("/home/user/Videos/clip.mp4");
  });

  it("decodes percent-escaped characters (e.g. spaces) in the URI", () => {
    expect(resolveLocalFilePath("file:///home/user/My%20Videos/clip.mp4")).toBe("/home/user/My Videos/clip.mp4");
  });

  it("skips uri-list comment lines and picks the first real entry", () => {
    expect(resolveLocalFilePath("# a comment\nfile:///home/user/clip.mp4")).toBe("/home/user/clip.mp4");
  });

  it("accepts a bare absolute path with no file:// scheme", () => {
    expect(resolveLocalFilePath("/home/user/Music/song.mp3")).toBe("/home/user/Music/song.mp3");
  });

  it("rejects a real URL", () => {
    expect(resolveLocalFilePath("https://example.com/clip.mp4")).toBeNull();
  });

  it("rejects ordinary prose that isn't a file reference", () => {
    expect(resolveLocalFilePath("just some pasted text")).toBeNull();
  });
});
