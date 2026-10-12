import { z } from "zod";

export const mediaRefSchema = z.object({
  kind: z.enum(["image", "video", "audio"]),
  path: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().optional(),
  dataUrl: z.string().optional(),
});

const generationMetaSchema = z.object({
  type: z.enum(["chat", "image", "video"]),
  providerName: z.string(),
  modelName: z.string(),
  modelId: z.string(),
  videoOptions: z.lazy(() => videoOptionsSchema).optional(),
  imageOptions: z.lazy(() => imageOptionsSchema).optional(),
});

export const messageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.string(),
  status: z.enum(["complete", "processing", "failed", "stopped"]),
  error: z.string().optional(),
  taskId: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
  completedTaskIds: z.array(z.string()).optional(),
  failedTaskIds: z.array(z.string()).optional(),
  attachments: z.array(mediaRefSchema).optional(),
  media: z.array(mediaRefSchema).optional(),
  generation: generationMetaSchema.optional(),
});

export const imageOptionsSchema = z.object({
  ratio: z.enum(["adaptive", "1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9", "custom"]),
  resolution: z.enum(["2K", "4K"]),
  count: z.number().int().min(1).max(4),
  width: z.number().int().min(512).max(4096).optional(),
  height: z.number().int().min(512).max(4096).optional(),
}).superRefine((options, ctx) => {
  if (options.ratio === "custom" && (!options.width || !options.height)) {
    ctx.addIssue({ code: "custom", message: "自定义尺寸需要填写宽和高" });
  }
});

export const videoOptionsSchema = z.object({
  referenceMode: z.enum(["text", "first", "first_last", "references"]),
  ratio: z.enum(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  resolution: z.enum(["480p", "720p", "1080p", "4k"]),
  duration: z.number().int().min(3).max(60),
  count: z.number().int().min(1).max(4),
  audio: z.boolean(),
  watermark: z.boolean(),
  cameraFixed: z.boolean(),
});

export const conversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  imageOptions: imageOptionsSchema.optional(),
  videoOptions: videoOptionsSchema.optional(),
  messages: z.array(messageSchema),
});

export const generateRequestSchema = z.object({
  conversationId: z.string(),
  /** 浏览器生成的用户消息 ID:用户消息和生成任务都由服务端写入对话 */
  userMessageId: z.string().regex(/^[\w-]{1,80}$/).optional(),
  modelId: z.string().min(1),
  prompt: z.string(),
  attachments: z.array(mediaRefSchema).default([]),
  videoOptions: videoOptionsSchema,
});
