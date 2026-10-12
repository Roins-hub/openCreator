import { resolve } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./json-store";
import { videoOptionsSchema } from "./schemas";
import { MY_PROMPTS, parsePromptTags, type PromptTemplate } from "./prompt-library";

/** 用户自定义提示词,存在每个用户自己的目录里(root = data/users/<用户ID>)。 */
const promptsFile = (root: string) => resolve(root, "prompts.json");
export const MAX_CUSTOM_PROMPTS = 300;

export const customPromptInputSchema = z.object({
  id: z.string().regex(/^[\w-]{1,80}$/).optional(),
  title: z.string().trim().min(1, "请填写标题").max(40, "标题最多 40 个字"),
  prompt: z.string().trim().min(1, "请填写提示词").max(4000, "提示词最多 4000 个字"),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  ratio: videoOptionsSchema.shape.ratio.optional(),
  duration: z.number().int().min(1).max(60).optional(),
});

export interface CustomPrompt extends PromptTemplate {
  category: typeof MY_PROMPTS.id;
  createdAt: string;
  updatedAt: string;
}

export async function listCustomPrompts(root: string): Promise<CustomPrompt[]> {
  const value = await readJson<unknown>(promptsFile(root), []);
  return Array.isArray(value) ? value as CustomPrompt[] : [];
}

/** 新建或修改(带 id 且存在时修改);最新改动的排在最前 */
export async function saveCustomPrompt(root: string, input: unknown) {
  const data = customPromptInputSchema.parse(input);
  const current = await listCustomPrompts(root);
  const existing = data.id ? current.find((item) => item.id === data.id) : undefined;
  if (!existing && current.length >= MAX_CUSTOM_PROMPTS) throw new Error(`最多保存 ${MAX_CUSTOM_PROMPTS} 条自定义提示词`);
  const now = new Date().toISOString();
  const tags = Array.isArray(data.tags) ? parsePromptTags(data.tags.join(",")) : parsePromptTags(data.tags || "");
  const saved: CustomPrompt = {
    id: existing?.id || `mine-${crypto.randomUUID()}`, category: MY_PROMPTS.id,
    title: data.title, prompt: data.prompt, tags,
    ...(data.ratio ? { ratio: data.ratio } : {}), ...(data.duration ? { duration: data.duration } : {}),
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
  await writeJsonAtomic(promptsFile(root), [saved, ...current.filter((item) => item.id !== saved.id)]);
  return saved;
}

export async function deleteCustomPrompt(root: string, id: string) {
  const current = await listCustomPrompts(root);
  await writeJsonAtomic(promptsFile(root), current.filter((item) => item.id !== id));
}
