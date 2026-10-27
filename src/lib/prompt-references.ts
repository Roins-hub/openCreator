export const REFERENCE_CARD_CLASS = "reference-inline-card";

type MediaKind = "image" | "video" | "audio";
type ReferenceItem = { path: string; kind: MediaKind };

const KIND_PREFIX: Record<MediaKind, string> = { image: "图", video: "视频", audio: "音频" };
const PREFIX_KIND: Record<string, MediaKind> = { 图: "image", 视频: "video", 音频: "audio" };

/** 同类素材内的序号标签:图1、视频1、音频1(与提交给上游的各类素材顺序一致)。 */
export function referenceLabel(kind: MediaKind, index: number) {
  return `${KIND_PREFIX[kind]}${index + 1}`;
}

export function referenceLabels(items: readonly Pick<ReferenceItem, "kind">[]) {
  const counters: Record<MediaKind, number> = { image: 0, video: 0, audio: 0 };
  return items.map((item) => referenceLabel(item.kind, counters[item.kind]++));
}

/** 按「类型 + 同类序号」找到素材在列表中的位置,找不到返回 -1。 */
export function findReference(items: readonly Pick<ReferenceItem, "kind">[], kind: MediaKind, index: number) {
  let seen = -1;
  return items.findIndex((item) => item.kind === kind && ++seen === index);
}

/**
 * 把输入区里的文字和内联引用卡片序列化为提交给模型的提示词。
 * 卡片替换为 `[图N]` / `[视频N]` / `[音频N]`,序号与上游收到的同类素材顺序一致。
 */
export function serializePrompt(root: Node, attachments: readonly ReferenceItem[]) {
  const labels = referenceLabels(attachments);
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
      const index = attachments.findIndex((item) => item.path === element.dataset.path);
      if (index >= 0) output += `[${labels[index]}]`;
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

export type PromptSegment =
  | { kind: "text"; text: string }
  | { kind: "reference"; mediaKind: MediaKind; index: number };

/** 把含 `[图N]` / `[视频N]` / `[音频N]` 标记的提示词拆成文字与引用片段(index 为同类序号,从 0 开始)。 */
export function splitPromptReferences(prompt: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let last = 0;
  for (const match of prompt.matchAll(/\[(图|视频|音频)(\d+)\]/g)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: prompt.slice(last, start) });
    segments.push({ kind: "reference", mediaKind: PREFIX_KIND[match[1]], index: Number(match[2]) - 1 });
    last = start + match[0].length;
  }
  if (last < prompt.length) segments.push({ kind: "text", text: prompt.slice(last) });
  return segments;
}

/** 创建输入区内联引用卡片节点。 */
export function createReferenceCard(path: string, name: string, label: string, kind: MediaKind = "image") {
  const card = document.createElement("span");
  card.className = REFERENCE_CARD_CLASS;
  card.contentEditable = "false";
  // 不用浏览器自带的拖动(拖出来放不下);输入框里按住可以用卡片式拖动换位置(见 app-shell)
  card.draggable = false;
  card.dataset.path = path;
  card.dataset.label = label;
  card.dataset.kind = kind;
  card.title = name;
  const thumb = document.createElement("span");
  thumb.className = "reference-inline-thumb";
  if (kind === "image" || kind === "video") {
    // 缩略图(图片缩小、视频截首帧);拿不到时图片退回原图,视频退回预读首帧
    const image = document.createElement("img");
    image.draggable = false;
    image.src = `/api/media/${path}?thumb=240`;
    image.alt = name;
    image.decoding = "async";
    image.onerror = () => {
      image.onerror = null;
      if (kind === "image") { image.src = `/api/media/${path}`; return; }
      const video = document.createElement("video");
      video.src = `/api/media/${path}#t=0.1`;
      video.muted = true;
      video.preload = "metadata";
      image.replaceWith(video);
    };
    thumb.appendChild(image);
  } else {
    thumb.textContent = "♪";
  }
  card.appendChild(thumb);
  return card;
}
