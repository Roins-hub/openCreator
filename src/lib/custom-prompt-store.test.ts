import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteCustomPrompt, listCustomPrompts, saveCustomPrompt } from "./custom-prompt-store";
import { parsePromptTags, searchPrompts } from "./prompt-library";

let root: string;
beforeAll(async () => { root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-prompts-")); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("custom prompt store", () => {
  it("creates, updates and deletes a user's own prompts", async () => {
    const first = await saveCustomPrompt(root, { title: " 白底旋转 ", prompt: "产品在白底上 360° 旋转", tags: "电商，旋转 旋转", ratio: "1:1", duration: 5 });
    expect(first).toMatchObject({ category: "mine", title: "白底旋转", tags: ["电商", "旋转"], ratio: "1:1", duration: 5 });
    const second = await saveCustomPrompt(root, { title: "雨夜", prompt: "雨夜街头" });
    expect((await listCustomPrompts(root)).map((item) => item.id)).toEqual([second.id, first.id]);

    const edited = await saveCustomPrompt(root, { id: first.id, title: "白底旋转展示", prompt: "改过的", tags: [] });
    expect(edited.id).toBe(first.id);
    expect(edited.createdAt).toBe(first.createdAt);
    expect(edited.ratio).toBeUndefined();
    expect((await listCustomPrompts(root))[0].title).toBe("白底旋转展示");

    const mine = await listCustomPrompts(root);
    expect(searchPrompts("雨夜", "mine", mine).map((item) => item.id)).toEqual([second.id]);

    await deleteCustomPrompt(root, second.id);
    expect((await listCustomPrompts(root)).map((item) => item.id)).toEqual([first.id]);
  });

  it("rejects empty titles and prompts", async () => {
    await expect(saveCustomPrompt(root, { title: " ", prompt: "x" })).rejects.toThrow();
    await expect(saveCustomPrompt(root, { title: "x", prompt: "" })).rejects.toThrow();
  });

  it("splits tags on Chinese and English separators", () => {
    expect(parsePromptTags("电商, 旋转、白底  特写，a,b,c,d")).toEqual(["电商", "旋转", "白底", "特写", "a", "b"]);
  });
});
