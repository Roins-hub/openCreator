/**
 * 模型选择面板的归类:厂商 → 系列。
 * - 厂商:优先用模型标签里的「厂商:xxx」,其次是中转站后台给模型设的供应商,都没有时按模型名推断;
 * - 系列:优先用标签里的「系列:xxx」,否则从模型名自动识别:去掉渠道号(ch0101)、分辨率(720p)、
 *   日期(260128)、渠道后缀(cf、no-2k-4k)和厂商前缀(doubao-),剩下的部分整理成系列名,
 *   例如 ch0112-sd-2.0-480p-fast → Seedance 2.0 Fast、gpt-image-2.5-flare-cf → GPT Image 2.5 Flare、
 *   veo-3.1-fast → Veo 3.1 Fast。新系列不需要改代码,名字不规则时在中转站后台加标签即可。
 */

const SERIES_TAG = /^(?:系列|series)\s*[:：]\s*(.+)$/i;
const VENDOR_TAG = /^(?:厂商|供应商|vendor)\s*[:：]\s*(.+)$/i;

/** 标签字符串(逗号分隔)里的「系列:」「厂商:」 */
export function taggedGroup(tags?: string | null) {
  const list = String(tags || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  return {
    series: list.map((item) => SERIES_TAG.exec(item)?.[1]?.trim()).find(Boolean),
    vendor: list.map((item) => VENDOR_TAG.exec(item)?.[1]?.trim()).find(Boolean),
  };
}

// 不属于系列名的片段:渠道号、分辨率、日期、渠道后缀、生成方式
const NOISE = [
  /^ch\d+$/i, /^\d{3,4}p$/i, /^[1-8]k$/i, /^\d{6,8}$/, /^(?:cf|no|latest|generate|generation|video|t2v|i2v|r2v|s2v|it2v)$/i,
];
// 模型名开头的厂商前缀(后面还有内容时去掉)
const VENDOR_PREFIX = /^(?:doubao|bytedance|google|openai|minimax|kwai|kuaishou|alibaba|aliyun|tencent|baidu)$/i;
const CASING: Record<string, string> = {
  sd: "Seedance", seedance: "Seedance", seedream: "Seedream", gpt: "GPT", veo: "Veo", sora: "Sora",
  kling: "Kling", hailuo: "Hailuo", wan: "Wan", vidu: "Vidu", flux: "FLUX", imagen: "Imagen", dall: "DALL", e: "E",
  nano: "Nano", banana: "Banana", gemini: "Gemini", midjourney: "Midjourney", mj: "MJ", jimeng: "即梦",
  pixverse: "PixVerse", runway: "Runway", luma: "Luma", pika: "Pika", hunyuan: "Hunyuan", qwen: "Qwen",
};

const tidy = (token: string) => {
  const known = CASING[token.toLowerCase()];
  if (known) return known;
  if (/^v\d/i.test(token) || /^\d/.test(token)) return token.toLowerCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
};

/** 从模型名识别系列(不看标签) */
export function seriesFromName(id: string) {
  const tokens = id.trim()
    .split(/[\s_-]+/)
    .filter((token) => token && !NOISE.some((pattern) => pattern.test(token)))
    // 名字和版本号粘在一起的(veo3、wan2.5)拆开;v2 这种版本号不拆
    .flatMap((token) => {
      const glued = /^([a-z]{2,})(\d[\d.]*)$/i.exec(token);
      return glued ? [glued[1], glued[2]] : [token];
    });
  while (tokens.length > 1 && VENDOR_PREFIX.test(tokens[0])) tokens.shift();
  // 相邻的短数字是版本号:2-0 → 2.0、v2-1 → v2.1
  const merged: string[] = [];
  for (const token of tokens) {
    const last = merged.at(-1);
    if (last && /^\d{1,2}$/.test(token) && /^(?:v?\d{1,2})$/i.test(last)) merged[merged.length - 1] = `${last}.${token}`;
    else merged.push(token);
  }
  return merged.map(tidy).join(" ").replace(/\bDALL E\b/, "DALL·E").trim() || id;
}

const VENDOR_RULES: [RegExp, string][] = [
  [/seedance|seedream|doubao|(?:^|[-_])sd-\d/i, "豆包"],
  [/veo|imagen|gemini|banana/i, "Google"],
  [/gpt|sora|dall-?e|openai/i, "OpenAI"],
  [/hailuo|minimax/i, "MiniMax"],
  [/kling|kwai|kuaishou/i, "可灵"],
  [/(?:^|[-_])wan[\d.-]|tongyi|wanx/i, "通义万相"],
  [/vidu/i, "Vidu"],
  [/flux/i, "Black Forest Labs"],
  [/midjourney|(?:^|[-_])mj[-_]/i, "Midjourney"],
  [/jimeng/i, "即梦"],
  [/hunyuan/i, "腾讯混元"],
  [/qwen/i, "通义千问"],
  [/runway/i, "Runway"],
  [/luma|(?:^|[-_])ray-/i, "Luma"],
  [/pixverse/i, "PixVerse"],
];

export function vendorFromName(id: string) {
  return VENDOR_RULES.find(([pattern]) => pattern.test(id))?.[1] || "其他";
}

/** 模型的厂商和系列:标签 > 中转站后台的供应商 > 模型名 */
export function classifyModel(id: string, tags?: string | null, vendorName?: string | null) {
  const tagged = taggedGroup(tags);
  return {
    vendor: tagged.vendor || vendorName?.trim() || vendorFromName(id),
    series: tagged.series || seriesFromName(id),
  };
}

/** /api/pricing 里的 vendors 列表:id → 名称 */
export function vendorNames(payload: unknown) {
  const vendors = (payload as { vendors?: { id?: unknown; name?: unknown }[] })?.vendors || [];
  return new Map(vendors
    .filter((item) => typeof item.id === "number" && typeof item.name === "string" && item.name.trim())
    .map((item) => [item.id as number, (item.name as string).trim()]));
}

/** 渠道号(ch0101-xxx 的 ch0101),没有时用像渠道代号的标签(CH01、DOLA;「图片」这类说明性标签不算) */
export function channelOf(id: string, tag?: string) {
  return /^(ch\d+)[-_]/i.exec(id)?.[1]?.toUpperCase() || (tag && /^[A-Z][A-Z0-9_-]{1,11}$/.test(tag) ? tag : "");
}

export interface CatalogGroup<T> { vendor: string; series: { name: string; models: T[] }[] }

/** 按厂商 → 系列分组;厂商和系列按名称排序,「其他」放最后 */
export function groupModels<T extends { vendor: string; series: string }>(models: readonly T[]): CatalogGroup<T>[] {
  const vendors = new Map<string, Map<string, T[]>>();
  for (const model of models) {
    const series = vendors.get(model.vendor) ?? new Map<string, T[]>();
    vendors.set(model.vendor, series);
    series.set(model.series, [...(series.get(model.series) ?? []), model]);
  }
  const byName = (a: string, b: string) =>
    (a === "其他" ? 1 : 0) - (b === "其他" ? 1 : 0) || a.localeCompare(b, "zh-CN", { numeric: true });
  return [...vendors.entries()]
    .sort(([a], [b]) => byName(a, b))
    .map(([vendor, series]) => ({
      vendor,
      series: [...series.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
        .map(([name, items]) => ({ name, models: items })),
    }));
}

/** 搜索:模型名、系列、厂商、渠道、描述里包含全部关键词(空格分隔,不分大小写) */
export function matchesQuery(
  model: { id: string; vendor: string; series: string; tag?: string; description?: string },
  query: string,
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [model.id, model.vendor, model.series, model.tag, model.description, channelOf(model.id, model.tag)]
    .join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}
