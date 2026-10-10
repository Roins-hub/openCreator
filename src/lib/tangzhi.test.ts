import { describe, expect, it } from "vitest";
import {
  buildVideoRequest, expandDurations, fitVideoOptions, parseVideoDescription, remainingMedia,
  toVideoModels, videoRequestError, type VideoModel,
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

  it("keeps only video models with a complete description", () => {
    expect(models.map((model) => model.id)).toEqual([
      "ch8-sd-2.0-u2-720p", "ch0101-sd-2.0-720p", "ch1310-sd-2.5-720p", "doubao-seedance-2-5-260628",
    ]);
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
      .toMatchObject({ resolution: "720p", duration: 5, ratio: "16:9", referenceMode: "references" });
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
    expect(videoRequestError(ch01, "太短了", options(), [])).toMatch(/至少/);
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

  it("are routed through the Ark protocol with Dola's ratios", () => {
    expect(dola.protocol).toBe("ark");
    expect(ch01.protocol).toBe("videos");
    expect(dola.durations).toEqual([5, 10, 30]);
    expect(dola.ratios).not.toContain("21:9");
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
