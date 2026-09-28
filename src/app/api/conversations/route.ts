import { listConversations, saveConversation } from "@/lib/conversation-store";
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
