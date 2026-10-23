import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { API_KEY_HEADER, assistKeysOf, requireUser } from "@/lib/identity";
import { relayOf } from "@/lib/relay";
import { assistModelOptions, assistPrompt } from "@/lib/tangzhi-server";

const inputSchema = z.object({
  prompt: z.string().trim().min(1, "请先写一点想法").max(6000, "提示词太长了"),
  kind: z.enum(["video", "image"]),
  /** 设置里指定的优化模型;不传 = 自动 */
  model: z.string().trim().max(200).optional(),
});

/** 设置页用:提示词优化 Key 能用的对话模型,以及「自动」现在会先用哪个 */
export async function GET(request: Request) {
  const apiKey = request.headers.get(API_KEY_HEADER)?.trim() || undefined;
  try { return ok(await assistModelOptions(relayOf(request), assistKeysOf(request, apiKey))); }
  catch (error) { return failure(error, 502); }
}

/** 输入框的「优化提示词」:返回扩写后的提示词,由用户决定是否使用 */
export async function POST(request: Request) {
  try {
    const { apiKey, relay } = await requireUser(request);
    const input = inputSchema.parse(await request.json());
    // 提示词优化可以有几个 Key(自定义中转站),模型取合集
    return ok(await assistPrompt(assistKeysOf(request, apiKey), input.prompt, input.kind, relay, input.model || undefined));
  } catch (error) { return failure(error); }
}
