import { listFavorites, setFavorite } from "@/lib/favorite-store";
import { failure, ok } from "@/lib/http";
import { mediaPrefix, requireUser, userDir } from "@/lib/identity";

export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await listFavorites(userDir(userId)));
  } catch (error) { return failure(error, 401); }
}

export async function PUT(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = await request.json() as { paths?: unknown; favorite?: unknown };
    const paths = Array.isArray(input.paths) ? input.paths.filter((item): item is string => typeof item === "string") : [];
    if (!paths.length) throw new Error("缺少资产路径");
    let favorites: string[] = [];
    for (const path of paths) {
      favorites = await setFavorite(path, Boolean(input.favorite), userDir(userId), mediaPrefix(userId));
    }
    return ok(favorites);
  } catch (error) { return failure(error, 400); }
}
