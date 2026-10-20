/**
 * 预设提示词:发送时自动在输入内容前后补上固定的前缀、后缀(比如画质要求、统一风格)。
 * 只存在当前浏览器里。
 */
export interface PromptPreset {
  enabled: boolean;
  prefix: string;
  suffix: string;
}

export const PROMPT_PRESET_KEY = "mote.promptPreset";
export const EMPTY_PRESET: PromptPreset = { enabled: true, prefix: "", suffix: "" };
const MAX_LENGTH = 2000;

/** 结尾 / 开头已经有标点或空白时直接拼,否则用中文逗号隔开 */
const ENDS_WITH_BREAK = /[\s，。,.;；:：!！?？、)）\]】]$/;
const STARTS_WITH_BREAK = /^[\s，。,.;；:：!！?？、]/;

function join(left: string, right: string) {
  if (!left) return right;
  if (!right) return left;
  return ENDS_WITH_BREAK.test(left) || STARTS_WITH_BREAK.test(right) ? `${left}${right}` : `${left}，${right}`;
}

export function presetActive(preset: PromptPreset) {
  return preset.enabled && Boolean(preset.prefix.trim() || preset.suffix.trim());
}

/**
 * 给提示词补上前缀和后缀。已经带着的不再重复加(重新编辑一条带预设的记录再发送时)。
 */
export function applyPromptPreset(prompt: string, preset: PromptPreset) {
  if (!presetActive(preset)) return prompt;
  const prefix = preset.prefix.trim();
  const suffix = preset.suffix.trim();
  let body = prompt.trim();
  const hasPrefix = Boolean(prefix) && body.startsWith(prefix);
  const hasSuffix = Boolean(suffix) && body.endsWith(suffix);
  if (!hasPrefix) body = join(prefix, body);
  if (!hasSuffix) body = join(body, suffix);
  return body;
}

export function parsePromptPreset(value: unknown): PromptPreset {
  const input = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof PromptPreset, unknown>>;
  const text = (item: unknown) => typeof item === "string" ? item.slice(0, MAX_LENGTH) : "";
  return { enabled: input.enabled !== false, prefix: text(input.prefix), suffix: text(input.suffix) };
}
