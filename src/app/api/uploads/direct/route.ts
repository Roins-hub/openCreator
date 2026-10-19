import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { mediaPrefix, requireUser } from "@/lib/identity";
import { MEDIA_RULES, uploadKind } from "@/lib/media-files";
import { mediaKey } from "@/lib/media-store";
import { deleteObject, objectSize, signedUploadUrl } from "@/lib/object-store";
import type { MediaRef } from "@/lib/types";

const fileSchema = {
  name: z.string().trim().min(1).max(300),
  type: z.string().trim().max(100),
};
const inputSchema = z.discriminatedUnion("step", [
  // 第一步:拿限时上传地址,浏览器直接 PUT 到对象存储
  z.object({ step: z.literal("sign"), ...fileSchema, size: z.number().int().nonnegative() }),
  // 第二步:上传完成后核对文件确实在、大小没超,才算素材
  z.object({ step: z.literal("complete"), ...fileSchema, path: z.string().max(400) }),
]);

function checkedKind(name: string, type: string, size?: number) {
  const kind = uploadKind({ name, type });
  if (!kind) throw new Error("仅支持 JPG/PNG/WebP 图片、MP4/MOV 视频和 MP3/WAV 音频");
  if (size !== undefined && size > MEDIA_RULES[kind].maxBytes) {
    throw new Error(`单个素材不能超过 ${MEDIA_RULES[kind].maxBytes / 1024 / 1024}MB`);
  }
  return kind;
}

/** 素材直传对象存储;没有配置云存储时返回 { direct: false },浏览器改走 /api/uploads */
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = inputSchema.parse(await request.json());
    if (input.step === "sign") {
      checkedKind(input.name, input.type, input.size);
      const path = mediaKey(userId, "uploads", input.name);
      const url = await signedUploadUrl(path);
      return ok(url ? { direct: true, path, url } : { direct: false });
    }
    if (!input.path.startsWith(`${mediaPrefix(userId)}uploads/`)) throw new Error("非法素材路径");
    const kind = checkedKind(input.name, input.type);
    const size = await objectSize(input.path);
    if (size === undefined) throw new Error("素材没有上传成功，请重试");
    if (size > MEDIA_RULES[kind].maxBytes) {
      await deleteObject(input.path).catch(() => undefined);
      throw new Error(`单个素材不能超过 ${MEDIA_RULES[kind].maxBytes / 1024 / 1024}MB`);
    }
    const ref: MediaRef = { kind, path: input.path, name: input.name, mimeType: input.type };
    return ok(ref);
  } catch (error) { return failure(error); }
}
