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

/** 从 /v1/models 的返回里取出去重、排好序的文本模型 ID。 */
export function chatModelIds(data: readonly RelayModel[]) {
  return Array.from(
    new Set(data.filter(isChatModel).map((item) => (item.id as string).trim())),
  ).sort((a, b) => a.localeCompare(b));
}
