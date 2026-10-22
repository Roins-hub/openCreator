import { failure, ok } from "@/lib/http";
import { API_KEY_HEADER, imageKeyOf, isImageOnly } from "@/lib/identity";
import { relayOf } from "@/lib/relay";
import { catalogModels } from "@/lib/tangzhi-server";

/** 中转站的视频模型和生图模型(各自带 type 字段);自定义中转站按 Key 读模型列表(视频、图片各用各的 Key) */
export async function GET(request: Request) {
  const apiKey = request.headers.get(API_KEY_HEADER)?.trim() || undefined;
  try {
    const models = await catalogModels(relayOf(request), apiKey, imageKeyOf(request, apiKey));
    // 只填了图片 Key:不列视频模型
    return ok(isImageOnly(request) ? models.filter((model) => model.type === "image") : models);
  }
  catch (error) { return failure(error, 502); }
}
