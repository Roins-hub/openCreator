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
    return ok(await Promise.all((files as File[]).map((file, index) => saveUpload(userId, file, kinds[index]))));
  } catch (error) { return failure(error); }
}
