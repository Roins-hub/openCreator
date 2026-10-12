import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { failure } from "@/lib/http";
import { ownsMedia, sessionUserId } from "@/lib/identity";
import { assertKey, signedUrl, verifyMediaSignature } from "@/lib/object-store";
import { inside, outDir } from "@/lib/paths";
import { parseByteRange } from "@/lib/byte-range";

const contentTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".wav": "audio/wav",
};
const LINK_TTL = 3600;

function streamFile(path: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(path, start === undefined ? undefined : { start, end })) as ReadableStream;
}

/**
 * 媒体访问:只有文件所属用户(签名 Cookie)或带有效签名的链接(给中转站拉素材)可以读取。
 * 云存储时跳转到 R2 临时直链,浏览器直接从 R2 取文件,不经过本站服务器。
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
    const direct = await signedUrl(key, LINK_TTL, download);
    if (direct) {
      return new Response(null, {
        status: 302,
        headers: { Location: direct, "Cache-Control": `private, max-age=${LINK_TTL / 2}` },
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
