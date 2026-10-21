import { describe, expect, it } from "vitest";
import { specClauses, specDurations, specFace, specMedia, specRatios, specResolutions, specSizes } from "./model-spec";

// 都是中转站上真实的模型描述
const spec = (text: string) => {
  const clauses = specClauses(text);
  return {
    resolutions: specResolutions(clauses).allowed,
    durations: specDurations(clauses),
    ratios: specRatios(clauses),
    sizes: specSizes(clauses),
    media: specMedia(clauses),
  };
};
const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, index) => min + index);

describe("model spec from relay descriptions", () => {
  it("reads the classic channel format", () => {
    const result = spec("(按秒计费) 9 图片， 3 音频， 3视频，合计≤ 12，720p，4s - 15s，可真人");
    expect(result.resolutions).toEqual(["720p"]);
    expect(result.durations).toEqual(range(4, 15));
    expect(result.ratios.allowed).toEqual([]);
    expect(result.media).toMatchObject({ images: 9, audios: 3, videos: 3, total: 12, frames: true });
    expect(specFace("…，可真人")).toBe("可真人");
    expect(spec("(按次计费) 30图片，10音频，0视频，合计≤40，720p，10s/30s，可真人").durations).toEqual([10, 30]);
    expect(spec("(按次计费) 10图片，0音频，0视频，合计≤10，720p，5s/10s/15s，卡人脸").durations).toEqual([5, 10, 15]);
  });

  it("does not read per-second prices as durations", () => {
    const result = spec("Seedance 2.5（通通api）：按秒计费，480p ¥0.345/秒、720p ¥0.46/秒、1080p ¥0.92/秒；480p / 720p / 1080p；4–30秒；比例 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9；30图/10视频/10音频，参考视频不加价；支持首尾帧，可选生成声音。");
    expect(result.durations).toEqual(range(4, 30));
    expect(spec("sd2.5 0.3-0.8元/秒，5秒/10秒").durations).toEqual([5, 10]);
  });

  it("reads ranges with dashes, ratio lists and per-kind limits", () => {
    const result = spec("BD2.5：720P，4–30 整数秒，按条计费；比例 16:9 / 9:16；最多 30 张参考图 / 10 段参考视频 / 10 段参考音频。");
    expect(result.resolutions).toEqual(["720p"]);
    expect(result.durations).toEqual(range(4, 30));
    expect(result.ratios.allowed).toEqual(["16:9", "9:16"]);
    expect(result.media).toMatchObject({ images: 30, videos: 10, audios: 10 });
  });

  it("ignores defaults and excluded values", () => {
    const mini = spec("适合用途：Mini 档首尾帧；4–15 秒；480p / 720p 同价，按次计费；最多 9 张参考图 / 3 段参考音频 / 3 段参考视频。使用注意：后台检查人脸，可能被拦截；首尾帧须成对。默认 480p，不提供 1080p / 4K。");
    expect(mini.resolutions.sort()).toEqual(["480p", "720p"]);
    expect(mini.media.frames).toBe(true);
    const grok = spec("文生 / 图生，按秒计费（不传 duration 按 6 秒）。时长 1–15 秒；480p / 720p；参考图最多 1。");
    expect(grok.durations).toEqual(range(1, 15));
    expect(grok.media).toMatchObject({ images: 1, mentioned: true });
    const ft = spec("FT视频；720p；4–15秒整数，默认15秒；9图/0视频/3音频；比例9:16/16:9/1:1/4:3/3:4/21:9；按条计费，不乘时长；按素材顺序@引用；文件24小时自动清理，请尽快下载。");
    expect(ft.durations).toEqual(range(4, 15));
    expect(ft.ratios.allowed).toEqual(["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"]);
    expect(ft.media).toMatchObject({ images: 9, videos: 0, audios: 3 });
  });

  it("reads discrete choices, fixed lengths and missing support", () => {
    const full = spec("满血720p，seedance2.5，仅支持15秒30秒选择，不卡脸；最多9张参考图，不支持视频/音频参考；比例16:9/9:16/1:1/3:4/4:3；按次计费，不乘时长；成片转存后保留24小时，请及时下载。");
    expect(full.durations).toEqual([15, 30]);
    expect(full.media).toMatchObject({ images: 9, videos: 0, audios: 0 });
    expect(spec("固定15秒·720p·Fast；最多9张图片参考，不支持视频/音频参考；按条收费").durations).toEqual([15]);
    expect(spec("YX Seedance 2.5：720P，固定 30 秒，按条计费；提示词 1–16000 字符；仅参考素材模式，不支持首尾帧；结果保留约 24 小时").durations).toEqual([30]);
    const pick = spec("适合用途：短片创作；720p，时长可选 5 / 10 / 15 秒，最多 9 张参考图。比例 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16。使用注意：有人脸限制；不支持参考音频、参考视频或首尾帧。");
    expect(pick.durations).toEqual([5, 10, 15]);
    expect(pick.media).toMatchObject({ images: 9, videos: 0, audios: 0, frames: false });
    const mm = spec("适合用途：固定 2K 多模态短片；固定 15 秒，最多 9 张参考图、3 段参考音频、3 段参考视频。使用注意：素材合计最多 10 个，参考视频总时长最多 15 秒，每段须提供真实时长；不支持首尾帧。");
    expect(mm.resolutions).toEqual(["2k"]);
    expect(mm.durations).toEqual([15]);
    expect(mm.media).toMatchObject({ images: 9, audios: 3, videos: 3, total: 10, frames: false });
    expect(spec("768p；1–15秒；9图/0视频/3音频；按秒计费").resolutions).toEqual(["768p"]);
  });

  it("leaves unmentioned things open", () => {
    const omni = spec("Omni 文生 / 图生视频，按次计费。");
    expect(omni.resolutions).toEqual([]);
    expect(omni.durations).toEqual([]);
    expect(omni.media.mentioned).toBe(false);
  });

  it("reads image tiers, sizes and ratio exclusions", () => {
    expect(spec("适合用途：Seedream 图片创作与参考编辑；1K / 2K，一次 1 张，最多 10 张参考图；通过比例或宽高选择画幅。").resolutions).toEqual(["1k", "2k"]);
    expect(spec("适合用途：Seedream 图片创作与参考编辑；1K / 2K，一次 1 张，最多 10 张参考图").media.images).toBe(10);
    expect(spec("Nano Banana 2 4K 固定档位，文生图 / 图生图，按张计费。").resolutions).toEqual(["4k"]);
    expect(spec("Banana 2 文生图 / 图生图。一次 1 张；quality 1k / 2k / 4k 按档位计价。").resolutions).toEqual(["1k", "2k", "4k"]);
    const noHigh = specResolutions(specClauses("无2k-4k"));
    expect(noHigh).toEqual({ allowed: [], excluded: ["2k", "4k"] });
    expect(spec("gpt-image-2（超分4K）性价比无敌").resolutions).toEqual([]);
    const grok = spec("仅文生图。size 1024x1024 / 1792x1024 / 1024x1792。");
    expect(grok.sizes).toEqual([[1024, 1024], [1792, 1024], [1024, 1792]]);
    expect(grok.media.images).toBe(0);
    const banana = spec("适合用途：较多参考图的高清创作；1K / 2K / 4K（quality 指定）；一次 1 张；最多 14 张参考图。使用注意：参考图 PNG / JPEG / WebP，每张不超过 35MB；不支持蒙版或 1:4 / 4:1 / 1:8 / 8:1；省略 size 为 1:1，省略 quality 为 1K。");
    expect(banana.ratios).toEqual({ allowed: [], excluded: ["1:4", "4:1", "1:8", "8:1"] });
    expect(banana.resolutions).toEqual(["1k", "2k", "4k"]);
    expect(banana.media.images).toBe(14);
    expect(spec("GPT Image 2 4K文生图/图生图模型；最多9张公网参考图；按次计费。").media.images).toBe(9);
  });
});
