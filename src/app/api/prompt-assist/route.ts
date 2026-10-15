import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { assistPrompt } from "@/lib/tangzhi-server";

const inputSchema = z.object({
  prompt: z.string().trim().min(1, "请先写一点想法").max(6000, "提示词太长了"),
  kind: z.enum(["video", "image"]),
});

/** 输入框的「优化提示词」:返回扩写后的提示词,由用户决定是否使用 */
export async function POST(request: Request) {
  try {
    const { apiKey, relay } = await requireUser(request);
    const input = inputSchema.parse(await request.json());
    return ok(await assistPrompt(apiKey, input.prompt, input.kind, relay));
  } catch (error) { return failure(error); }
}
