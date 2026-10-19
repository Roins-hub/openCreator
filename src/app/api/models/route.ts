import { failure, ok } from "@/lib/http";
import { API_KEY_HEADER } from "@/lib/identity";
import { relayOf } from "@/lib/relay";
import { catalogModels } from "@/lib/tangzhi-server";

/** 中转站的视频模型和生图模型(各自带 type 字段);自定义中转站按 Key 读模型列表 */
export async function GET(request: Request) {
  const apiKey = request.headers.get(API_KEY_HEADER)?.trim() || undefined;
  try { return ok(await catalogModels(relayOf(request), apiKey)); }
  catch (error) { return failure(error, 502); }
}
