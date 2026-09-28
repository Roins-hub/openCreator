import { deleteConversation, getConversation, saveConversation } from "@/lib/conversation-store";
import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { userId } = await requireUser(request);
    const item = await getConversation(userId, (await context.params).id);
    return item ? ok(item) : failure(new Error("会话不存在"), 404);
  } catch (error) { return failure(error, 401); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { userId } = await requireUser(request);
    const id = (await context.params).id;
    const body = await request.json();
    if (body.id !== id) throw new Error("会话 ID 不匹配");
    return ok(await saveConversation(userId, body));
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { userId } = await requireUser(request);
    await deleteConversation(userId, (await context.params).id);
    return ok({ deleted: true });
  } catch (error) { return failure(error); }
}
