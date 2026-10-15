import {
  clearChatItems, getChatItem, importChatItems, listChatItems, removeChatItem, setChatItem,
} from "@/lib/chat-store";
import { ZodError } from "zod";
import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";

/**
 * 「对话」页面(/chat)的聊天记录存取:
 * GET ?key= 读一条,GET ?all=1 导出全部;PUT {key,value} 写一条;
 * POST {entries} 导入备份(替换全部);DELETE ?key= 删一条,DELETE ?all=1 清空。
 */
export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const params = new URL(request.url).searchParams;
    if (params.get("all")) return ok({ entries: await listChatItems(userId) });
    return ok({ value: await getChatItem(userId, params.get("key") || "") });
  } catch (error) { return failure(error, error instanceof ZodError ? 400 : 401); }
}

export async function PUT(request: Request) {
  try {
    const { userId } = await requireUser(request);
    await setChatItem(userId, await request.json());
    return ok({ saved: true });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json() as { entries?: unknown };
    return ok({ imported: await importChatItems(userId, body.entries) });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const params = new URL(request.url).searchParams;
    if (params.get("all")) await clearChatItems(userId);
    else await removeChatItem(userId, params.get("key") || "");
    return ok({ deleted: true });
  } catch (error) { return failure(error); }
}
