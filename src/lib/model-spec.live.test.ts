import { describe, expect, it } from "vitest";
import fixture from "./model-spec.live.fixture.json";
import { channelTag, resolutionFromName, specWarnings, toVideoModels, type VideoModel } from "./tangzhi";

/**
 * 线上真实的模型描述样本(new.tangzhi.org /api/pricing 里的视频模型,见 fixture 的 capturedAt)。
 * 中转站加了新写法的模型、工作台读错参数时:把那条描述加进 fixture,在下面写上期望值,再改解析规则。
 * 更新整份样本:取 /api/pricing,只留 openai-video 模型的名字、标签、描述和计费字段。
 */
const models = toVideoModels(fixture as Parameters<typeof toVideoModels>[0]);
const byId = (id: string) => models.find((model) => model.id === id) as VideoModel;

describe("live model descriptions", () => {
  it("parses every captured video model without warnings", () => {
    expect(models.length).toBeGreaterThan(50);
    const problems = models.map((model) => [model.id, specWarnings(model)] as const).filter(([, warnings]) => warnings.length);
    expect(problems).toEqual([]);
  });

  it("reads only the generation range when the text also talks about reference and audio seconds", () => {
    // 「720p、4–30s，默认4秒…参考视频每段2–15秒…音频最短2秒与音频合计1秒」
    const xb = byId("XB-SD2.5-30参");
    expect(xb.durations[0]).toBe(4);
    expect(xb.durations.at(-1)).toBe(30);
    expect(xb.durations).toHaveLength(27);
    expect(xb.limits).toMatchObject({ images: 30, videos: 10, audios: 10, total: 30 });
    // 「不要传…首尾帧」
    expect(xb.frames).toBe(false);
    expect(xb.tag).toBe("");
  });

  it("reads counts written after the media word", () => {
    // 「参考图 3、音频 1，不支持参考视频」
    expect(byId("sd8-seedance-2.0-mini").limits).toMatchObject({ images: 3, audios: 1, videos: 0 });
  });

  it("takes the resolution from names like cvk-原生满血-480", () => {
    expect(byId("cvk-原生满血-480").resolutions).toEqual(["480p"]);
    expect(resolutionFromName("cvk-2.5-1080")).toBe("1080p");
    expect(resolutionFromName("seedance-2.0-fast")).toBe("");
  });

  it("keeps channel codes and drops category tags", () => {
    expect(channelTag("CH01")).toBe("CH01");
    expect(channelTag("DOLA")).toBe("DOLA");
    expect(channelTag("video")).toBe("");
    expect(channelTag("视频生成,图生视频,最多4张参考图,按秒计费")).toBe("");
    expect(byId("seedance-2.0-fast").tag).toBe("DOLA");
    // 第一个是分类标签时不往后找,后面的「MiniMax」「Seedance」是系列名
    expect(channelTag("视频,MiniMax")).toBe("");
    expect(models.filter((model) => model.tag).map((model) => model.tag).sort().filter((tag, i, all) => all.indexOf(tag) === i))
      .toEqual(["CH01", "CH13", "DOLA"]);
  });
});
