/**
 * 从中转站模型描述里读出生成参数的限制(比例、分辨率、时长、参考素材、首尾帧)。
 * 描述是人写的,格式不统一,例如:
 *   "(按秒计费) 9图片，3音频，3视频，合计≤12，720p，4s-15s，可真人"
 *   "BD2.5：720P，4–30 整数秒，按条计费；比例 16:9 / 9:16；最多 30 张参考图 / 10 段参考视频 / 10 段参考音频。"
 *   "适合用途：Mini 档首尾帧；4–15 秒；480p / 720p 同价…默认 480p，不提供 1080p / 4K。"
 *   "仅文生图。size 1024x1024 / 1792x1024 / 1024x1792。"
 * 原则:写了的才限制,没写到的不限制;「不提供 / 不支持 / 不接 / 无」后面的是排除项;
 * 「默认」「不传 … 按」只是缺省值,不算可选范围。
 */

type Clause = { text: string; negative: boolean; defaultsOnly: boolean };

const NEGATIVE = /不提供|不支持|不接|不含|不可|无(?!水印)/;
const DEFAULTS_ONLY = /默认|不传|省略/;

function normalize(text: string) {
  return String(text || "")
    .replace(/[–—－~～]/g, "-")
    .replace(/[：]/g, ":")
    .replace(/[／]/g, "/")
    .replace(/[×]/g, "x")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")");
}

/** 按标点切成小句;顿号不切(「不接参考音频、视频和首尾帧」要整句看) */
export function specClauses(description: string): Clause[] {
  return normalize(description)
    .split(/[，,；;。\n()·]/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, negative: NEGATIVE.test(text), defaultsOnly: DEFAULTS_ONLY.test(text) }));
}

const RESOLUTION_TOKEN = /(\d{3,4})\s*p(?![a-z])|(?<![\d.])([1-8])\s*k(?![a-z])/gi;

function resolutionTokens(text: string) {
  const found: string[] = [];
  for (const match of text.matchAll(RESOLUTION_TOKEN)) found.push(match[1] ? `${match[1]}p` : `${match[2]}k`);
  return found;
}

/** 写到的分辨率(去掉被排除的);一个都没写时 allowed 为空 */
export function specResolutions(clauses: Clause[]) {
  const allowed = new Set<string>();
  const excluded = new Set<string>();
  for (const clause of clauses) {
    // 「超分 4K」是输出被放大,不是可选档位
    if (/超分/.test(clause.text)) continue;
    const tokens = resolutionTokens(clause.text);
    if (clause.negative) tokens.forEach((token) => excluded.add(token));
    else if (!clause.defaultsOnly) tokens.forEach((token) => allowed.add(token));
  }
  excluded.forEach((token) => allowed.delete(token));
  return { allowed: [...allowed], excluded: [...excluded] };
}

const NOT_DURATION = /总计|总时长|参考视频.*秒|参考音频.*秒|字符/;

/** 可选的整数秒;没写时返回空数组 */
export function specDurations(clauses: Clause[]) {
  const seconds = new Set<number>();
  for (const clause of clauses) {
    if (clause.negative || clause.defaultsOnly || NOT_DURATION.test(clause.text)) continue;
    if (!/秒|\d\s*s(?![a-z])/i.test(clause.text)) continue;
    // 去掉比例、分辨率、数量这些也带数字的写法
    const text = clause.text
      // 价格(¥0.46/秒、0.3-0.8元/秒、$1.2)不是时长
      .replace(/[¥￥$]\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?/g, " ")
      .replace(/\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:元|块|美元|刀)/g, " ")
      .replace(/\d+\.\d+/g, " ")
      .replace(/\d+\s*:\s*\d+/g, " ")
      .replace(RESOLUTION_TOKEN, " ")
      .replace(/\d+\s*(?:张|段|个|份|条|图|视频|音频)/g, " ")
      // 型号里的数字(seedance2.5、duration 6)不是时长
      .replace(/[a-z]+\s*\d+(?:\.\d+)?/gi, " ");
    const range = /(\d{1,3})\s*s?\s*(?:-|至|到)\s*(\d{1,3})\s*(?:整数)?\s*(?:s(?![a-z])|秒)/i.exec(text);
    if (range) {
      const [min, max] = [Number(range[1]), Number(range[2])];
      if (min >= 1 && max >= min && max <= 120) for (let value = min; value <= max; value++) seconds.add(value);
      continue;
    }
    for (const match of text.matchAll(/\d{1,3}/g)) {
      const value = Number(match[0]);
      if (value >= 1 && value <= 120) seconds.add(value);
    }
  }
  return [...seconds].sort((a, b) => a - b);
}

