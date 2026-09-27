import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { failure } from "@/lib/http";
import { inside, outDir } from "@/lib/paths";
import { parseByteRange } from "@/lib/byte-range";

const contentTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

function streamFile(path: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(path, start === undefined ? undefined : { start, end })) as ReadableStream;
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const path = inside(outDir, ...(await context.params).path);
    const { size } = await stat(path);
    const headers: Record<string, string> = {
      "Content-Type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      // 视频拖动进度条、Safari 播放都依赖分段读取
      "Accept-Ranges": "bytes",
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
