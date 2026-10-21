/**
 * 提示词优化:用中转站的对话模型把用户写的几句话扩写成完整的视频 / 生图提示词。
 * 默认挑一个便宜、快的对话模型(名字带 luna / mini / flash 等),可用 MOTE_ASSIST_MODEL 指定。
 */
import { IMAGE_MODEL_NAME, isChatImageModel, isChatImageName } from "./image-models";

interface PricingEntry {
  model_name?: string;
  supported_endpoint_types?: string[];
  enable_groups?: string[];
  billing_expr?: string;
}

const NON_CHAT = new Set([
  "openai-video", "video-generation", "image-generation", "image-edit", "openai-image",
  "openai-transcription", "openai-speech", "openai-music", "embeddings", "jina-rerank",
]);
const CHAT_TYPES = new Set(["openai", "anthropic", "gemini", "openai-response"]);
// 只有名字时:视频、生图、语音、向量这些都不是对话模型
const NOT_CHAT_NAME = /veo|sora|kling|hailuo|seedance|video|vidu|runway|pika|embed|whisper|tts|speech|audio|rerank|moderation|music|suno/i;

/**
 * Key 的 /v1/models 里一项是不是对话模型:new-api 会给端点类型,按类型认;
 * 没有类型(非 new-api 的中转站)时按名字排除视频、生图、语音等。
 */
export function isChatModelEntry(id: string, types: readonly string[]) {
  // 生图模型有的也只标 openai(gpt-image、nano-banana…),名字上再排除一次
  if (IMAGE_MODEL_NAME.test(id) || isChatImageName(id)) return false;
  if (types.length) return types.some((type) => CHAT_TYPES.has(type)) && !types.some((type) => NON_CHAT.has(type));
  return !NOT_CHAT_NAME.test(id);
}

/** /api/pricing 里能走 Chat Completions 的纯文本模型;group 为 null 时不看分组(具体能用哪些由 Key 决定) */
export function toTextModels(payload: unknown, group: string | null = "default"): string[] {
  const data = (payload as { data?: PricingEntry[] }) || {};
  return (data.data || [])
    .filter((entry) => entry.model_name && entry.supported_endpoint_types?.includes("openai") &&
      !entry.supported_endpoint_types.some((type) => NON_CHAT.has(type)) && !isChatImageModel(entry) &&
      (!group || !entry.enable_groups || entry.enable_groups.includes(group)))
    .map((entry) => entry.model_name as string)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

const PREFERRED = [/luna/i, /mini/i, /flash/i, /haiku/i, /terra/i, /lite/i, /sol/i];
// 最贵的旗舰模型只在别的都不行时才用
const COSTLY = /astra|opus|-pro\b|-max\b/i;

/** 依次尝试的模型:指定的 → 轻量的(luna / mini / flash…)→ 其余 */
export function assistCandidates(models: string[], configured = process.env.MOTE_ASSIST_MODEL?.trim()) {
  const ordered = [
    ...(configured && models.includes(configured) ? [configured] : []),
    ...PREFERRED.flatMap((pattern) => models.filter((id) => pattern.test(id))),
    ...models.filter((id) => !COSTLY.test(id)),
    ...models,
  ];
  return [...new Set(ordered)];
}

export function pickAssistModel(models: string[], configured = process.env.MOTE_ASSIST_MODEL?.trim()) {
  return assistCandidates(models, configured)[0];
}

export type AssistKind = "video" | "image";

const RULES = [
  "只输出改写后的提示词本身，不要标题、解释、引号、Markdown 或多个版本。",
  "保持用户使用的语言（中文就写中文），保留用户指定的主体、人物、文字、数量、风格和其他约束，不要改变原意。",
  "提示词里形如 [图1]、[视频2]、[音频1] 的标记代表用户上传的参考素材，必须原样保留在合适的位置，不能删除、翻译或改编号。",
  "不要编造与用户意图冲突的内容；信息不足的地方用合理、具体的画面细节补足。",
];

export function assistSystemPrompt(kind: AssistKind) {
  const focus = kind === "video"
    ? "你是视频生成提示词专家。把用户的描述扩写成一段可以直接交给 AI 视频模型的提示词：写清主体与外观、场景、动作随时间的变化、镜头运动（推、拉、摇、移、跟、环绕等）、景别与构图、光线、色调、氛围和节奏。控制在 300 字以内，一段话写完。"
    : "你是 AI 绘画提示词专家。把用户的描述扩写成一段可以直接交给 AI 生图模型的提示词：写清主体与外观、构图与视角、场景与背景、光线、色彩、材质质感、风格与画面完成度；需要出现在画面里的文字用引号标出。控制在 250 字以内，一段话写完。";
  return [focus, ...RULES].join("\n");
}

/** 清理模型偶尔多带的外层引号、代码块或「提示词：」前缀 */
export function cleanAssistOutput(text: string) {
  return text.trim()
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/^(优化后的)?提示词[:：]\s*/, "")
    .replace(/^["“「]([\s\S]*)["”」]$/, "$1")
    .trim();
}
