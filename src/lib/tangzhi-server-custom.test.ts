import { beforeEach, describe, expect, it, vi } from "vitest";

// 自定义中转站:用假的 relayFetch 模拟不同的中转站
const routes = new Map<string, () => Response>();
vi.mock("./relay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./relay")>();
  return {
    ...actual,
    relayFetch: vi.fn(async (_relay: unknown, path: string) => (routes.get(path) ?? (() => new Response("not found", { status: 404 })))()),
  };
});

const { catalogModels, findModel } = await import("./tangzhi-server");

let counter = 0;
// 每个用例换一个地址,避开模型列表缓存
const relay = () => ({ base: `https://relay-${++counter}.example.com`, custom: true });

describe("custom relay models", () => {
  beforeEach(() => routes.clear());

  it("lists video and image models from /v1/models even without /api/pricing", async () => {
    routes.set("/v1/models", () => Response.json({
      data: [
        { id: "veo-3.1-fast" },
        { id: "MiniMax-Hailuo-02" },
        { id: "flux-kontext-pro" },
        { id: "gemini-2.5-flash-image" },
        { id: "gpt-5.6-luna" },
      ],
    }));
    const target = relay();
    const models = await catalogModels(target, "sk-test");
    expect(models.map((model) => [model.id, model.type, model.vendor, model.series, model.generic])).toEqual([
      ["veo-3.1-fast", "video", "Google", "Veo 3.1 Fast", true],
      ["MiniMax-Hailuo-02", "video", "MiniMax", "Hailuo 02", true],
      ["flux-kontext-pro", "image", "Black Forest Labs", "FLUX Kontext Pro", true],
      ["gemini-2.5-flash-image", "image", "Google", "Gemini 2.5 Flash Image", true],
    ]);
    const image = models.find((model) => model.id === "gemini-2.5-flash-image");
    expect(image?.type === "image" && image.api).toBe("chat");
    // 提交时也能找到这个模型
    await expect(findModel("veo-3.1-fast", target, "sk-test")).resolves.toMatchObject({ id: "veo-3.1-fast" });
  });

  it("uses endpoint types when new-api provides them", async () => {
    routes.set("/v1/models", () => Response.json({
      data: [
        { id: "my-video", supported_endpoint_types: ["openai-video"] },
        { id: "my-painter", supported_endpoint_types: ["image-generation", "openai"] },
        { id: "video-helper-chat", supported_endpoint_types: ["openai"] },
      ],
    }));
    const models = await catalogModels(relay(), "sk-test");
    expect(models.map((model) => [model.id, model.type])).toEqual([["my-video", "video"], ["my-painter", "image"]]);
  });

  it("keeps parsed parameters and prices for models described in the relay's pricing", async () => {
    routes.set("/api/pricing", () => Response.json({
      data: [{
        model_name: "ch0101-sd-2.0-720p", description: "(按次计费) 9图片，3音频，3视频，合计≤12，720p，4s-15s，可真人",
        tags: "CH01", vendor_id: 1, supported_endpoint_types: ["openai-video"], model_price: 2, enable_groups: ["default"],
      }],
      vendors: [{ id: 1, name: "Doubao" }],
    }));
    routes.set("/v1/models", () => Response.json({ data: [{ id: "ch0101-sd-2.0-720p" }, { id: "sora-2" }] }));
    const models = await catalogModels(relay(), "sk-test");
    const seedance = models.find((model) => model.id === "ch0101-sd-2.0-720p");
    expect(seedance).toMatchObject({ vendor: "Doubao", series: "Seedance 2.0", resolution: "720p", face: "可真人" });
    expect(seedance?.generic).toBeUndefined();
    expect(models.find((model) => model.id === "sora-2")).toMatchObject({ generic: true, vendor: "OpenAI" });
  });

  it("explains when the relay can't be read", async () => {
    await expect(catalogModels(relay(), "sk-test")).rejects.toThrow("无法获取中转站模型");
  });
});
