import { listGroups, saveGroups } from "@/lib/group-store";
import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";

export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await listGroups(userId));
  } catch (error) { return failure(error, 401); }
}

export async function PUT(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await saveGroups(userId, await request.json()));
  } catch (error) { return failure(error); }
}
