import { describe, expect, it } from "vitest";
import {
  fitImageOptions, imageDefaults, imageOptionsSummary, imageRequestError, imageSize, toImageModels, withComposition,
  type ImageModel,
} from "./image-models";

const model: ImageModel = {
  type: "image", id: "gpt-image-2", tag: "", description: "", priceLabel: "按量计费", maxReferences: 4, promptMax: 6000,
};

describe("image sizes", () => {
  it("requests the standard size of each ratio (the relay ignores larger tiers but charges for them)", () => {
    expect(imageSize("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(imageSize("16:9")).toEqual({ width: 1280, height: 720 });
    expect(imageSize("3:4")).toEqual({ width: 720, height: 960 });
  });

  it("states the canvas ratio in the prompt", () => {
    expect(withComposition("海报", "16:9")).toContain("16:9，横版");
    expect(withComposition("海报", "3:4")).toContain("3:4，竖版");
    expect(withComposition("海报", "1:1")).toContain("正方形");
  });
});

describe("image options", () => {
  it("fills in defaults and drops values from older formats", () => {
    expect(fitImageOptions(undefined)).toEqual(imageDefaults);
    expect(fitImageOptions({ ratio: "21:9" as never, count: 9, ...{ resolution: "4K", quality: "high" } }))
      .toEqual({ ...imageDefaults, count: 4 });
  });

  it("validates prompt, references and transparent JPEG", () => {
    expect(imageRequestError(model, "  ", imageDefaults, [])).toBe("请先填写提示词");
    expect(imageRequestError(model, "一只猫", imageDefaults, [{ kind: "video" }])).toBe("生图只能用图片作为参考");
    expect(imageRequestError(model, "一只猫", imageDefaults, Array.from({ length: 5 }, () => ({ kind: "image" as const }))))
      .toBe("最多 4 张参考图");
    expect(imageRequestError(model, "一只猫", { ...imageDefaults, background: "transparent", format: "jpeg" }, []))
      .toBe("透明背景需要 PNG 或 WebP 格式");
    expect(imageRequestError(model, "一只猫", imageDefaults, [{ kind: "image" }])).toBe("");
  });

  it("summarises only the non-default options", () => {
    expect(imageOptionsSummary(imageDefaults)).toEqual(["1:1", "PNG"]);
    expect(imageOptionsSummary({ ...imageDefaults, background: "transparent", count: 3 }))
      .toEqual(["1:1", "透明背景", "PNG", "3 张"]);
  });
});

describe("toImageModels", () => {
  const pricing = {
    group_ratio: { default: 1 },
    data: [
      { model_name: "gpt-image-2", supported_endpoint_types: ["image-generation", "openai"], enable_groups: ["default"], billing_mode: "tiered_expr", model_price: 0, quota_type: 0 },
      { model_name: "ch5-gpt-image-2", supported_endpoint_types: ["image-generation"], enable_groups: ["default"], billing_mode: "tiered_expr", model_price: 0.12, quota_type: 1, description: "GPT-Image-2 生图" },
      { model_name: "flat-image", supported_endpoint_types: ["image-generation"], model_price: 0.3, quota_type: 1 },
      { model_name: "vip-image", supported_endpoint_types: ["image-generation"], enable_groups: ["vip"], model_price: 1, quota_type: 1 },
      { model_name: "gpt-5.5", supported_endpoint_types: ["openai"] },
      { model_name: "ch0101-sd-2.0-480p", supported_endpoint_types: ["openai-video"] },
    ],
  };

  it("keeps only image-generation models available to the group", () => {
    expect(toImageModels(pricing).map((item) => item.id)).toEqual(["ch5-gpt-image-2", "flat-image", "gpt-image-2"]);
  });

  it("labels per-image prices and token billing", () => {
    const byId = Object.fromEntries(toImageModels(pricing).map((item) => [item.id, item]));
    expect(byId["gpt-image-2"].priceLabel).toBe("按量计费");
    expect(byId["ch5-gpt-image-2"].priceLabel).toBe("¥0.12/张起");
    expect(byId["flat-image"].priceLabel).toBe("¥0.30/张");
    expect(byId["ch5-gpt-image-2"]).toMatchObject({ type: "image", description: "GPT-Image-2 生图", maxReferences: 4 });
  });
});
