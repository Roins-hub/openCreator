import { describe, expect, it, vi } from "vitest";

// 自定义中转站:视频 Key 和图片 Key 在不同分组,各自 /v1/models 能看到的模型不一样
const byKey: Record<string, { id: string; supported_endpoint_types: string[] }[]> = {
  "sk-video": [
    { id: "sd2.5-101010", supported_endpoint_types: ["openai-video"] },
    { id: "video-only-image", supported_endpoint_types: ["image-generation"] },
  ],
  "sk-image": [
    { id: "gpt-image-2", supported_endpoint_types: ["image-generation"] },
    { id: "image-key-video", supported_endpoint_types: ["openai-video"] },
  ],
  // 第二个视频 Key:在另一个分组,能看到别的视频模型
  "sk-video2": [
    { id: "sd2.5-101010", supported_endpoint_types: ["openai-video"] },
    { id: "kling-v3", supported_endpoint_types: ["openai-video"] },
  ],
};

vi.mock("./relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./relay")>()),
  relayFetch: async (_relay: unknown, path: string, init: RequestInit = {}) => {
    if (path === "/v1/models") {
      const key = String((init.headers as Record<string, string>).Authorization).replace("Bearer ", "");
      return Response.json({ data: byKey[key] || [] });
    }
    return Response.json(path === "/api/pricing" ? { data: [] } : { data: { price: 1 } });
  },
}));

const { catalogModels, findModel, pickKey } = await import("./tangzhi-server");
const relay = { base: "https://custom.example.com", custom: true };

describe("separate video and image keys", () => {
  it("lists video models from the video key and image models from the image key", async () => {
    const models = await catalogModels(relay, "sk-video", "sk-image");
    expect(models.map((model) => `${model.type}:${model.id}`)).toEqual(["video:sd2.5-101010", "image:gpt-image-2"]);
  });

  it("uses one key for both when no image key is set", async () => {
    const models = await catalogModels(relay, "sk-video");
    expect(models.map((model) => model.id)).toEqual(["sd2.5-101010", "video-only-image"]);
    await expect(findModel("gpt-image-2", relay, "sk-video")).rejects.toThrow(/已下线/);
    expect((await findModel("gpt-image-2", relay, "sk-video", "sk-image")).type).toBe("image");
  });
});

describe("telling models apart on one key", async () => {
  const { keyModelKind } = await import("./tangzhi-server");
  it("classifies by endpoint type, or by name when there is none", () => {
    expect(keyModelKind("sd2.5-101010", ["video-generation"])).toBe("video");
    expect(keyModelKind("kling-v3", [])).toBe("video");
    expect(keyModelKind("seedream-5", ["image-edit"])).toBe("image");
    expect(keyModelKind("nano-banana-pro", ["openai"])).toBe("image");
    expect(keyModelKind("flux-dev", [])).toBe("image");
    expect(keyModelKind("gpt-6-sol", ["openai"])).toBe("chat");
    expect(keyModelKind("whisper-1", ["openai-transcription"])).toBe("other");
  });
});

describe("several keys for one use", () => {
  it("merges the models of every video key and calls each model with a key that has it", async () => {
    const models = await catalogModels(relay, ["sk-video", "sk-video2"], ["sk-image"]);
    expect(models.map((model) => `${model.type}:${model.id}`)).toEqual(["video:sd2.5-101010", "video:kling-v3", "image:gpt-image-2"]);
    expect(await pickKey(relay, ["sk-video", "sk-video2"], "kling-v3")).toBe("sk-video2");
    expect(await pickKey(relay, ["sk-video", "sk-video2"], "sd2.5-101010")).toBe("sk-video");
    expect(await pickKey(relay, ["sk-video"], "kling-v3")).toBe("sk-video");
  });

  it("reads extra keys from the request and finds the submitting key by its hint", async () => {
    const { imageKeysOf, keyByHint, keyHint, videoKeysOf } = await import("./identity");
    const request = new Request("http://x", { headers: {
      "x-tangzhi-video-keys": "sk-video2, sk-video ,",
      "x-tangzhi-image-key": "sk-image",
      "x-tangzhi-image-keys": "sk-image2",
    } });
    expect(videoKeysOf(request, "sk-video")).toEqual(["sk-video", "sk-video2"]);
    expect(imageKeysOf(request, "sk-video")).toEqual(["sk-image", "sk-image2"]);
    expect(keyByHint(["sk-video", "sk-video2"], keyHint("sk-video2"))).toBe("sk-video2");
    expect(keyByHint(["sk-video"], undefined)).toBeUndefined();
  });
});
