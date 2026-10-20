import { describe, expect, it } from "vitest";
import { checkUpload } from "./media-files";

describe("upload checks by purpose", () => {
  it("chat attachments take images and documents but not video or audio", () => {
    expect(checkUpload({ name: "a.png", type: "image/png" }, "chat").kind).toBe("image");
    expect(checkUpload({ name: "report.pdf", type: "application/pdf" }, "chat").kind).toBe("file");
    expect(checkUpload({ name: "表格.xlsx", type: "" }, "chat").kind).toBe("file");
    expect(checkUpload({ name: "notes.md", type: "text/markdown" }, "chat").kind).toBe("file");
    expect(() => checkUpload({ name: "clip.mp4", type: "video/mp4" }, "chat")).toThrow(/不支持视频和音频/);
    expect(() => checkUpload({ name: "big.pdf", type: "application/pdf", size: 30 * 1024 * 1024 }, "chat")).toThrow(/20MB/);
  });

  it("generation material stays images, video and audio", () => {
    expect(checkUpload({ name: "clip.mp4", type: "video/mp4" }).kind).toBe("video");
    expect(() => checkUpload({ name: "report.pdf", type: "application/pdf" })).toThrow(/仅支持/);
  });
});
