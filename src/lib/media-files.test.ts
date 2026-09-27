import { describe, expect, it } from "vitest";
import { pickMediaFiles, uploadKind } from "./media-files";

const file = (name: string, type: string, size = 1024) => ({ name, type, size });

describe("uploadKind", () => {
  it("recognises images, videos and audio", () => {
    expect(uploadKind(file("a.png", "image/png"))).toBe("image");
    expect(uploadKind(file("a.mov", "video/quicktime"))).toBe("video");
    expect(uploadKind(file("a.mp3", "audio/mpeg"))).toBe("audio");
    expect(uploadKind(file("a.wav", ""))).toBe("audio");
    expect(uploadKind(file("a.gif", "image/gif"))).toBeUndefined();
  });
});

describe("pickMediaFiles", () => {
  it("accepts files within each kind's remaining count", () => {
    const result = pickMediaFiles(
      [file("a.png", "image/png"), file("b.png", "image/png"), file("c.mp4", "video/mp4")],
      { image: 1, video: 1, audio: 0 },
    );
    expect(result.accepted.map((item) => item.file.name)).toEqual(["a.png", "c.mp4"]);
    expect(result.error).toMatch(/图片数量上限/);
  });

  it("explains when the model does not take a kind at all", () => {
    const result = pickMediaFiles([file("a.mp3", "audio/mpeg")], { image: 9, video: 3, audio: 0 });
    expect(result.accepted).toEqual([]);
    expect(result.error).toMatch(/不支持参考音频/);
  });

  it("respects the combined limit", () => {
    const result = pickMediaFiles(
      [file("a.png", "image/png"), file("b.mp3", "audio/mpeg")], { image: 5, video: 5, audio: 5 }, 1,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.error).toMatch(/合计上限/);
  });

  it("rejects oversized files", () => {
    const result = pickMediaFiles([file("a.mp4", "video/mp4", 60 * 1024 * 1024)], { image: 0, video: 3, audio: 0 });
    expect(result.accepted).toEqual([]);
    expect(result.error).toMatch(/45MB/);
  });
});
