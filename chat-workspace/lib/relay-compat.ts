/** Keep protocol selection separate from the relay's brand and the original model ID. */
export const usesChatCompletions = (model: string) =>
  /^gemini-/i.test(model.trim().split("/").at(-1) ?? "");

type StreamEvent = Record<string, unknown> & { type?: unknown; output_index?: unknown; item_id?: unknown };

const DELTA_EVENT = /^response\.(?:output_text|content_part|reasoning|function_call_arguments)/;
const REASONING_EVENT = /^response\.reasoning_(?:summary_part|summary_text|text)\./;

/**
 * Responses 兼容的中转站发来的事件流有时不规范,AI SDK 会直接报错(比如
 * "Received reasoning-delta for missing reasoning part"),整条回复被标成失败。这里在交给 SDK 前整理:
 * - delta 事件缺 item_id:按 output_index 从 output_item.added 补上;
 * - 思考摘要的 delta 先于(或根本没有)对应的 output_item.added:补发一个 added;
 *   item_id 和 added 里的对不上:按 output_index 改成 added 的;
 *   新的 summary_index 没有 summary_part.added:补发一个;
 * - 思考已经结束(output_item.done)后才到的思考片段:丢弃(SDK 无法再接上)。
 * 正文、工具调用等其他事件原样转发。
 */
export function repairResponsesStream(response: Response): Response {
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    return response;
  // output_index → 这个位置上的条目 ID(所有类型)
  const ids = new Map<number, string>();
  // 进行中的思考条目:ID → 它的 output_index 和已开始的摘要段
  const openReasoning = new Map<string, { index: number; parts: Set<number> }>();
  const closedReasoning = new Set<string>();
  // 中转站给的 output_index 不能用时(缺失或被别的条目占了),给思考条目分配的位置
  let syntheticIndex = 10_000;
  let buffer = "";

  const frameOf = (otherLines: string[], event: StreamEvent) =>
    [...otherLines, `data: ${JSON.stringify(event)}`].join("\n");

  const openReasoningItem = (id: string, preferred: unknown, out: string[]) => {
    const taken = typeof preferred === "number" ? ids.get(preferred) : undefined;
    const index = typeof preferred === "number" && (taken === undefined || taken === id) ? preferred : syntheticIndex++;
    ids.set(index, id);
    openReasoning.set(id, { index, parts: new Set([0]) });
    out.push(frameOf([], {
      type: "response.output_item.added",
      output_index: index,
      item: { type: "reasoning", id, encrypted_content: null, summary: [] },
    }));
    return openReasoning.get(id)!;
  };

  const repairFrame = (frame: string): string[] => {
    const lines = frame.split("\n");
    const otherLines = lines.filter((line) => !line.startsWith("data:"));
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    let event: StreamEvent;
    try {
      event = JSON.parse(data);
    } catch {
      return [frame];
    }
    if (!event || typeof event !== "object" || typeof event.type !== "string") return [frame];
    const type = event.type;
    const item = event.item as { type?: unknown; id?: unknown } | undefined;

    if (type === "response.output_item.added" && typeof event.output_index === "number" && typeof item?.id === "string") {
      if (item.type === "reasoning") {
        if (openReasoning.has(item.id) || closedReasoning.has(item.id)) return [];
        openReasoning.set(item.id, { index: event.output_index, parts: new Set([0]) });
      }
      ids.set(event.output_index, item.id);
      return [frame];
    }

    if (type === "response.output_item.done" && item?.type === "reasoning" && typeof item.id === "string") {
      const open = openReasoning.get(item.id);
      // 没开始过、或重复的 done:SDK 不需要
      if (!open) return [];
      openReasoning.delete(item.id);
      closedReasoning.add(item.id);
      return [frameOf(otherLines, { ...event, output_index: open.index })];
    }

    if (!DELTA_EVENT.test(type)) return [frame];
    let changed = false;
    // 缺 item_id:按 output_index 补
    if (event.item_id == null && typeof event.output_index === "number" && ids.has(event.output_index)) {
      event.item_id = ids.get(event.output_index);
      changed = true;
    }
    if (!REASONING_EVENT.test(type) || typeof event.item_id !== "string") {
      return [changed ? frameOf(otherLines, event) : frame];
    }

    const out: string[] = [];
    let id = event.item_id;
    // item_id 和这个位置上进行中的思考条目对不上:以 added 里的为准
    if (!openReasoning.has(id) && !closedReasoning.has(id) && typeof event.output_index === "number") {
      const atIndex = ids.get(event.output_index);
      if (atIndex && openReasoning.has(atIndex)) id = atIndex;
    }
    if (closedReasoning.has(id)) return [];
    const reasoning = openReasoning.get(id) ?? openReasoningItem(id, event.output_index, out);
    const summaryIndex = typeof event.summary_index === "number" ? event.summary_index : undefined;
    if (summaryIndex !== undefined && !reasoning.parts.has(summaryIndex)) {
      reasoning.parts.add(summaryIndex);
      if (type !== "response.reasoning_summary_part.added") {
        out.push(frameOf([], {
          type: "response.reasoning_summary_part.added",
          item_id: id, output_index: reasoning.index, summary_index: summaryIndex,
          part: { type: "summary_text", text: "" },
        }));
      }
    } else if (type === "response.reasoning_summary_part.added" && summaryIndex !== undefined) {
      // 这一段已经开始过(比如第 0 段随 added 一起开始):重复的 added 不再转发
      return out;
    }
    out.push(frameOf(otherLines, { ...event, item_id: id, output_index: reasoning.index }));
    return out;
  };

  const body = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          buffer += chunk;
          let match;
          while ((match = /\r?\n\r?\n/.exec(buffer))) {
            const frame = buffer.slice(0, match.index).replace(/\r\n/g, "\n");
            buffer = buffer.slice(match.index + match[0].length);
            for (const repaired of repairFrame(frame)) controller.enqueue(repaired + "\n\n");
          }
        },
        flush(controller) {
          if (!buffer) return;
          for (const repaired of repairFrame(buffer.replace(/\r\n/g, "\n"))) controller.enqueue(repaired + "\n\n");
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export function chatErrorMessage(error: unknown): string {
  const value = error as {
    message?: unknown;
    statusCode?: unknown;
    responseHeaders?: Record<string, string>;
  } | null;
  const message = typeof value?.message === "string" ? value.message.trim() : "";
  const status = typeof value?.statusCode === "number" ? `（HTTP ${value.statusCode}）` : "";
  return `请求失败${status}：${message || "中转站未返回错误详情，请检查模型与分组支持的接口。"}`;
}
