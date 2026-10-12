import { listAssets, permanentlyDeleteAsset, setAssetTrashed } from "@/lib/asset-store";
import { listConversations } from "@/lib/conversation-store";
import { listFavorites, setFavorite } from "@/lib/favorite-store";
import { failure, ok } from "@/lib/http";
import { mediaPrefixes, requireUser, userDir } from "@/lib/identity";

export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const [conversations, favorites] = await Promise.all([
      listConversations(userId), listFavorites(userDir(userId)),
    ]);
    return ok(await listAssets(userId, conversations, favorites));
  } catch (error) {
    return failure(error, 401);
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = await request.json() as { action?: string; path?: string };
    if (!input.path) throw new Error("缺少资产路径");
    if (input.action === "trash" || input.action === "restore") {
      return ok({ path: await setAssetTrashed(userId, input.path, input.action === "trash") });
    }
    throw new Error("不支持的资产操作");
  } catch (error) {
    return failure(error, 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const path = new URL(request.url).searchParams.get("path");
    if (!path) throw new Error("缺少资产路径");
    await permanentlyDeleteAsset(userId, path);
    await setFavorite(path, false, userDir(userId), await mediaPrefixes(userId)).catch(() => undefined);
    return ok({ deleted: true });
  } catch (error) {
    return failure(error, 400);
  }
}
