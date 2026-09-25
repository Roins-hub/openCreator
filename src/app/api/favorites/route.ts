import { listFavorites, setFavorite } from "@/lib/favorite-store";
import { failure, ok } from "@/lib/http";

export async function GET() {
  try {
    return ok(await listFavorites());
  } catch (error) { return failure(error, 500); }
}

export async function PUT(request: Request) {
  try {
    const input = await request.json() as { paths?: unknown; favorite?: unknown };
    const paths = Array.isArray(input.paths) ? input.paths.filter((item): item is string => typeof item === "string") : [];
    if (!paths.length) throw new Error("缺少资产路径");
    let favorites: string[] = [];
    for (const path of paths) favorites = await setFavorite(path, Boolean(input.favorite));
    return ok(favorites);
  } catch (error) { return failure(error, 400); }
}
