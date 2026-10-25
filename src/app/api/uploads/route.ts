import { recordAsset } from "@/lib/asset-store";
import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { checkUpload } from "@/lib/media-files";
import { saveUpload } from "@/lib/media-store";

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const form = await request.formData();
    const files = form.getAll("files");
    // chat:聊天附件(图片和文档);不填是生成素材
    const purpose = form.get("purpose") === "chat" ? "chat" : "media";
    if (!files.length || files.some((file) => !(file instanceof File))) throw new Error("请选择素材");
    const kinds = (files as File[]).map((item) => checkUpload(item, purpose).kind);
    const saved = await Promise.all((files as File[]).map((file, index) => saveUpload(userId, file, kinds[index])));
    // 输入框里上传的素材也记进资产库(「我上传的」);聊天附件由聊天自己登记
    if (purpose !== "chat") {
      await Promise.all(saved.map((media, index) => recordAsset(userId, {
        kind: kinds[index], path: media.path, name: media.name, mimeType: media.mimeType || (files[index] as File).type,
        size: (files[index] as File).size, createdAt: new Date().toISOString(), source: "upload",
      }).catch(() => undefined)));
    }
    return ok(saved);
  } catch (error) { return failure(error); }
}
