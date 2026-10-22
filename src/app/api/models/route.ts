import { failure, ok } from "@/lib/http";
import { API_KEY_HEADER, imageKeysOf, isImageOnly, videoKeysOf } from "@/lib/identity";
import { relayOf } from "@/lib/relay";
import { catalogModels } from "@/lib/tangzhi-server";

/** 中转站的视频模型和生图模型(各自带 type 字段);自定义中转站按 Key 读模型列表(视频、图片各用各的 Key) */
export async function GET(request: Request) {
  const apiKey = request.headers.get(API_KEY_HEADER)?.trim() || undefined;
  try {
    // 视频、图片各自可以有多个 Key,自定义中转站把它们的模型合起来
    const models = await catalogModels(relayOf(request), videoKeysOf(request, apiKey), imageKeysOf(request, apiKey));
    // 只填了图片 Key:不列视频模型
    return ok(isImageOnly(request) ? models.filter((model) => model.type === "image") : models);
  }
  catch (error) { return failure(error, 502); }
}
