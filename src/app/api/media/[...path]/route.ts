import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { failure } from "@/lib/http";
import { ownsMedia, sessionUserId } from "@/lib/identity";
import { assertKey, browserMediaUrl, thumbProcess, verifyMediaSignature } from "@/lib/object-store";
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
// 缩略图宽度只给这几档(请求的宽度向上取),同一张图的缩略图不会因为宽度零碎而重复生成、各缓存一份
const THUMB_WIDTHS = [240, 480, 720, 1080];
const thumbWidth = (value: string | null) => {
  if (!value) return 0;
  const width = Number(value) || 480;
  return THUMB_WIDTHS.find((item) => item >= width) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
};

function streamFile(path: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(path, start === undefined ? undefined : { start, end })) as ReadableStream;
}

/**
 * 媒体访问:只有文件所属用户(签名 Cookie)或带有效签名的链接(给中转站拉素材)可以读取。
 * 云存储时跳转到临时直链,浏览器直接从云存储取文件,不经过本站服务器。
 * ?thumb=<宽度>:要缩略图(图片缩小转 WebP、视频取首帧),列表和卡片里用,省流量、出图快;
 * 存储不支持处理时,图片给原图,视频返回 404(页面退回用视频首帧)。
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
    const width = download ? 0 : thumbWidth(query.get("thumb"));
    const process = width ? thumbProcess(key, width) : undefined;
    if (process === null) return failure(new Error("没有缩略图"), 404);
    const direct = await browserMediaUrl(key, { download, process });
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
