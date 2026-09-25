// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { serializePrompt } from "./prompt-references";

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
