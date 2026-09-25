import { z } from "zod";

export const modelConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1, "模型显示名称不能为空"),
    modelId: z.string().min(1, "Model ID 不能为空"),
    type: z.enum(["chat", "image", "video"]),
    maxReferenceImages: z.number().int().min(0).max(8).default(2),
    maxVideoDuration: z.number().int().min(3).max(60).default(10),
    supportsImageInput: z.boolean().optional(),
  })
  .transform((model) => ({
    ...model,
    // 图像/视频模型天然接收图片;对话模型默认纯文本,多模态视觉模型需显式开启。
    supportsImageInput: model.supportsImageInput ?? model.type !== "chat",
  }));

export const providerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "供应商名称不能为空"),
  baseUrl: z.url(),
  apiKey: z.string().default(""),
  accessKeyId: z.string().default(""),
  secretAccessKey: z.string().default(""),
  apiType: z.enum(["ark", "openai", "dola", "jimeng", "kling"]).optional(),
  models: z.array(modelConfigSchema).superRefine((models, ctx) => {
    const ids = new Set<string>();
    models.forEach((model, index) => {
      if (ids.has(model.id)) ctx.addIssue({
        code: "custom", message: "模型 ID 不能重复", path: [index, "id"],
      });
      ids.add(model.id);
    });
  }),
}).superRefine((provider, ctx) => {
  if (provider.apiType === "jimeng") {
    if (!provider.accessKeyId) {
      ctx.addIssue({ code: "custom", message: "即梦视觉需要 Access Key ID", path: ["accessKeyId"] });
    }
    if (!provider.secretAccessKey) {
      ctx.addIssue({ code: "custom", message: "即梦视觉需要 Secret Access Key", path: ["secretAccessKey"] });
    }
  } else if (!provider.apiKey) {
    ctx.addIssue({ code: "custom", message: "该接口类型需要 API Key", path: ["apiKey"] });
  }
}).transform((provider) => ({
  ...provider,
  apiType: provider.apiType ||
    (/deepseek\.com|\/v1\/?$/i.test(provider.baseUrl) ? "openai" as const : "ark" as const),
}));

export const appConfigSchema = z.object({
  providers: z.array(providerConfigSchema),
});

export const mediaRefSchema = z.object({
  kind: z.enum(["image", "video"]),
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
  providerId: z.string(),
  modelId: z.string(),
  prompt: z.string(),
  attachments: z.array(mediaRefSchema).default([]),
  imageOptions: imageOptionsSchema.optional(),
  videoOptions: videoOptionsSchema.optional(),
});
