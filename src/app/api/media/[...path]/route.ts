import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { failure } from "@/lib/http";
import { ownsMedia, sessionUserId } from "@/lib/identity";
import { assertKey, browserMediaUrl, derivedKey, verifyMediaSignature } from "@/lib/object-store";
import { ensureDerived, hasDerived, variantForWidth, variantProcess, type DerivedVariant } from "@/lib/media-derived";
import { inside, outDir } from "@/lib/paths";
import { parseByteRange } from "@/lib/byte-range";

const contentTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".json": "application/json",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
/** 要哪种规格:?thumb=<宽度>(≤480 给 480 档,更大给 1080 档) / ?view=1(放大查看的大图);不要就是原文件 */
function variantOf(query: URLSearchParams): DerivedVariant | undefined {
  if (query.get("download")) return undefined;
  if (query.get("view") === "1") return "view";
  const thumb = query.get("thumb");
  return thumb ? variantForWidth(Number(thumb) || 480) : undefined;
}

function streamFile(path: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(path, start === undefined ? undefined : { start, end })) as ReadableStream;
}

/**
 * 媒体访问:只有文件所属用户(签名 Cookie)或带有效签名的链接(给中转站拉素材)可以读取。
 * 云存储时跳转到临时直链,浏览器直接从云存储取文件,不经过本站服务器。
 * ?thumb=<宽度>:要缩略图(图片缩小转 WebP、视频取首帧),列表和卡片里用,省流量、出图快;
 * ?view=1:放大查看的大图(原尺寸 WebP,比 PNG 原图小得多);下载(?download=)永远是原文件。
 * 已经生成保存过的直接给保存好的文件;还没有的先现场处理,同时在后台生成保存(见 media-derived.ts)。
 * 存储不支持处理时,图片给原图,视频缩略图返回 404(页面退回用视频首帧)。
 */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const key = assertKey((await context.params).path.join("/"));
    const query = new URL(request.url).searchParams;
    const userId = await sessionUserId(request);
    const allowed = (userId && await ownsMedia(userId, key)) ||
      await verifyMediaSignature(key, query.get("exp"), query.get("sig"));
    if (!allowed) return failure(new Error("无权访问该文件"), 404);

    const download = query.get("download") || undefined;
    const variant = variantOf(query);
    const process = variant ? variantProcess(key, variant) : undefined;
    if (process === null) return failure(new Error("没有缩略图"), 404);
    let direct: Awaited<ReturnType<typeof browserMediaUrl>>;
    if (variant && process && await hasDerived(key, variant).catch(() => false)) {
      direct = await browserMediaUrl(derivedKey(key, variant));
    } else {
      direct = await browserMediaUrl(key, { download, process });
      if (variant && process) ensureDerived(key, variant);
    }
    if (direct) {
      return new Response(null, {
        status: 302,
        headers: { Location: direct.url, "Cache-Control": `private, max-age=${direct.maxAge}` },
      });
    }

    const path = inside(outDir, key);
    const { size } = await stat(path);
    const headers: Record<string, string> = {
      "Content-Type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      // 视频拖动进度条、Safari 播放都依赖分段读取
      "Accept-Ranges": "bytes",
      ...(download ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download)}` } : {}),
    };
    const rangeHeader = request.headers.get("range");
    if (!rangeHeader) {
      return new Response(streamFile(path), { headers: { ...headers, "Content-Length": String(size) } });
    }
    const range = parseByteRange(rangeHeader, size);
    if (!range) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    return new Response(streamFile(path, range.start, range.end), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  } catch (error) { return failure(error, 404); }
}
