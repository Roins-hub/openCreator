import { failure, ok } from "@/lib/http";
import { requireUser, userDir } from "@/lib/identity";
import { getPromptLayout, recordPromptUse, savePromptLayout } from "@/lib/prompt-layout-store";

/** 提示词库的个人布局:GET 读取,PUT 整体保存,POST { use: 提示词ID } 记一次使用 */
export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await getPromptLayout(userDir(userId)));
  } catch (error) { return failure(error, 401); }
}

export async function PUT(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await savePromptLayout(userDir(userId), await request.json()));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json() as { use?: unknown };
    return ok(await recordPromptUse(userDir(userId), String(body.use || "")));
  } catch (error) { return failure(error); }
}
