import { inside } from "./paths";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";
import { applyModelPrefsOp, modelPrefsOpSchema, parseModelPrefs, type ModelPrefs } from "./model-prefs";

/** 模型「常用」,每个用户一份:data/users/<用户ID>/model-prefs.json(见 model-prefs.ts) */
const prefsFile = (userId: string) => inside(userDir(userId), "model-prefs.json");

export async function getModelPrefs(userId: string): Promise<ModelPrefs> {
  return parseModelPrefs(await readJson<unknown>(prefsFile(userId), null));
}

// 同一用户的改动按顺序套用:几台设备同时操作也不会丢
const queues = new Map<string, Promise<unknown>>();
function serial<T>(userId: string, task: () => Promise<T>) {
  const result = (queues.get(userId) || Promise.resolve()).then(task, task);
  const tail = result.catch(() => undefined);
  queues.set(userId, tail);
  void tail.then(() => { if (queues.get(userId) === tail) queues.delete(userId); });
  return result;
}

export async function updateModelPrefs(userId: string, value: unknown) {
  const op = modelPrefsOpSchema.parse(value);
  return serial(userId, async () => {
    const next = applyModelPrefsOp(await getModelPrefs(userId), op);
    await writeJsonAtomic(prefsFile(userId), next);
    return next;
  });
}
