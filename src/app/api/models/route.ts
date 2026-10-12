import { failure, ok } from "@/lib/http";
import { relayOf } from "@/lib/relay";
import { videoModels } from "@/lib/tangzhi-server";

export async function GET(request: Request) {
  try { return ok(await videoModels(relayOf(request))); }
  catch (error) { return failure(error, 502); }
}
