import { describe, expect, it } from "vitest";
import {
  buildVideoRequest, expandDurations, fitVideoOptions, parseVideoDescription, remainingMedia, smartVideoRatio,
  effectivePricing, formatPrice, toVideoModels, videoPricing, videoRequestError, type VideoModel,
} from "./tangzhi";
import type { MediaRef, VideoOptions } from "./types";

const pricing = {
  group_ratio: { default: 1 },
  data: [
    {
      model_name: "ch0101-sd-2.0-720p", tags: "CH01", supported_endpoint_types: ["openai-video"],
      enable_groups: ["default"], billing_mode: "tiered_expr", billing_expr: 'tier("base", u("seconds") * 0.58)',
      model_price: 0.58, description: "(按秒计费) 9图片，3音频，3视频，合计≤12，720p，5s-15s，可真人",
    },
    {
      model_name: "ch1310-sd-2.5-720p", tags: "CH13", supported_endpoint_types: ["openai-video"],
      model_price: 9, description: "(按次计费) 30图片，10音频，0视频，合计≤40，720p，10s/30s，可真人",
    },
    {
      model_name: "ch8-sd-2.0-u2-720p", tags: "CH08", supported_endpoint_types: ["openai-video"],
      description: "(按秒计费) 9图片，3音频，3视频，合计≤12，720p，5s-15s，卡人脸",
    },
    {
      model_name: "doubao-seedance-2-5-260628", tags: "DOLA", supported_endpoint_types: ["openai-video"],
      model_price: 0.9, description: "(按次计费) 10图片，0音频，0视频，合计≤10，720p，5s/10s/30s",
    },
    { model_name: "ch5-gpt-image-2", supported_endpoint_types: ["image-generation"], description: null },
    { model_name: "no-desc", supported_endpoint_types: ["openai-video"], description: null },
  ],
};

const options = (patch: Partial<VideoOptions> = {}): VideoOptions => ({
  referenceMode: "references", ratio: "16:9", resolution: "720p", duration: 5,
  count: 1, audio: true, watermark: false, cameraFixed: false, ...patch,
});
const byId = (id: string) => toVideoModels(pricing).find((model) => model.id === id) as VideoModel;
const [ch01, ch1310, ch08] = ["ch0101-sd-2.0-720p", "ch1310-sd-2.5-720p", "ch8-sd-2.0-u2-720p"].map(byId);
const media = (kind: MediaRef["kind"], name: string): MediaRef => ({ kind, path: `uploads/${name}`, name });

describe("parseVideoDescription", () => {
  it("reads media limits, resolution, durations and face policy", () => {
    expect(parseVideoDescription("(按秒计费) 9 图片， 3 音频， 3视频，合计≤ 12，4k，4s - 15s，可真人")).toEqual({
      images: 9, audios: 3, videos: 3, total: 12, resolution: "4k",
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], face: "可真人",
    });
  });

  it("keeps discrete duration lists", () => {
    expect(expandDurations("10s/30s")).toEqual([10, 30]);
  });
});

describe("toVideoModels", () => {
  const models = toVideoModels(pricing);

  it("lists every video model; ones without a description get open defaults", () => {
    expect(models.map((model) => model.id)).toEqual([
      "ch8-sd-2.0-u2-720p", "ch0101-sd-2.0-720p", "ch1310-sd-2.5-720p", "doubao-seedance-2-5-260628", "no-desc",
    ]);
    expect(byId("no-desc")).toMatchObject({ resolutions: ["720p"], durations: [5, 10, 15], frames: true });
  });

  it("locks resolutions, durations, ratios, media and frames from the description", () => {
    const [mini, ft] = toVideoModels({
      data: [
        {
          model_name: "sd16-seedance-2.0-mini", supported_endpoint_types: ["openai-video"],
          description: "适合用途：Mini 档首尾帧；4–15 秒；480p / 720p 同价，按次计费；最多 9 张参考图 / 3 段参考音频 / 3 段参考视频。默认 480p，不提供 1080p / 4K。",
        },
        {
          model_name: "zz-ft-2.5", supported_endpoint_types: ["openai-video"],
          description: "满血720p，仅支持15秒30秒选择；最多9张参考图，不支持视频/音频参考；比例16:9/9:16/1:1；不支持首尾帧",
        },
      ],
    });
    expect(mini).toMatchObject({ resolution: "480p", resolutions: ["480p", "720p"], frames: true });
    expect(mini.durations).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(ft).toMatchObject({
      resolutions: ["720p"], durations: [15, 30], ratios: ["16:9", "9:16", "1:1"], frames: false,
      limits: { images: 9, audios: 0, videos: 0, total: 9 },
    });
    // 换到不支持首尾帧的模型时回到参考生成;选过的分辨率模型也有就保留
    expect(fitVideoOptions(ft, options({ referenceMode: "first_last", duration: 20 })))
      .toMatchObject({ referenceMode: "references", duration: 15 });
    expect(fitVideoOptions(mini, options({ resolution: "720p" })).resolution).toBe("720p");
    expect(fitVideoOptions(mini, options({ resolution: "1080p" })).resolution).toBe("480p");
    expect(videoRequestError(mini, "一只猫", options({ resolution: "1080p", duration: 5 }), [])).toMatch(/480P \/ 720P/);
    expect(videoRequestError(ft, "一只猫", options({ referenceMode: "first_last", duration: 15 }),
      [media("image", "a.png"), media("image", "b.png")])).toMatch(/不支持首尾帧/);
  });

  it("uses the per-second price from the billing expression", () => {
    expect(ch01).toMatchObject({ billing: "per_second", price: 0.58, durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] });
    expect(ch1310).toMatchObject({ billing: "per_request", price: 9, durations: [10, 30] });
  });

  it("limits CH08 models to portrait video", () => {
    expect(ch08.ratios).toEqual(["9:16"]);
  });
});

