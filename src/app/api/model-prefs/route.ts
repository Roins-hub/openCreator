import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { getModelPrefs, updateModelPrefs } from "@/lib/model-prefs-store";

/** 模型选择里的「常用」(按中转站账号保存) */
export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await getModelPrefs(userId));
  } catch (error) { return failure(error, 401); }
}

/** 套用一次改动(用了 / 加星 / 移出 / 合并本地旧数据),返回改完的完整记录 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok(await updateModelPrefs(userId, await request.json()));
  } catch (error) { return failure(error); }
}
