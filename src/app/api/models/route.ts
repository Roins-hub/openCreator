import { failure, ok } from "@/lib/http";
import { videoModels } from "@/lib/tangzhi-server";

export async function GET() {
  try { return ok(await videoModels()); }
  catch (error) { return failure(error, 502); }
}
