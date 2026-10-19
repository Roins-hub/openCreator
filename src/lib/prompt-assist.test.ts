import { describe, expect, it } from "vitest";
import { assistCandidates, assistSystemPrompt, cleanAssistOutput, pickAssistModel, toTextModels } from "./prompt-assist";

describe("prompt assist", () => {
  const pricing = {
    data: [
      { model_name: "gpt-6-astra", supported_endpoint_types: ["openai"], enable_groups: ["default"] },
      { model_name: "gpt-5.6-luna", supported_endpoint_types: ["openai"], enable_groups: ["default"] },
      { model_name: "gpt-image-2", supported_endpoint_types: ["image-generation", "openai"] },
      { model_name: "ch0101-sd-2.0-480p", supported_endpoint_types: ["openai-video"] },
      { model_name: "responses-only", supported_endpoint_types: ["openai-response"] },
      { model_name: "vip-only", supported_endpoint_types: ["openai"], enable_groups: ["vip"] },
    ],
  };

  it("lists only chat-completions text models of the group", () => {
    expect(toTextModels(pricing)).toEqual(["gpt-5.6-luna", "gpt-6-astra"]);
    expect(toTextModels(pricing, null)).toEqual(["gpt-5.6-luna", "gpt-6-astra", "vip-only"]);
  });

  it("prefers a configured, then a light model", () => {
    const models = toTextModels(pricing);
    expect(pickAssistModel(models, undefined)).toBe("gpt-5.6-luna");
    expect(pickAssistModel(models, "gpt-6-astra")).toBe("gpt-6-astra");
    expect(pickAssistModel(["only-one"], "missing")).toBe("only-one");
    expect(pickAssistModel([], undefined)).toBeUndefined();
  });

  it("tries light models first and the flagship last", () => {
    expect(assistCandidates(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.6-luna"], undefined))
      .toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.5", "gpt-6-astra"]);
  });

  it("tells the model to keep reference markers", () => {
    expect(assistSystemPrompt("video")).toContain("镜头运动");
    expect(assistSystemPrompt("image")).toContain("构图");
    expect(assistSystemPrompt("image")).toContain("[图1]");
  });

  it("strips wrappers the model sometimes adds", () => {
    expect(cleanAssistOutput("提示词：一只猫")).toBe("一只猫");
    expect(cleanAssistOutput("```\n一只猫\n```")).toBe("一只猫");
    expect(cleanAssistOutput("“一只猫，[图1] 里的那只”")).toBe("一只猫，[图1] 里的那只");
  });
});
