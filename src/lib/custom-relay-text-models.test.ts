import { describe, expect, it, vi } from "vitest";
import { isChatModelEntry } from "./prompt-assist";

// 自定义中转站:分组都不叫 default,定价表里的视频 / 生图对不上 default 分组
const pricing = {
  data: [
    { model_name: "gpt-6-sol", supported_endpoint_types: ["openai"], enable_groups: ["MA-G1"] },
    { model_name: "sd2.5-101010", supported_endpoint_types: ["openai-video"], enable_groups: ["VS-G1"] },
    { model_name: "nano-image", supported_endpoint_types: ["image-generation"], enable_groups: ["MA-G1"] },
  ],
};
const keyModels = {
  data: [
    { id: "gpt-6-sol", supported_endpoint_types: ["openai"] },
    // 定价表里没有,但 Key 能用的对话模型
    { id: "gpt-5.6-terra", supported_endpoint_types: ["openai"] },
    { id: "claude-luna", supported_endpoint_types: ["anthropic"] },
    { id: "sd2.5-101010", supported_endpoint_types: ["openai-video"] },
    { id: "nano-image", supported_endpoint_types: ["image-generation"] },
  ],
};

vi.mock("./relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./relay")>()),
  relayFetch: async (_relay: unknown, path: string) => Response.json(
    path === "/api/pricing" ? pricing : path === "/v1/models" ? keyModels : { data: { price: 1 } },
  ),
}));

const { assistModelOptions } = await import("./tangzhi-server");

describe("text models on a custom relay", () => {
  it("lists the key's chat models even without a default group", async () => {
    const options = await assistModelOptions({ base: "https://custom.example.com", custom: true }, "sk-test");
    expect(options.models).toEqual(["claude-luna", "gpt-5.6-terra", "gpt-6-sol"]);
    expect(options.auto).toBe("claude-luna");
  });

  it("recognizes chat models by endpoint type, or by name when there is none", () => {
    expect(isChatModelEntry("gpt-6-sol", ["openai"])).toBe(true);
    expect(isChatModelEntry("claude-x", ["anthropic"])).toBe(true);
    expect(isChatModelEntry("sora-2", ["openai-video"])).toBe(false);
    expect(isChatModelEntry("gpt-image-2", ["openai"])).toBe(false);
    expect(isChatModelEntry("deepseek-v4", [])).toBe(true);
    expect(isChatModelEntry("kling-v3", [])).toBe(false);
    expect(isChatModelEntry("text-embedding-3", [])).toBe(false);
  });
});
