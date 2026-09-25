export type ModelType = "chat" | "image" | "video";
export type ProviderApiType = "ark" | "openai" | "dola" | "jimeng" | "kling";

export interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
  type: ModelType;
  maxReferenceImages: number;
  maxVideoDuration: number;
  /**
   * 对话模型是否接受图片输入。图像/视频模型始终视为 true;
   * 对话模型默认 false(纯文本),多模态视觉模型(如 GPT-4o / Claude / GLM-4V)需手动开启。
   * 决定 toChatMessages 是否把附件转成 image_url,以及输入框是否允许给该模型贴图。
   */
  supportsImageInput: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  apiType: ProviderApiType;
  models: ModelConfig[];
}

export interface AppConfig {
  providers: ProviderConfig[];
}

export interface MediaRef {
  kind: "image" | "video";
  path: string;
  name: string;
  mimeType?: string;
  dataUrl?: string;
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
  attachments?: MediaRef[];
  media?: MediaRef[];
}

export interface Conversation {
  id: string;
  title: string;
  providerId?: string;
  modelId?: string;
  createdAt: string;
  updatedAt: string;
  imageOptions?: ImageOptions;
  videoOptions?: VideoOptions;
  messages: Message[];
}

export interface ImageOptions {
  ratio: "adaptive" | "1:1" | "3:4" | "4:3" | "16:9" | "9:16" | "2:3" | "3:2" | "21:9" | "custom";
  resolution: "2K" | "4K";
  count: number;
  width?: number;
  height?: number;
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
