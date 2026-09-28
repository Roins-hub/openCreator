import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { MEDIA_RULES, uploadKind } from "@/lib/media-files";
import { saveUpload } from "@/lib/media-store";

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const form = await request.formData();
    const files = form.getAll("files");
    if (!files.length || files.some((file) => !(file instanceof File))) throw new Error("请选择素材");
    for (const item of files as File[]) {
      const kind = uploadKind(item);
      if (!kind) throw new Error("仅支持 JPG/PNG/WebP 图片、MP4/MOV 视频和 MP3/WAV 音频");
      if (item.size > MEDIA_RULES[kind].maxBytes) {
        throw new Error(`单个素材不能超过 ${MEDIA_RULES[kind].maxBytes / 1024 / 1024}MB`);
      }
    }
    return ok(await Promise.all((files as File[]).map((file) => saveUpload(userId, file))));
  } catch (error) { return failure(error); }
}
