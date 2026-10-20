import { z } from "zod";
import {
  listAssets, permanentlyDeleteAssets, recordAsset, setAssetsTrashed, type Asset, type AssetRecord,
} from "@/lib/asset-store";
import { listConversations } from "@/lib/conversation-store";
import { listFavorites, removeFavorites } from "@/lib/favorite-store";
import { failure, ok } from "@/lib/http";
import { mediaPrefix, requireUser, userDir } from "@/lib/identity";
import { MEDIA_RULES, uploadKind } from "@/lib/media-files";
import { deleteObject, objectSize } from "@/lib/object-store";

/** 一次批量操作最多处理的资产数 */
const MAX_BATCH = 500;
const pathsSchema = z.array(z.string().min(1).max(400)).min(1).max(MAX_BATCH);

/** 单个 path 或批量 paths 都接受,去重 */
function pathsOf(input: { path?: unknown; paths?: unknown }) {
  const paths = input.paths !== undefined ? pathsSchema.parse(input.paths) : input.path ? pathsSchema.parse([input.path]) : [];
  if (!paths.length) throw new Error("缺少资产路径");
  return [...new Set(paths)];
}

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

const uploadSchema = z.object({
  path: z.string().max(400),
  name: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(100),
});

/** 把在资产页上传好的素材(已经在 uploads/ 里)登记为资产,之后在输入框里用 @ 也能选到 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = uploadSchema.parse(await request.json());
    if (!input.path.startsWith(`${mediaPrefix(userId)}uploads/`)) throw new Error("非法素材路径");
    const kind = uploadKind({ name: input.name, type: input.mimeType });
    if (!kind) throw new Error("仅支持 JPG/PNG/WebP 图片、MP4/MOV 视频和 MP3/WAV 音频");
    const size = await objectSize(input.path);
    if (size === undefined) throw new Error("素材没有上传成功，请重试");
    if (size > MEDIA_RULES[kind].maxBytes) {
      await deleteObject(input.path).catch(() => undefined);
      throw new Error(`单个素材不能超过 ${MEDIA_RULES[kind].maxBytes / 1024 / 1024}MB`);
    }
    const record: AssetRecord = {
      kind, path: input.path, name: input.name, mimeType: input.mimeType || MEDIA_RULES[kind].types[0], size,
      createdAt: new Date().toISOString(), source: "upload",
    };
    await recordAsset(userId, record);
    const asset: Asset = { ...record, id: record.path, favorite: false };
    return ok(asset);
  } catch (error) {
    return failure(error, 400);
  }
}

/** 移入 / 移出回收站,支持批量:{ action, paths } 或 { action, path } */
export async function PATCH(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = await request.json() as { action?: string; path?: unknown; paths?: unknown };
    const paths = pathsOf(input);
    if (input.action === "trash" || input.action === "restore") {
      const changed = await setAssetsTrashed(userId, paths, input.action === "trash");
      return ok({ path: paths[0], paths: changed });
    }
    throw new Error("不支持的资产操作");
  } catch (error) {
    return failure(error, 400);
  }
}

/** 永久删除,支持批量:?path=xxx 或请求体 { paths } */
export async function DELETE(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const single = new URL(request.url).searchParams.get("path");
    const body = single ? {} : await request.json().catch(() => ({})) as { paths?: unknown };
    const paths = pathsOf(single ? { path: single } : body);
    const { deleted, failed } = await permanentlyDeleteAssets(userId, paths);
    if (deleted.length) await removeFavorites(deleted, userDir(userId)).catch(() => undefined);
    if (!deleted.length && failed.length) throw new Error(failed[0].error);
    return ok({ deleted: deleted.length > 0, paths: deleted, failed });
  } catch (error) {
    return failure(error, 400);
  }
}
