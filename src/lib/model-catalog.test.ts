import { describe, expect, it } from "vitest";
import { channelOf, classifyModel, groupModels, matchesQuery, seriesFromName, vendorFromName } from "./model-catalog";

describe("model catalog grouping", () => {
  it("recognizes series from the relay's model names", () => {
    expect(seriesFromName("ch0101-sd-2.0-480p")).toBe("Seedance 2.0");
    expect(seriesFromName("ch0112-sd-2.0-480p-fast")).toBe("Seedance 2.0 Fast");
    expect(seriesFromName("ch0113-sd-2.0-720p-mini")).toBe("Seedance 2.0 Mini");
    expect(seriesFromName("ch1307-sd-2.5-720p")).toBe("Seedance 2.5");
    expect(seriesFromName("doubao-seedance-2-0-260128")).toBe("Seedance 2.0");
    expect(seriesFromName("gpt-image-2")).toBe("GPT Image 2");
    expect(seriesFromName("gpt-image-2-cf")).toBe("GPT Image 2");
    expect(seriesFromName("gpt-image-2.5-flare-no-2k-4k")).toBe("GPT Image 2.5 Flare");
    expect(seriesFromName("gpt-image-2.5-sunburst-cf")).toBe("GPT Image 2.5 Sunburst");
    expect(seriesFromName("Nano Banana Pro")).toBe("Nano Banana Pro");
  });

  it("handles families it has never seen", () => {
    expect(seriesFromName("veo-3.1-fast")).toBe("Veo 3.1 Fast");
    expect(seriesFromName("veo3")).toBe("Veo 3");
    expect(seriesFromName("MiniMax-Hailuo-02")).toBe("Hailuo 02");
    expect(seriesFromName("kling-v2-1-master")).toBe("Kling v2.1 Master");
    expect(seriesFromName("wan2.5-t2v-preview")).toBe("Wan 2.5 Preview");
    expect(seriesFromName("sora-2-pro")).toBe("Sora 2 Pro");
    expect(seriesFromName("some-new-model")).toBe("Some New Model");
  });

  it("ignores relay line codes, marketing words and line numbers", () => {
    expect(seriesFromName("sd16-seedance-2.0-fast")).toBe("Seedance 2.0 Fast");
    expect(seriesFromName("sd17-seedance-2.5-2")).toBe("Seedance 2.5");
    expect(seriesFromName("mm4-minimax-h3-2k")).toBe("MiniMax H3");
    expect(seriesFromName("FT特价MiniMax H3-768p")).toBe("MiniMax H3");
    expect(seriesFromName("gv4-grok-imagine-video-1.5")).toBe("Grok Imagine 1.5");
    expect(seriesFromName("yx-seedance2.5-count-720")).toBe("Seedance 2.5");
    expect(seriesFromName("zy-2.0fast-900")).toBe("2.0 Fast");
    expect(seriesFromName("omni-fast-no-water")).toBe("Omni Fast");
    expect(classifyModel("bb2.5", "", "Seedance")).toEqual({ vendor: "Seedance", series: "Seedance 2.5" });
    expect(classifyModel("FT-官渠特价2.0-903", "", "Seedance").series).toBe("Seedance 2.0");
  });

  it("prefers tags, then the relay vendor, then the name", () => {
    expect(classifyModel("x-1", "CH01,系列:Seedance 3.0,厂商：字节")).toEqual({ vendor: "字节", series: "Seedance 3.0" });
    expect(classifyModel("ch0101-sd-2.0-480p", "CH01", "Doubao")).toEqual({ vendor: "Doubao", series: "Seedance 2.0" });
    expect(vendorFromName("veo-3.1")).toBe("Google");
    expect(vendorFromName("minimax-hailuo-02")).toBe("MiniMax");
    expect(vendorFromName("wan2.5-t2v")).toBe("通义万相");
    expect(vendorFromName("mystery")).toBe("其他");
  });

  it("finds the channel", () => {
    expect(channelOf("ch1309-sd-2.0-480p", "CH13")).toBe("CH1309");
    expect(channelOf("doubao-seedance-2-0-260128", "DOLA")).toBe("DOLA");
    expect(channelOf("gpt-image-2", "")).toBe("");
    expect(channelOf("gpt-image-2", "图片")).toBe("");
  });

  it("groups by vendor then series, with 其他 last", () => {
    const models = [
      { id: "a", vendor: "其他", series: "X" },
      { id: "b", vendor: "Google", series: "Veo 3.1" },
      { id: "c", vendor: "Doubao", series: "Seedance 2.5" },
      { id: "d", vendor: "Doubao", series: "Seedance 2.0" },
      { id: "e", vendor: "Doubao", series: "Seedance 2.0" },
    ];
    const groups = groupModels(models);
    expect(groups.map((group) => group.vendor)).toEqual(["Doubao", "Google", "其他"]);
    expect(groups[0].series.map((series) => [series.name, series.models.length])).toEqual([["Seedance 2.0", 2], ["Seedance 2.5", 1]]);
  });

  it("searches across name, series, vendor and channel", () => {
    const model = { id: "ch1309-sd-2.0-720p", vendor: "Doubao", series: "Seedance 2.0", tag: "CH13", description: "可真人" };
    expect(matchesQuery(model, "seedance 720")).toBe(true);
    expect(matchesQuery(model, "ch1309")).toBe(true);
    expect(matchesQuery(model, "可真人")).toBe(true);
    expect(matchesQuery(model, "veo")).toBe(false);
  });
});
