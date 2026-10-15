/** Keep protocol selection separate from the relay's brand and the original model ID. */
export const usesChatCompletions = (model: string) =>
  /^gemini-/i.test(model.trim().split("/").at(-1) ?? "");

// Some Responses-compatible relays omit item_id on delta events, while providing
// the ID in output_item.added. Repair only that omission using output_index.
export function repairResponsesStream(response: Response): Response {
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    return response;
  const ids = new Map<number, string>();
  let buffer = "";
  const repairFrame = (frame: string) => {
    const lines = frame.split("\n");
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return frame;
    }
    if (!event || typeof event !== "object") return frame;
    if (
      event.type === "response.output_item.added" &&
      typeof event.output_index === "number" &&
      typeof event.item?.id === "string"
    ) {
      ids.set(event.output_index, event.item.id);
    }
    if (
      typeof event.type !== "string" ||
      !/^response\.(?:output_text|content_part|reasoning|function_call_arguments)/.test(
        event.type,
      ) ||
      event.item_id != null ||
      typeof event.output_index !== "number"
    )
      return frame;
    const id = ids.get(event.output_index);
    if (!id) return frame;
    event.item_id = id;
    return [
      ...lines.filter((line) => !line.startsWith("data:")),
      `data: ${JSON.stringify(event)}`,
    ].join("\n");
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
            controller.enqueue(repairFrame(frame) + "\n\n");
          }
        },
        flush(controller) {
          if (buffer) controller.enqueue(repairFrame(buffer.replace(/\r\n/g, "\n")) + "\n\n");
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
