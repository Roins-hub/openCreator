import { describe, expect, it } from "vitest";
import {
  fitImageOptions, imageDefaults, imageOptionsSummary, imageRequestError, imageSize, nearestChatRatio, tierPrice, toImageModels,
  fitImageToModel, imageSpec, withComposition,
  type ImageModel,
} from "./image-models";

const model: ImageModel = {
  type: "image", id: "gpt-image-2", api: "images", tag: "", description: "", price: { kind: "unknown" }, priceLabel: "按量计费", priceDetail: "按量计费", maxReferences: 4, promptMax: 6000,
  vendor: "OpenAI", series: "GPT Image 2", resolutions: ["1k", "2k", "4k"], excludedRatios: [],
};

describe("image sizes", () => {
  it("uses the standard size for 1K and the long edge for 2K / 4K", () => {
    expect(imageSize("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(imageSize("16:9", "1k")).toEqual({ width: 1280, height: 720 });
    expect(imageSize("16:9", "2k")).toEqual({ width: 2048, height: 1152 });
    expect(imageSize("9:16", "4k")).toEqual({ width: 2304, height: 4096 });
    expect(imageSize("4:3", "4k")).toEqual({ width: 4096, height: 3072 });
    // 其他比例:长边 1280 / 2048 / 4096,边长取 16 的倍数
    expect(imageSize("21:9", "1k")).toEqual({ width: 1280, height: 544 });
    expect(imageSize("21:9", "4k")).toEqual({ width: 4096, height: 1760 });
    expect(imageSize("5:4", "2k")).toEqual({ width: 2048, height: 1632 });
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
    expect(fitImageOptions({ ratio: "1:9", count: 9, resolution: "720p", quality: "high" } as never))
      .toEqual({ ...imageDefaults, count: 4 });
    // 21:9 和自定义比例都保留;长短边之比超过 4 的不要
    expect(fitImageOptions({ ratio: "21:9" }).ratio).toBe("21:9");
    expect(fitImageOptions({ ratio: " 5:4 " }).ratio).toBe("5:4");
    expect(fitImageOptions({ ratio: "0:4" }).ratio).toBe("1:1");
    expect(fitImageOptions({ resolution: "4k" }).resolution).toBe("4k");
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
    expect(imageOptionsSummary(imageDefaults)).toEqual(["1:1", "1K", "PNG"]);
    expect(imageOptionsSummary({ ...imageDefaults, resolution: "2k", background: "transparent", count: 3 }))
      .toEqual(["1:1", "2K", "透明背景", "PNG", "3 张"]);
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
      // 只有对话端点的 Gemini 生图模型
      { model_name: "Nano Banana 2", supported_endpoint_types: ["openai"], enable_groups: ["default"], billing_mode: "tiered_expr", billing_expr: SIZE_TIERS, model_price: 1.2, quota_type: 1 },
      { model_name: "gemini-3.8-flash", supported_endpoint_types: ["gemini", "openai"], enable_groups: ["default"], billing_mode: "tiered_expr", billing_expr: TOKENS },
    ],
  };
  const byId = (rate = 1) => Object.fromEntries(toImageModels(pricing, "default", rate).map((item) => [item.id, item]));

  it("keeps only image-generation models available to the group", () => {
    expect(toImageModels(pricing).map((item) => item.id)).toEqual(["ch5-gpt-image-2", "flat-image", "gpt-image-2", "Nano Banana 2", "ratio-image"]);
  });

  it("treats chat-only Gemini image models (Nano Banana) as image models", () => {
    const nano = byId()["Nano Banana 2"];
    expect(nano).toMatchObject({ api: "chat", maxReferences: 14, priceDetail: "1K ¥0.12 · 2K ¥0.24 · 4K ¥0.36（每张）" });
    expect(byId()["gpt-image-2"].api).toBe("images");
    expect(byId()["gemini-3.8-flash"]).toBeUndefined();
    // 对话式生图不拦透明背景 + JPEG(这两个选项不会发出去)
    expect(imageRequestError(nano, "猫", { ...imageDefaults, background: "transparent", format: "jpeg" }, [])).toBe("");
  });

  it("maps any ratio to the nearest one Gemini supports", () => {
    expect(nearestChatRatio("16:9")).toBe("16:9");
    expect(nearestChatRatio("2:1")).toBe("16:9");
    expect(nearestChatRatio("5:7")).toBe("3:4");
    expect(nearestChatRatio("7:10")).toBe("2:3");
    expect(nearestChatRatio("1:4")).toBe("9:16");
    expect(nearestChatRatio("12:5")).toBe("21:9");
  });

  it("reads size tiers from the relay's billing expression", () => {
    const model = byId()["ch5-gpt-image-2"];
    expect(model.price).toEqual({ kind: "per_image", current: 0.12, tiers: [
      { name: "1K", price: 0.12 }, { name: "2K", price: 0.24 }, { name: "4K", price: 0.36 },
    ] });
    expect(model.priceLabel).toBe("¥0.12/张");
    expect(model.priceDetail).toBe("1K ¥0.12 · 2K ¥0.24 · 4K ¥0.36（每张）");
    expect(model).toMatchObject({ type: "image", description: "GPT-Image-2 生图", maxReferences: 20 });
  });

  it("reads per-million token rates from token expressions and model ratios", () => {
    expect(byId()["gpt-image-2"].price).toEqual({ kind: "tokens", rates: { input: 5, output: 30, imageInput: 8 } });
    expect(byId()["gpt-image-2"].priceDetail).toBe("输入 ¥5.00 · 输出 ¥30.00 · 图片输入 ¥8.00（每百万 tokens）");
    expect(byId()["gpt-image-2"].priceLabel).toBe("按量 · 输出 ¥30.00/百万");
    expect(byId()["ratio-image"].price).toEqual({ kind: "tokens", rates: { input: 5, output: 20, imageInput: 0 } });
  });

  it("prices each resolution tier", () => {
    const { price } = byId()["ch5-gpt-image-2"];
    expect([tierPrice(price, "1k"), tierPrice(price, "2k"), tierPrice(price, "4k")]).toEqual([0.12, 0.24, 0.36]);
    expect(tierPrice(byId()["flat-image"].price, "4k")).toBe(0.3);
    expect(tierPrice(byId()["gpt-image-2"].price, "2k")).toBeUndefined();
  });

  it("uses flat per-image prices and applies the recharge rate", () => {
    expect(byId()["flat-image"].priceLabel).toBe("¥0.30/张");
    expect(byId(7)["ch5-gpt-image-2"].priceDetail).toBe("1K ¥0.84 · 2K ¥1.68 · 4K ¥2.52（每张）");
  });
});

describe("image limits from relay descriptions", () => {
  it("locks tiers, ratios, fixed sizes and references", () => {
    expect(imageSpec("适合用途：Seedream 图片创作与参考编辑；1K / 2K，一次 1 张，最多 10 张参考图；通过比例或宽高选择画幅。", false))
      .toMatchObject({ resolutions: ["1k", "2k"], ratios: undefined, maxReferences: 10 });
    expect(imageSpec("无2k-4k", false).resolutions).toEqual(["1k"]);
    expect(imageSpec("Nano Banana 2 4K 固定档位，文生图 / 图生图，按张计费。", false).resolutions).toEqual(["4k"]);
    const grok = imageSpec("仅文生图。size 1024x1024 / 1792x1024 / 1024x1792。", false);
    expect(grok).toMatchObject({ resolutions: ["1k"], ratios: ["1:1", "16:9", "9:16"], maxReferences: 0 });
    expect(imageSize("16:9", "1k", grok.sizes)).toEqual({ width: 1792, height: 1024 });
    const banana = imageSpec("1K / 2K / 4K（quality 指定）；最多 14 张参考图。使用注意：不支持蒙版或 1:4 / 4:1 / 1:8 / 8:1；省略 size 为 1:1", true);
    expect(banana).toMatchObject({ resolutions: ["1k", "2k", "4k"], excludedRatios: ["1:4", "4:1", "1:8", "8:1"], maxReferences: 14 });
    expect(imageSpec("", false)).toMatchObject({ resolutions: ["1k", "2k", "4k"], ratios: undefined, maxReferences: 20 });
  });

  it("fits options to the model and rejects what it can't do", () => {
    const grok = { ...model, ...imageSpec("仅文生图。size 1024x1024 / 1792x1024 / 1024x1792。", false) };
    expect(fitImageToModel(grok, { ...imageDefaults, ratio: "21:9", resolution: "4k" })).toMatchObject({ ratio: "16:9", resolution: "1k" });
    expect(imageRequestError(grok, "猫", { ...imageDefaults, ratio: "4:3" }, [])).toMatch(/1:1 \/ 16:9 \/ 9:16/);
    expect(imageRequestError(grok, "猫", imageDefaults, [{ kind: "image" }])).toMatch(/只支持文生图/);
    const twoTiers = { ...model, ...imageSpec("1K / 2K", false) };
    expect(fitImageToModel(twoTiers, { ...imageDefaults, resolution: "4k" }).resolution).toBe("2k");
  });
});
