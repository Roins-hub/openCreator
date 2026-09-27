// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createReferenceCard, findReference, referenceLabels, serializePrompt, splitPromptReferences,
} from "./prompt-references";

function editor(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const img = (path: string) => ({ path, kind: "image" as const });
const card = (path: string) =>
  `<span class="reference-inline-card" contenteditable="false" data-path="${path}"><span><img src="x"></span></span>`;

describe("serializePrompt", () => {
  it("replaces cards with numbered markers by attachment order", () => {
    const root = editor(`让${card("b.png")}&nbsp;里的人走进${card("a.png")} 的场景`);
    expect(serializePrompt(root, [img("a.png"), img("b.png")])).toBe("让[图2] 里的人走进[图1] 的场景");
  });

  it("reuses the same marker when one image is referenced twice", () => {
    const root = editor(`${card("a.png")} 和 ${card("a.png")}`);
    expect(serializePrompt(root, [img("a.png")])).toBe("[图1] 和 [图1]");
  });

  it("drops cards whose attachment was removed", () => {
    const root = editor(`开头 ${card("gone.png")}结尾`);
    expect(serializePrompt(root, [img("a.png")])).toBe("开头 结尾");
  });

  it("keeps line breaks from br and block elements", () => {
    const root = editor(`第一行<br>第二行<div>第三行</div>`);
    expect(serializePrompt(root, [])).toBe("第一行\n第二行\n第三行");
  });

  it("returns empty text for an editor that only holds whitespace", () => {
    expect(serializePrompt(editor("&nbsp; "), [])).toBe("");
  });
});

describe("splitPromptReferences", () => {
  it("splits text and numbered markers", () => {
    expect(splitPromptReferences("让[图2]走进[图1]")).toEqual([
      { kind: "text", text: "让" },
      { kind: "reference", mediaKind: "image", index: 1 },
      { kind: "text", text: "走进" },
      { kind: "reference", mediaKind: "image", index: 0 },
    ]);
  });

  it("round-trips through cards and serializePrompt", () => {
    const root = document.createElement("div");
    const items = [img("a.png"), { path: "c.mp4", kind: "video" as const }, img("b.png")];
    const labels = referenceLabels(items);
    for (const segment of splitPromptReferences("[图1] 看向 [图2]，配合 [视频1]")) {
      if (segment.kind === "text") { root.append(document.createTextNode(segment.text)); continue; }
      const index = findReference(items, segment.mediaKind, segment.index);
      root.append(createReferenceCard(items[index].path, "x", labels[index], items[index].kind));
    }
    expect(serializePrompt(root, items)).toBe("[图1] 看向 [图2]，配合 [视频1]");
  });
});

describe("referenceLabels", () => {
  it("numbers each media kind separately", () => {
    expect(referenceLabels([
      { kind: "image" }, { kind: "audio" }, { kind: "video" }, { kind: "image" }, { kind: "audio" },
    ])).toEqual(["图1", "音频1", "视频1", "图2", "音频2"]);
  });
});
