import { withBase } from "./base-path";

export const REFERENCE_CARD_CLASS = "reference-inline-card";

export function referenceLabel(index: number) {
  return `图${index + 1}`;
}

/**
 * 把输入区里的文字和内联引用卡片序列化为提交给模型的提示词。
 * 卡片按其素材在附件列表中的顺序替换为 `[图N]`,与上游收到的参考图顺序一致。
 */
export function serializePrompt(root: Node, attachmentPaths: readonly string[]) {
  let output = "";
  const breakLine = () => {
    if (output && !output.endsWith("\n")) output += "\n";
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      output += (node.textContent || "").replace(/ /g, " ");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.classList.contains(REFERENCE_CARD_CLASS)) {
      const index = attachmentPaths.indexOf(element.dataset.path || "");
      if (index >= 0) output += `[${referenceLabel(index)}]`;
      return;
    }
    if (element.tagName === "BR") {
      output += "\n";
      return;
    }
    const block = element.tagName === "DIV" || element.tagName === "P";
    if (block) breakLine();
    element.childNodes.forEach(walk);
    if (block) breakLine();
  };
  root.childNodes.forEach(walk);
  return output.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type PromptSegment = { kind: "text"; text: string } | { kind: "reference"; index: number };

/** 把含 `[图N]` 标记的提示词拆成文字与引用片段(index 从 0 开始)。 */
export function splitPromptReferences(prompt: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let last = 0;
  for (const match of prompt.matchAll(/\[图(\d+)\]/g)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: prompt.slice(last, start) });
    segments.push({ kind: "reference", index: Number(match[1]) - 1 });
    last = start + match[0].length;
  }
  if (last < prompt.length) segments.push({ kind: "text", text: prompt.slice(last) });
  return segments;
}

/** 创建输入区内联引用卡片节点。 */
export function createReferenceCard(path: string, name: string, index: number) {
  const card = document.createElement("span");
  card.className = REFERENCE_CARD_CLASS;
  card.contentEditable = "false";
  card.dataset.path = path;
  card.dataset.label = referenceLabel(index);
  card.title = name;
  const thumb = document.createElement("span");
  thumb.className = "reference-inline-thumb";
  const image = document.createElement("img");
  image.src = withBase(`/api/media/${path}`);
  image.alt = name;
  thumb.appendChild(image);
  card.appendChild(thumb);
  return card;
}
