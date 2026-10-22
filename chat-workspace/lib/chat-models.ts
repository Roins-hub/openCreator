/** 中转站 /v1/models 里的一项;new-api 会附带模型支持的接口类型。 */
export type RelayModel = { id?: unknown; supported_endpoint_types?: unknown };

// 只能生成视频/图片的接口类型:带这些类型的模型不进聊天的模型列表
const NON_CHAT_ENDPOINTS = new Set(["openai-video", "image-generation"]);
// 能用来对话的接口类型
const CHAT_ENDPOINTS = new Set([
  "openai",
  "openai-response",
  "openai-response-compact",
  "anthropic",
  "gemini",
]);
// 中转站没给接口类型时按名字兜底识别视频/图片模型
const NON_CHAT_NAME =
  /seedance|seedream|(^|[-_])sd-\d|sora|veo|kling|hailuo|vidu|wan\d|video|gpt-image|dall-e|flux|midjourney|imagen|nano-banana/i;

/** 是否是文本(对话)模型:视频、图片生成模型不显示在聊天里。 */
export function isChatModel(item: RelayModel) {
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) return false;
  if (Array.isArray(item.supported_endpoint_types)) {
    const types = item.supported_endpoint_types.filter(
      (type): type is string => typeof type === "string",
    );
    if (types.length) {
      if (types.some((type) => NON_CHAT_ENDPOINTS.has(type))) return false;
      return types.some((type) => CHAT_ENDPOINTS.has(type));
    }
  }
  return !NON_CHAT_NAME.test(id);
}

/** 模型名拆成「系列 / 版本号 / 型号」:gpt-6.1-sol → gpt / [6, 1] / sol,claude-opus-4-7 → claude-opus / [4, 7] / "" */
function parseModelName(id: string) {
  const tokens = id.toLowerCase().split(/[-_\s]+/).filter(Boolean);
  const family: string[] = [];
  let index = 0;
  while (index < tokens.length && !/^v?\d/.test(tokens[index])) family.push(tokens[index++]);
  const version: number[] = [];
  while (index < tokens.length && /^v?\d+(?:\.\d+)*$/.test(tokens[index])) {
    version.push(...tokens[index++].replace(/^v/, "").split(".").map(Number));
  }
  return { family: family.join("-"), version, variant: tokens.slice(index).join("-") };
}

/** 新的在前:同一系列按版本号从高到低(6.1 > 6 > 5.6),同版本按型号名;不同系列按名称分开排 */
export function compareModelsNewestFirst(a: string, b: string) {
  const x = parseModelName(a);
  const y = parseModelName(b);
  if (x.family !== y.family) return x.family.localeCompare(y.family);
  // 没有版本号的排在这个系列最后
  if (!x.version.length !== !y.version.length) return x.version.length ? -1 : 1;
  for (let index = 0; index < Math.max(x.version.length, y.version.length); index++) {
    const diff = (y.version[index] ?? 0) - (x.version[index] ?? 0);
    if (diff) return diff;
  }
  return x.variant.localeCompare(y.variant) || a.localeCompare(b);
}

/** 从 /v1/models 的返回里取出去重的文本模型 ID,新的模型排在上面。 */
export function chatModelIds(data: readonly RelayModel[]) {
  return Array.from(
    new Set(data.filter(isChatModel).map((item) => (item.id as string).trim())),
  ).sort(compareModelsNewestFirst);
}
