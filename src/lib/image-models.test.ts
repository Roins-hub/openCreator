import { describe, expect, it } from "vitest";
import {
  fitImageOptions, imageDefaults, imageOptionsSummary, imageRequestError, imageSize, toImageModels, withComposition,
  type ImageModel,
} from "./image-models";

const model: ImageModel = {
  type: "image", id: "gpt-image-2", tag: "", description: "", price: { kind: "unknown" }, priceLabel: "按量计费", priceDetail: "按量计费", maxReferences: 4, promptMax: 6000,
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
  // 2026-10-15 new.tangzhi.org /api/pricing 里的真实计费表达式
  const SIZE_TIERS = `(!(has(param("size"), "2048") || has(param("size"), "2560") || has(param("size"), "1440") || has(param("size"), "2K") || has(param("size"), "2k") || has(param("size"), "3840") || has(param("size"), "2160") || has(param("size"), "2880") || has(param("size"), "4096") || has(param("size"), "4K") || has(param("size"), "4k")) ? tier("1K", fixed(0.12)) : !(has(param("size"), "3840") || has(param("size"), "2160") || has(param("size"), "2880") || has(param("size"), "4096") || has(param("size"), "4K") || has(param("size"), "4k")) ? tier("2K", fixed(0.24)) : tier("4K", fixed(0.36))) * image_count`;
  const TOKENS = 'tier("standard", p * 5 + cr * 1.25 + img * 8 + img_cr * 2 + c * 30)';
  const pricing = {
    group_ratio: { default: 1 },
    data: [
      { model_name: "gpt-image-2", supported_endpoint_types: ["image-generation", "openai"], enable_groups: ["default"], billing_mode: "tiered_expr", billing_expr: TOKENS, model_price: 0, quota_type: 0 },
      { model_name: "ch5-gpt-image-2", supported_endpoint_types: ["image-generation"], enable_groups: ["default"], billing_mode: "tiered_expr", billing_expr: SIZE_TIERS, model_price: 0.12, quota_type: 1, description: "GPT-Image-2 生图" },
      { model_name: "flat-image", supported_endpoint_types: ["image-generation"], model_price: 0.3, quota_type: 1 },
      { model_name: "ratio-image", supported_endpoint_types: ["image-generation"], model_ratio: 2.5, completion_ratio: 4, quota_type: 0 },
      { model_name: "vip-image", supported_endpoint_types: ["image-generation"], enable_groups: ["vip"], model_price: 1, quota_type: 1 },
      { model_name: "gpt-5.5", supported_endpoint_types: ["openai"] },
      { model_name: "ch0101-sd-2.0-480p", supported_endpoint_types: ["openai-video"] },
    ],
  };
  const byId = (rate = 1) => Object.fromEntries(toImageModels(pricing, "default", rate).map((item) => [item.id, item]));

  it("keeps only image-generation models available to the group", () => {
    expect(toImageModels(pricing).map((item) => item.id)).toEqual(["ch5-gpt-image-2", "flat-image", "gpt-image-2", "ratio-image"]);
  });

  it("reads size tiers from the relay's billing expression", () => {
    const model = byId()["ch5-gpt-image-2"];
    expect(model.price).toEqual({ kind: "per_image", current: 0.12, tiers: [
      { name: "1K", price: 0.12 }, { name: "2K", price: 0.24 }, { name: "4K", price: 0.36 },
    ] });
    expect(model.priceLabel).toBe("¥0.12/张");
    expect(model.priceDetail).toBe("1K ¥0.12 · 2K ¥0.24 · 4K ¥0.36（每张）");
    expect(model).toMatchObject({ type: "image", description: "GPT-Image-2 生图", maxReferences: 4 });
  });

  it("reads per-million token rates from token expressions and model ratios", () => {
    expect(byId()["gpt-image-2"].price).toEqual({ kind: "tokens", rates: { input: 5, output: 30, imageInput: 8 } });
    expect(byId()["gpt-image-2"].priceDetail).toBe("输入 ¥5.00 · 输出 ¥30.00 · 图片输入 ¥8.00（每百万 tokens）");
    expect(byId()["gpt-image-2"].priceLabel).toBe("按量 · 输出 ¥30.00/百万");
    expect(byId()["ratio-image"].price).toEqual({ kind: "tokens", rates: { input: 5, output: 20, imageInput: 0 } });
  });

  it("uses flat per-image prices and applies the recharge rate", () => {
    expect(byId()["flat-image"].priceLabel).toBe("¥0.30/张");
    expect(byId(7)["ch5-gpt-image-2"].priceDetail).toBe("1K ¥0.84 · 2K ¥1.68 · 4K ¥2.52（每张）");
  });
});
