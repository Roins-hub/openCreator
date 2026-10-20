export type ModelType = "chat" | "image" | "video";
export interface MediaRef {
  kind: "image" | "video" | "audio";
  path: string;
  name: string;
  mimeType?: string;
  dataUrl?: string;
  /** 文件大小(字节);生成结果保存时记下,旧记录没有 */
  size?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  status: "complete" | "processing" | "failed" | "stopped";
  error?: string;
  taskId?: string;
  taskIds?: string[];
  completedTaskIds?: string[];
  failedTaskIds?: string[];
  /** 生成记录对应的用户提示词消息 ID:并发生成时消息不再一问一答相邻,靠它配对和一起删除 */
  replyTo?: string;
  /** 生成用时(毫秒):中转站从受理到出结果的时间;一次生成多条时取最长的一条 */
  elapsedMs?: number;
  attachments?: MediaRef[];
  media?: MediaRef[];
  /** 生成时使用的模型与参数快照,用于任务卡片展示、重新编辑和重新生成。 */
  generation?: GenerationMeta;
}

export interface GenerationMeta {
  type: ModelType;
  providerName: string;
  modelName: string;
  modelId: string;
  videoOptions?: VideoOptions;
  imageOptions?: ImageOptions;
}

export interface Conversation {
  id: string;
  title: string;
  providerId?: string;
  modelId?: string;
  /** 侧边栏分组;分组被解散后残留的 ID 当作未分组 */
  groupId?: string;
  createdAt: string;
  updatedAt: string;
  imageOptions?: ImageOptions;
  videoOptions?: VideoOptions;
  messages: Message[];
}

/**
 * 生图参数。分辨率档位与中转站的阶梯计价一致(1K / 2K / 4K);
 * 没有「画质」:2026-10-15 实测中转站会忽略它,高低画质扣费和效果都一样。
 */
export interface ImageOptions {
  /** 预设比例(1:1、16:9、21:9 等)或自定义「宽:高」 */
  ratio: string;
  resolution: "1k" | "2k" | "4k";
  background: "auto" | "opaque" | "transparent";
  format: "png" | "jpeg" | "webp";
  count: number;
}

export interface VideoOptions {
  referenceMode: "text" | "first" | "first_last" | "references";
  ratio: "adaptive" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  resolution: "480p" | "720p" | "1080p" | "4k";
  duration: number;
  count: number;
  audio: boolean;
  watermark: boolean;
  cameraFixed: boolean;
}
