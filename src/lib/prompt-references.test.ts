// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createReferenceCard, serializePrompt, splitPromptReferences } from "./prompt-references";

function editor(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const card = (path: string) =>
  `<span class="reference-inline-card" contenteditable="false" data-path="${path}"><span><img src="x"></span></span>`;

describe("serializePrompt", () => {
  it("replaces cards with numbered markers by attachment order", () => {
    const root = editor(`让${card("b.png")}&nbsp;里的人走进${card("a.png")} 的场景`);
    expect(serializePrompt(root, ["a.png", "b.png"])).toBe("让[图2] 里的人走进[图1] 的场景");
  });

  it("reuses the same marker when one image is referenced twice", () => {
    const root = editor(`${card("a.png")} 和 ${card("a.png")}`);
    expect(serializePrompt(root, ["a.png"])).toBe("[图1] 和 [图1]");
  });

  it("drops cards whose attachment was removed", () => {
    const root = editor(`开头 ${card("gone.png")}结尾`);
    expect(serializePrompt(root, ["a.png"])).toBe("开头 结尾");
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
      { kind: "reference", index: 1 },
      { kind: "text", text: "走进" },
      { kind: "reference", index: 0 },
    ]);
  });

  it("round-trips through cards and serializePrompt", () => {
    const root = document.createElement("div");
    const paths = ["a.png", "b.png"];
    for (const segment of splitPromptReferences("[图1] 看向 [图2]")) {
      root.append(segment.kind === "text"
        ? document.createTextNode(segment.text)
        : createReferenceCard(paths[segment.index], "x", segment.index));
    }
    expect(serializePrompt(root, paths)).toBe("[图1] 看向 [图2]");
  });
});
