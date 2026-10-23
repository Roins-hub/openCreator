import { describe, expect, it, vi } from "vitest";

// 两个提示词优化 Key:各自只能看到一部分对话模型;sk-dead 余额不足
const byKey: Record<string, string[]> = {
  "sk-a": ["gpt-6-sol"],
  "sk-b": ["claude-luna"],
  "sk-dead": ["gpt-6-luna"],
};
const calls: string[] = [];

vi.mock("./relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./relay")>()),
  relayFetch: async (_relay: unknown, path: string, init: RequestInit = {}) => {
    const key = String((init.headers as Record<string, string> | undefined)?.Authorization || "").replace("Bearer ", "");
    if (path === "/v1/models") return Response.json({ data: (byKey[key] || []).map((id) => ({ id, supported_endpoint_types: ["openai"] })) });
    if (path === "/v1/chat/completions") {
      const model = JSON.parse(String(init.body)).model;
      calls.push(`${key}:${model}`);
      if (key === "sk-dead") return Response.json({ error: { message: "余额不足" } }, { status: 403 });
      return Response.json({ choices: [{ message: { content: `扩写结果(${model})` } }] });
    }
    return Response.json(path === "/api/pricing" ? { data: [] } : { data: { price: 1 } });
  },
}));

const { assistModelOptions, assistPrompt } = await import("./tangzhi-server");
const relay = { base: "https://custom.example.com", custom: true };

describe("prompt assist with several keys", () => {
  it("lists the chat models of every key", async () => {
    expect((await assistModelOptions(relay, ["sk-a", "sk-b"])).models).toEqual(["claude-luna", "gpt-6-sol"]);
  });

  it("calls a chosen model with the key that has it", async () => {
    calls.length = 0;
    const result = await assistPrompt(["sk-a", "sk-b"], "一只猫", "image", relay, "claude-luna");
    expect(result.model).toBe("claude-luna");
    expect(calls).toEqual(["sk-b:claude-luna"]);
  });

  it("skips a key that ran out of balance and uses another key's model", async () => {
    calls.length = 0;
    const result = await assistPrompt(["sk-dead", "sk-a"], "一只猫", "video", relay);
    expect(calls[0]).toBe("sk-dead:gpt-6-luna");
    expect(result.model).toBe("gpt-6-sol");
  });
});