/** 写到的比例(「比例 / 画幅 / size」那几句里的 宽:高),以及明确不支持的比例 */
export function specRatios(clauses: Clause[]) {
  const allowed = new Set<string>();
  const excluded = new Set<string>();
  for (const clause of clauses) {
    const ratios = [...clause.text.matchAll(/(?<![\d.])(\d{1,2})\s*:\s*(\d{1,2})(?![\d.])/g)].map((match) => `${match[1]}:${match[2]}`);
    if (!ratios.length) continue;
    if (clause.negative) ratios.forEach((ratio) => excluded.add(ratio));
    else if (/比例|画幅|aspect|size|ratio/i.test(clause.text) && !clause.defaultsOnly) ratios.forEach((ratio) => allowed.add(ratio));
  }
  excluded.forEach((ratio) => allowed.delete(ratio));
  return { allowed: [...allowed], excluded: [...excluded] };
}

/** 写死的像素尺寸,如 size 1024x1024 / 1792x1024 */
export function specSizes(clauses: Clause[]) {
  const sizes: [number, number][] = [];
  for (const clause of clauses) {
    if (clause.negative) continue;
    for (const match of clause.text.matchAll(/(\d{3,4})\s*x\s*(\d{3,4})/gi)) {
      sizes.push([Number(match[1]), Number(match[2])]);
    }
  }
  return sizes;
}

/** 参考素材上限;一类都没写时返回 undefined(由调用方用通用值) */
export function specMedia(clauses: Clause[]) {
  const positive = clauses.filter((clause) => !clause.negative).map((clause) => clause.text).join("，");
  const number = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = pattern.exec(positive);
      if (match) return Number(match[1]);
    }
    return undefined;
  };
  let images = number([/参考图(?:片)?\s*最多\s*(\d+)/, /(\d+)\s*张?\s*(?:公网)?\s*(?:参考)?\s*图(?:片)?(?!生)/]);
  let videos = number([/(\d+)\s*(?:段|个)?\s*(?:参考)?\s*视频(?!转)/]);
  let audios = number([/(\d+)\s*(?:段|个)?\s*(?:参考)?\s*音频/]);
  const total = number([/合计\s*[≤<=]*\s*(\d+)/, /合计最多\s*(\d+)/]);
  let frames = true;
  for (const clause of clauses) {
    if (clause.negative) {
      // 「图生视频」「视频转视频」说的是生成方式,不是参考素材
      if (/视频/.test(clause.text.replace(/[图文]生视频|转视频/g, ""))) videos = 0;
      if (/音频/.test(clause.text)) audios = 0;
      if (/首尾帧/.test(clause.text)) frames = false;
    }
    if (/仅参考素材|只支持参考素材/.test(clause.text)) frames = false;
    if (/仅文生|只支持文生|纯文生/.test(clause.text)) images = 0;
  }
  const mentioned = images !== undefined || videos !== undefined || audios !== undefined;
  return { images, videos, audios, total, frames, mentioned };
}

export function specFace(description: string) {
  return normalize(description).match(/(可真人|过人脸|卡人脸)/)?.[1] || "";
}
