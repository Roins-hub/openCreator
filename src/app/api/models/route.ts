import { failure, ok } from "@/lib/http";
import { relayOf } from "@/lib/relay";
import { catalogModels } from "@/lib/tangzhi-server";

/** 中转站的视频模型和生图模型(各自带 type 字段) */
export async function GET(request: Request) {
  try { return ok(await catalogModels(relayOf(request))); }
  catch (error) { return failure(error, 502); }
}
