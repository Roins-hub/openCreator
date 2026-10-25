import { z } from "zod";
import { recordAsset } from "@/lib/asset-store";
import { failure, ok } from "@/lib/http";
import { mediaPrefix, requireUser } from "@/lib/identity";
import { checkUpload } from "@/lib/media-files";
import { mediaKey } from "@/lib/media-store";
import { deleteObject, objectSize, signedUploadUrl } from "@/lib/object-store";

const fileSchema = {
  name: z.string().trim().min(1).max(300),
  type: z.string().trim().max(100),
  /** chat:聊天附件(图片和文档);不填是生成素材 */
  purpose: z.enum(["media", "chat"]).optional(),
};
const inputSchema = z.discriminatedUnion("step", [
  // 第一步:拿限时上传地址,浏览器直接 PUT 到对象存储
  z.object({ step: z.literal("sign"), ...fileSchema, size: z.number().int().nonnegative() }),
  // 第二步:上传完成后核对文件确实在、大小没超,才算素材
  z.object({ step: z.literal("complete"), ...fileSchema, path: z.string().max(400) }),
]);

/** 素材直传对象存储;没有配置云存储时返回 { direct: false },浏览器改走 /api/uploads */
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = inputSchema.parse(await request.json());
    if (input.step === "sign") {
      checkUpload({ name: input.name, type: input.type, size: input.size }, input.purpose);
      const path = mediaKey(userId, "uploads", input.name);
      const url = await signedUploadUrl(path);
      return ok(url ? { direct: true, path, url } : { direct: false });
    }
    if (!input.path.startsWith(`${mediaPrefix(userId)}uploads/`)) throw new Error("非法素材路径");
    const { kind, maxBytes } = checkUpload({ name: input.name, type: input.type }, input.purpose);
    const size = await objectSize(input.path);
    if (size === undefined) throw new Error("素材没有上传成功，请重试");
    if (size > maxBytes) {
      await deleteObject(input.path).catch(() => undefined);
      throw new Error(`单个文件不能超过 ${maxBytes / 1024 / 1024}MB`);
    }
    // 输入框里上传的素材也记进资产库(「我上传的」),下次按 @ 或在资产库里直接拿;聊天附件由聊天自己登记
    if (input.purpose !== "chat") {
      await recordAsset(userId, {
        kind, path: input.path, name: input.name, mimeType: input.type, size, createdAt: new Date().toISOString(), source: "upload",
      }).catch(() => undefined);
    }
    return ok({ kind, path: input.path, name: input.name, mimeType: input.type, size });
  } catch (error) { return failure(error); }
}
