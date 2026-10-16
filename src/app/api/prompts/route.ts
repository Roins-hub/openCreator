import { deleteCustomPrompt, listCustomPrompts, saveCustomPrompt } from "@/lib/custom-prompt-store";
import { failure, ok } from "@/lib/http";
import { requireUser, userDir } from "@/lib/identity";

/** 当前用户的自定义提示词:GET 列表,POST 新建/修改,DELETE ?id=&id= 删除(可多条) */
export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await listCustomPrompts(userDir(userId)));
  } catch (error) { return failure(error, 401); }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await saveCustomPrompt(userDir(userId), await request.json()));
  } catch (error) { return failure(error, 400); }
}

export async function DELETE(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const ids = new URL(request.url).searchParams.getAll("id").filter(Boolean);
    if (!ids.length) throw new Error("缺少提示词 ID");
    await deleteCustomPrompt(userDir(userId), ids);
    return ok({ deleted: true });
  } catch (error) { return failure(error, 400); }
}
