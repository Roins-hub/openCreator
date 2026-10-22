import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELAY } from "./relay";
import { chatImage, chatImageResult, editImage, friendlyMessage, generateImage, upstreamMessage } from "./tangzhi-server";

describe("relay error messages", () => {
  it("explains a failed quota pre-deduction", () => {
    expect(friendlyMessage("预扣费额度失败, 用户剩余额度: ✦8.054192, 需要预扣费额度: ✦9.200000"))
      .toBe("中转站余额不足：本次需预扣 9.20，当前剩余 8.05。请到 new.tangzhi.org 充值，或改用更便宜的模型、更短时长或更小尺寸。");
    expect(friendlyMessage("prompt 太短")).toBe("prompt 太短");
  });

  it("unwraps nested error JSON", () => {
    expect(upstreamMessage({
      code: "fail_to_fetch_task",
      message: JSON.stringify({ error: { code: "invalid_params", message: "mode 为必填项" } }),
    }, 400)).toBe("mode 为必填项");
  });
});

describe("chatImageResult", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  const reply = (content: unknown, extra = {}) => ({ choices: [{ message: { role: "assistant", content, ...extra } }] });

  it("reads the markdown data URL Nano Banana returns", async () => {
    const result = await chatImageResult(reply(`![image](data:image/jpeg;base64,${png})`));
    expect(result.mimeType).toBe("image/jpeg");
    expect([...result.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("reads message.images and content parts", async () => {
    expect((await chatImageResult(reply("", { images: [{ image_url: { url: `data:image/png;base64,${png}` } }] }))).mimeType).toBe("image/png");
    expect((await chatImageResult(reply([{ type: "image_url", image_url: { url: `data:image/webp;base64,${png}` } }]))).mimeType).toBe("image/webp");
  });

  it("reports the model's text when no image comes back", async () => {
    await expect(chatImageResult(reply("这个请求无法生成图片"))).rejects.toThrow("模型没有返回图片：这个请求无法生成图片");
    await expect(chatImageResult({})).rejects.toThrow("中转站没有返回图片");
  });
});

describe("task ID header", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The relay answers with an error so each call stops right after the request.
  const captureHeaders = () => {
    const seen: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response(JSON.stringify({ error: { message: "stop" } }), { status: 500 });
    }));
    return seen;
  };

  it("sends the workbench task ID with every kind of image call", async () => {
    const seen = captureHeaders();
    await generateImage("sk-test", { model: "m", prompt: "p" }, DEFAULT_RELAY, "img.abc").catch(() => {});
    await editImage("sk-test", new FormData(), DEFAULT_RELAY, "img.def").catch(() => {});
    await chatImage("sk-test", { model: "m", prompt: "p", aspectRatio: "1:1", imageSize: "1K", references: [] }, DEFAULT_RELAY, "img.ghi").catch(() => {});
    expect(seen.map((headers) => headers.get("X-Client-Task-Id"))).toEqual(["img.abc", "img.def", "img.ghi"]);
  });

  it("leaves the header out without a task ID", async () => {
    const seen = captureHeaders();
    await generateImage("sk-test", { model: "m", prompt: "p" }).catch(() => {});
    expect(seen[0].has("X-Client-Task-Id")).toBe(false);
  });
});
