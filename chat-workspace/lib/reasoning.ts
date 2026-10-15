export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: "最低",
  low: "较低",
  medium: "中等",
  high: "高级",
  xhigh: "极高",
  max: "最大",
};

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);

const THROUGH_HIGH = REASONING_EFFORTS.slice(0, 4);
const THROUGH_XHIGH = REASONING_EFFORTS.slice(0, 5);
const LOW_TO_HIGH = ["low", "medium", "high"] as const;
const LOW_TO_XHIGH = ["low", "medium", "high", "xhigh"] as const;
const LOW_TO_MAX = ["low", "medium", "high", "xhigh", "max"] as const;

export const reasoningEffortsForModel = (model: string): readonly ReasoningEffort[] => {
  // Relays may namespace model IDs (e.g. openai/gpt-6-astra).
  const normalized = model.trim().toLowerCase().split("/").at(-1) ?? "";

  if (/^gpt-6-astra(?:-|$)/.test(normalized)) return LOW_TO_MAX;

  // Only text reasoning models: image/audio and explicitly non-reasoning variants
  // must not acquire unsupported parameters just because their family matches.
  if (!/(?:image|audio|live|non-reasoning)/.test(normalized)) {
    if (/^gemini-2\.5-flash(?:-|$)/.test(normalized)) return THROUGH_HIGH;
    if (/^gemini-2\.5-pro(?:-|$)/.test(normalized)) return LOW_TO_HIGH;
    if (/^gemini-3\.1-(?:pro|flash-lite)(?:-|$)/.test(normalized)) return LOW_TO_HIGH;
    if (/^gemini-3-flash(?:-|$)/.test(normalized)) return LOW_TO_HIGH;
    if (/^gemini-3\.7-flash(?:-|$)/.test(normalized)) return LOW_TO_HIGH;
    if (/^gemini-3-pro(?:-|$)/.test(normalized)) return ["low", "high"];
    if (/^grok-4\.5(?:-|$)/.test(normalized)) return LOW_TO_HIGH;
    if (/^grok-4\.6(?:-|$)/.test(normalized)) return LOW_TO_XHIGH;
    if (/^grok-3-mini(?:-|$)/.test(normalized)) return ["low", "high"];
  }

  if (/^gpt-5\.6(?:-|$)/.test(normalized)) return REASONING_EFFORTS;
  if (/^gpt-5\.5(?:-|$)/.test(normalized)) return THROUGH_XHIGH;
  if (/^gpt-5\.4-mini(?:-|$)/.test(normalized)) return THROUGH_XHIGH;
  if (/^gpt-5\.4(?:-|$)/.test(normalized)) return THROUGH_HIGH;

  return [];
};

export const normalizeReasoningEffort = (value: unknown): ReasoningEffort | null => {
  if (value === "minimal") return "none";
  return isReasoningEffort(value) ? value : null;
};

export const clampReasoningEffort = (
  model: string,
  effort: ReasoningEffort,
): ReasoningEffort | null => {
  const available = reasoningEffortsForModel(model);
  if (available.length === 0) return null;
  if (available.includes(effort)) return effort;
  // Preserve intent across model switches: none -> low, max -> highest supported.
  const rank = REASONING_EFFORTS.indexOf(effort);
  return (
    available.find((candidate) => REASONING_EFFORTS.indexOf(candidate) >= rank) ??
    available.at(-1) ??
    DEFAULT_REASONING_EFFORT
  );
};

export const reasoningOptionsForModel = (model: string, value: unknown) => {
  const effort = clampReasoningEffort(
    model,
    normalizeReasoningEffort(value) ?? DEFAULT_REASONING_EFFORT,
  );
  // The OpenAI SDK otherwise strips reasoning for unrecognized/non-OpenAI IDs.
  // The SDK serializes this to reasoning.effort (Responses) or reasoning_effort (Chat).
  return effort ? { reasoningEffort: effort, forceReasoning: true } : {};
};