describe("model constraints", () => {

  it("pulls unsupported options back to what the model accepts", () => {
    expect(fitVideoOptions(ch01, options({ resolution: "1080p", duration: 3, ratio: "adaptive", referenceMode: "first" })))
      .toMatchObject({ resolution: "720p", duration: 5, ratio: "adaptive", referenceMode: "references" });
    // 只有一种比例的模型没有「智能」可选
    expect(fitVideoOptions(ch08, options({ ratio: "adaptive" })).ratio).toBe("9:16");
    expect(fitVideoOptions(ch1310, options({ duration: 15 })).duration).toBe(10);
    expect(fitVideoOptions(ch08, options()).ratio).toBe("9:16");
  });

  it("counts how many references of each kind are still allowed", () => {
    const attached = [media("image", "a.png"), media("video", "b.mp4")];
    expect(remainingMedia(ch01, "references", attached, "image")).toBe(8);
    expect(remainingMedia(ch01, "references", attached, "video")).toBe(2);
    expect(remainingMedia(ch1310, "references", [], "video")).toBe(0);
    expect(remainingMedia(ch01, "first_last", [media("image", "a.png")], "image")).toBe(1);
    expect(remainingMedia(ch01, "first_last", [], "audio")).toBe(0);
    // 旧的「文生视频」模式按参考生成处理:随时可以添加素材
    expect(remainingMedia(ch01, "text", [], "image")).toBe(9);
  });

  it("stops at the combined media limit", () => {
    const full = [
      ...Array.from({ length: 9 }, (_, i) => media("image", `${i}.png`)),
      ...Array.from({ length: 3 }, (_, i) => media("audio", `${i}.mp3`)),
    ];
    expect(remainingMedia(ch01, "references", full, "video")).toBe(0);
  });

  it("rejects requests outside the model's limits", () => {
    const prompt = "一只猫在窗台上打哈欠，阳光洒进来";
    // 不限最少字数,只要不是空的
    expect(videoRequestError(ch01, "跳跃", options(), [])).toBe("");
    expect(videoRequestError(ch01, "  ", options(), [])).toMatch(/填写提示词/);
    expect(videoRequestError(ch01, prompt, options({ resolution: "1080p" }), [])).toMatch(/720P/);
    expect(videoRequestError(ch01, prompt, options({ duration: 4 }), [])).toMatch(/5–15秒/);
    expect(videoRequestError(ch08, prompt, options(), [])).toMatch(/9:16/);
    expect(videoRequestError(ch1310, prompt, options({ duration: 10 }), [media("video", "a.mp4")])).toMatch(/不支持参考视频/);
    expect(videoRequestError(ch01, prompt, options({ referenceMode: "first_last" }), [media("image", "a.png")])).toMatch(/两张/);
    // 没有素材就是文生视频,任何生成方式都可以提交
    expect(videoRequestError(ch01, prompt, options({ referenceMode: "references" }), [])).toBe("");
    expect(videoRequestError(ch01, prompt, options({ referenceMode: "first_last" }), [])).toBe("");
    expect(videoRequestError(ch01, prompt, options(), [media("image", "a.png"), media("audio", "b.mp3")])).toBe("");
  });
});

