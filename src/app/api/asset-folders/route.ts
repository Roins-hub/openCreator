import { z } from "zod";
import {
  createAssetFolder, deleteAssetFolder, listAssetFolders, renameAssetFolder, reorderAssetFolders,
} from "@/lib/asset-store";
import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";

/** 素材分组:在 @ 选择素材时整理用(新建、改名、删除;删分组不删里面的素材) */
export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    // ?scope=chat:聊天附件页的文件夹
    const scope = new URL(request.url).searchParams.get("scope") === "chat" ? "chat" : undefined;
    return ok(await listAssetFolders(userId, scope));
  } catch (error) {
    return failure(error, 401);
  }
}

const nameSchema = z.string().trim().min(1, "分组名称不能为空").max(40);
const createSchema = z.object({
  name: nameSchema,
  /** 拖到「新建分组」上时,新分组建好后把这些素材移进去 */
  paths: z.array(z.string().min(1).max(400)).max(500).optional(),
  scope: z.literal("chat").optional(),
});

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = createSchema.parse(await request.json());
    return ok(await createAssetFolder(userId, input.name, input.paths, input.scope));
  } catch (error) {
    return failure(error, 400);
  }
}

const renameSchema = z.object({ id: z.string().min(1).max(100), name: nameSchema });
const orderSchema = z.object({ order: z.array(z.string().min(1).max(100)).max(500) });

/** 改名 { id, name };调整顺序 { order: [文件夹 ID…] } */
export async function PATCH(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json() as unknown;
    const ordering = orderSchema.safeParse(body);
    if (ordering.success) return ok({ order: await reorderAssetFolders(userId, ordering.data.order) });
    const input = renameSchema.parse(body);
    return ok({ id: input.id, name: await renameAssetFolder(userId, input.id, input.name) });
  } catch (error) {
    return failure(error, 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const id = z.string().min(1).max(100).parse(new URL(request.url).searchParams.get("id"));
    await deleteAssetFolder(userId, id);
    return ok({ id });
  } catch (error) {
    return failure(error, 400);
  }
}
