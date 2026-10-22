import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyModelPrefsOp, emptyModelPrefs, MAX_RECENTS } from "./model-prefs";

describe("model prefs ops", () => {
  it("records use, stars, removes and merges old local lists", () => {
    let prefs = emptyModelPrefs();
    for (let index = 0; index < MAX_RECENTS + 2; index++) prefs = applyModelPrefsOp(prefs, { type: "use", id: `m${index}` });
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
    ]);
    expect(await getModelPrefs(user)).toEqual({ favorites: ["a", "b"], recents: ["c"] });
    await expect(updateModelPrefs(user, { type: "use", id: "" })).rejects.toThrow();
  });
});
