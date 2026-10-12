import { deleteConversation, listConversations, saveConversation, updateConversation } from "@/lib/conversation-store";
import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";

export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await listConversations(userId));
  } catch (error) { return failure(error, 401); }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await saveConversation(userId, await request.json()), { status: 201 });
  } catch (error) { return failure(error); }
}

const idsOf = (value: unknown) => {
  const ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  if (!ids.length) throw new Error("请先选择对话");
  if (ids.length > 500) throw new Error("一次最多处理 500 个对话");
  return [...new Set(ids)];
};

/** 批量移动到分组:{ ids, groupId }(groupId 为空表示移出分组) */
export async function PATCH(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = await request.json() as { ids?: unknown; groupId?: unknown };
    const groupId = typeof input.groupId === "string" && input.groupId ? input.groupId : undefined;
    if (groupId && !/^[\w-]{1,80}$/.test(groupId)) throw new Error("分组 ID 不正确");
    const moved = [];
    for (const id of idsOf(input.ids)) {
      moved.push(await updateConversation(userId, id, (conversation) => {
        if (groupId) conversation.groupId = groupId;
        else delete conversation.groupId;
      }).catch(() => null));
    }
    return ok(moved.filter(Boolean));
  } catch (error) { return failure(error); }
}

/** 批量删除:{ ids } */
export async function DELETE(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const ids = idsOf((await request.json() as { ids?: unknown }).ids);
    for (const id of ids) await deleteConversation(userId, id);
    return ok({ deleted: ids.length });
  } catch (error) { return failure(error); }
}
