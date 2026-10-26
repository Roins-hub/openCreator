import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { requireUser } from "@/lib/identity";

/**
 * 浏览器上报的问题,写进工作台的服务日志(journalctl -u mote | grep 浏览器上报)。
 * 要带 Key(只收自己用户的),字段都限定长度,不记文件路径和 Key。
 */
const schema = z.object({
  event: z.enum(["image-progress-fallback"]),
  reason: z.string().trim().min(1).max(40),
  origin: z.string().trim().max(200),
  online: z.boolean().optional(),
  attempts: z.number().int().min(0).max(10).optional(),
});

const LABELS: Record<z.infer<typeof schema>["event"], string> = {
  "image-progress-fallback": "原图进度降级为直接加载",
};

const clean = (value: string) => value.replace(/[^\w.:/\-]/g, "?");

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = schema.parse(await request.json());
    console.warn(`[mote] 浏览器上报:${LABELS[input.event]} reason=${clean(input.reason)} origin=${clean(input.origin)}` +
      ` online=${input.online ?? "?"} attempts=${input.attempts ?? "?"} user=${userId.slice(0, 8)}`);
    return ok({ logged: true });
  } catch (error) {
    return failure(error, 400);
  }
}