describe("buildVideoRequest", () => {
  const url = (item: MediaRef) => `https://vip.example/api/media/${item.path}`;

  it("uses singular fields for one item and plural fields for several", () => {
    const body = buildVideoRequest(ch01, "  提示词内容足够长了吧  ", options(), [
      media("image", "a.png"), media("image", "b.png"), media("audio", "c.mp3"),
    ], url, "mote_1");
    expect(body).toEqual({
      model: "ch0101-sd-2.0-720p", prompt: "提示词内容足够长了吧", client_task_id: "mote_1",
      mode: "references", aspect_ratio: "16:9", duration: 5, resolution: "720p",
      references: {
        images: ["https://vip.example/api/media/uploads/a.png", "https://vip.example/api/media/uploads/b.png"],
        audio: "https://vip.example/api/media/uploads/c.mp3",
      },
    });
  });

  it("sends first and last frames in frames mode", () => {
    const body = buildVideoRequest(ch01, "提示词内容足够长了吧", options({ referenceMode: "first_last" }),
      [media("image", "a.png"), media("image", "b.png")], url, "mote_2");
    expect(body.mode).toBe("frames");
    expect(body.frames).toEqual({
      first_frame: "https://vip.example/api/media/uploads/a.png",
      last_frame: "https://vip.example/api/media/uploads/b.png",
    });
    expect(body.references).toBeUndefined();
  });

  it("omits references for text-to-video", () => {
    const body = buildVideoRequest(ch01, "提示词内容足够长了吧", options({ referenceMode: "text" }), [], url, "mote_3");
    expect(body).not.toHaveProperty("references");
    expect(body.mode).toBe("references");
  });

  it("falls back to text-to-video when first/last frame is chosen without images", () => {
    const body = buildVideoRequest(ch01, "提示词内容足够长了吧", options({ referenceMode: "first_last" }), [], url, "mote_4");
    expect(body.mode).toBe("references");
    expect(body).not.toHaveProperty("frames");
  });
});

describe("Dola (Ark) models", () => {
  const dola = byId("doubao-seedance-2-5-260628");
  const url = (item: MediaRef) => `https://media.example/${item.path}`;

  it("are routed through the Ark protocol with every ratio including 21:9", () => {
    expect(dola.protocol).toBe("ark");
    expect(ch01.protocol).toBe("videos");
    expect(dola.durations).toEqual([5, 10, 30]);
    expect(dola.ratios).toContain("21:9");
  });

  it("sends duration as seconds and ratio in metadata (30 s must not become 5 s)", () => {
    const body = buildVideoRequest(dola, "女生往前奔跑跳跃，然后向空中翻转", options({ duration: 30 }),
      [media("image", "girl.png")], url, "mote_x");
    expect(body).toEqual({
      model: "doubao-seedance-2-5-260628",
      prompt: "女生往前奔跑跳跃，然后向空中翻转",
      seconds: "30",
      metadata: { ratio: "16:9", resolution: "720p" },
      images: ["https://media.example/uploads/girl.png"],
    });
    expect(body).not.toHaveProperty("duration");
    expect(body).not.toHaveProperty("references");
  });

  it("passes 21:9 through in metadata.ratio", () => {
    const body = buildVideoRequest(dola, "广袤的金色沙漠，一位旅人缓缓走过", options({ ratio: "21:9", duration: 10 }), [], url, "mote_w");
    expect(body.metadata).toEqual({ ratio: "21:9", resolution: "720p" });
  });

  it("puts first and last frames into metadata.content with roles", () => {
    const body = buildVideoRequest(dola, "提示词内容足够长了吧", options({ referenceMode: "first_last", duration: 10 }),
      [media("image", "a.png"), media("image", "b.png")], url, "mote_y");
    expect(body.metadata).toEqual({
      ratio: "16:9", resolution: "720p",
      content: [
        { type: "image_url", image_url: { url: "https://media.example/uploads/a.png" }, role: "first_frame" },
        { type: "image_url", image_url: { url: "https://media.example/uploads/b.png" }, role: "last_frame" },
      ],
    });
    expect(body).not.toHaveProperty("images");
  });

  it("text-to-video carries no images", () => {
    const body = buildVideoRequest(dola, "提示词内容足够长了吧", options({ duration: 5 }), [], url, "mote_z");
    expect(body).toEqual({
      model: "doubao-seedance-2-5-260628", prompt: "提示词内容足够长了吧", seconds: "5",
      metadata: { ratio: "16:9", resolution: "720p" },
    });
  });
});

