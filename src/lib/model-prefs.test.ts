import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyModelPrefsOp, emptyModelPrefs, MAX_RECENTS, RECENT_AFTER_USES, type ModelPrefs } from "./model-prefs";

/** 连续用够次数,加进常用 */
const repeatUse = (prefs: ModelPrefs, id: string, kind: "video" | "image" = "video") => {
  let next = prefs;
  for (let index = 0; index < RECENT_AFTER_USES; index++) next = applyModelPrefsOp(next, { type: "use", id, kind });
  return next;
};

describe("model prefs ops", () => {
  it("records use, stars, removes and merges old local lists", () => {
    let prefs = emptyModelPrefs();
    for (let index = 0; index < MAX_RECENTS + 2; index++) prefs = repeatUse(prefs, `m${index}`);
    // 已在常用里的,用一次就排到最前面
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "m3" });
    expect(prefs.recents[0]).toBe("m3");
    expect(prefs.recents).toHaveLength(MAX_RECENTS);
    prefs = applyModelPrefsOp(prefs, { type: "favorite", id: "star", on: true });
    prefs = applyModelPrefsOp(prefs, { type: "favorite", id: "star", on: true });
    expect(prefs.favorites).toEqual(["star"]);
    prefs = applyModelPrefsOp(prefs, { type: "remove", ids: ["star", "m3"] });
    expect(prefs.favorites).toEqual([]);
    expect(prefs.recents).not.toContain("m3");
    prefs = applyModelPrefsOp(prefs, { type: "merge", favorites: ["old"], recents: ["m9", "older"] });
    expect(prefs.favorites).toEqual(["old"]);
    expect(prefs.recents.filter((id) => id === "m9")).toHaveLength(1);
  });

  it("adds a model to 常用 only after it is used three times in a row", () => {
    let prefs = emptyModelPrefs();
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "sd", kind: "video" });
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "sd", kind: "video" });
    expect(prefs.recents).toEqual([]);
    // 中间用了一次图片模型,不打断视频的连续次数
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "gpt-image", kind: "image" });
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "sd", kind: "video" });
    expect(prefs.recents).toEqual(["sd"]);
    // 换了别的视频模型就重新计数
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "wan", kind: "video" });
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "wan", kind: "video" });
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "omni", kind: "video" });
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "wan", kind: "video" });
    expect(prefs.recents).toEqual(["sd"]);
    // 移出常用后要重新连续用够才回来
    prefs = applyModelPrefsOp(prefs, { type: "remove", ids: ["sd"] });
    prefs = applyModelPrefsOp(prefs, { type: "use", id: "sd", kind: "video" });
    expect(prefs.recents).toEqual([]);
  });
});

describe("model prefs store", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mote-prefs-"));
    process.env.MOTE_STORAGE_ROOT = root;
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it("applies changes from several devices in order without losing any", async () => {
    const { getModelPrefs, updateModelPrefs } = await import("./model-prefs-store");
    const user = "b".repeat(32);
    await Promise.all([
      updateModelPrefs(user, { type: "favorite", id: "a", on: true }),
      updateModelPrefs(user, { type: "favorite", id: "b", on: true }),
      updateModelPrefs(user, { type: "use", id: "c" }),
      updateModelPrefs(user, { type: "use", id: "c" }),
      updateModelPrefs(user, { type: "use", id: "c" }),
    ]);
    expect(await getModelPrefs(user)).toEqual({ favorites: ["a", "b"], recents: ["c"], streaks: { video: { id: "c", count: 3 } } });
    await expect(updateModelPrefs(user, { type: "use", id: "" })).rejects.toThrow();
  });
});