describe("smartVideoRatio", () => {
  const all = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;
  it("follows the first reference image", () => {
    expect(smartVideoRatio(all, "随便", { width: 1080, height: 1920 })).toBe("9:16");
    expect(smartVideoRatio(all, "竖屏", { width: 1024, height: 1000 })).toBe("1:1");
    expect(smartVideoRatio(["16:9", "9:16"], "x", { width: 1000, height: 1000 })).toBe("16:9");
  });
  it("reads ratio hints from the prompt", () => {
    expect(smartVideoRatio(all, "抖音竖屏，一个女孩在跳舞")).toBe("9:16");
    expect(smartVideoRatio(all, "宽银幕史诗大片")).toBe("21:9");
    expect(smartVideoRatio(all, "正方形构图的产品展示")).toBe("1:1");
    expect(smartVideoRatio(all, "比例 4:3 的复古画面")).toBe("4:3");
    expect(smartVideoRatio(all, "一只猫")).toBe("16:9");
    // 模型没有 21:9 时就近取 16:9
    expect(smartVideoRatio(["16:9", "9:16"], "超宽画幅")).toBe("16:9");
  });
});

describe("video prices from the relay's billing expressions", () => {
  const entry = (billing_expr: string) => ({ billing_mode: "tiered_expr", billing_expr });
  it("reads per-video, per-second and per-resolution prices", () => {
    expect(videoPricing(entry('tier("base", u("videos") * 5.52)'), ["720p"])).toEqual({ billing: "per_request", prices: { "720p": 5.52 } });
    expect(videoPricing(entry('tier("base", u("seconds") * 0.53)'), ["480p"])).toEqual({ billing: "per_second", prices: { "480p": 0.53 } });
    expect(videoPricing(entry('u("resolution") == "720p" ? tier("720p", u("seconds") * 0.1455) : tier("480p", u("seconds") * 0.1058)'),
      ["480p", "720p"])).toEqual({ billing: "per_second", prices: { "480p": 0.1058, "720p": 0.1455 } });
    expect(videoPricing({ quota_type: 1, model_price: 6.9 }, ["720p"])).toEqual({ billing: "per_request", prices: { "720p": 6.9 } });
    // 主表达式是内置豆包插件的固定价,dola 插件有自己的按分辨率价格:以 dola 的为准
    const both = effectivePricing({ billing_mode: "tiered_expr", billing_expr: 'tier("720p", 1.2)', billing_plugin_variants: [
      { plugin_key: "doubao", billing_mode: "tiered_expr", billing_expr: 'tier("720p", 1.2)' },
      { plugin_key: "dola", billing_mode: "tiered_expr", billing_expr: 'u("resolution") == "2k" ? tier("2k", u("seconds") * 0.7) : tier("720p", 1.2)' },
    ] });
    expect(videoPricing(both, ["720p", "2k"]).prices).toEqual({ "720p": 1.2, "2k": 0.7 });
    // dola:720p 一条固定价,超分档按秒 —— 每档各自记计费方式
    const dola = videoPricing(entry('u("resolution") == "1080p" ? tier("1080p", u("seconds") * 0.4) : u("resolution") == "2k" ? tier("2k", u("seconds") * 0.7) : u("resolution") == "4k" ? tier("4k", u("seconds") * 1.2) : u("resolution") == "480p" ? tier("480p", 1.2) : tier("720p", 1.2)'),
      ["480p", "720p", "1080p", "2k", "4k"]);
    expect(dola.prices).toEqual({ "480p": 1.2, "720p": 1.2, "1080p": 0.4, "2k": 0.7, "4k": 1.2 });
    expect("billings" in dola && dola.billings).toEqual({ "480p": "per_request", "720p": "per_request", "1080p": "per_second", "2k": "per_second", "4k": "per_second" });
    expect(formatPrice({ billing: "per_second", price: 1.2, prices: { "720p": 1.2, "2k": 0.7 }, billings: { "720p": "per_request", "2k": "per_second" } }, "720p")).toBe("¥1.20/条");
    expect(formatPrice({ billing: "per_second", price: 1.2, prices: { "720p": 1.2, "2k": 0.7 }, billings: { "720p": "per_request", "2k": "per_second" } }, "2k")).toBe("¥0.70/秒");
    expect(videoPricing({}, ["720p"]).prices).toEqual({});
  });

  it("shows the price for the chosen resolution, or 价格未知", () => {
    const model = { billing: "per_second" as const, price: 0.1058, prices: { "480p": 0.1058, "720p": 0.1455 } };
    expect(formatPrice(model, "720p")).toBe("¥0.15/秒");
    expect(formatPrice({ billing: "per_request", price: 0 })).toBe("价格未知");
  });
});
