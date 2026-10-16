import { describe, expect, it } from "vitest";
import { conversationSchema, generateRequestSchema } from "./schemas";

describe("conversationSchema", () => {
  it("keeps generation metadata and local media references", () => {
    const result = conversationSchema.safeParse({
      id: "conversation-1",
      title: "雨夜列车",
      providerId: "ark",
      modelId: "video",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:01:00.000Z",
      messages: [{
        id: "message-1",
        role: "assistant",
        content: "",
        createdAt: "2026-07-23T00:01:00.000Z",
        status: "processing",
        taskId: "task-1",
        media: [{ kind: "video", path: "videos/result.mp4", name: "result.mp4" }],
      }],
    });

    expect(result.success).toBe(true);
  });

  it("persists a user-stopped generation", () => {
    const result = conversationSchema.parse({
      id: "conversation-stopped",
      title: "停止测试",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:01:00.000Z",
      messages: [{
        id: "message-stopped",
        role: "assistant",
        content: "",
        createdAt: "2026-07-23T00:01:00.000Z",
        status: "stopped",
        error: "已停止生成",
      }],
    });

    expect(result.messages[0].status).toBe("stopped");
  });

  it("persists image and video generation options per conversation", () => {
    const result = conversationSchema.safeParse({
      id: "conversation-2",
      title: "参数测试",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:01:00.000Z",
      messages: [],
      imageOptions: {
        ratio: "16:9", background: "transparent", format: "webp", count: 4,
      },
      videoOptions: {
        referenceMode: "first_last", ratio: "adaptive", resolution: "720p",
        duration: 5, count: 4, audio: true, watermark: false, cameraFixed: false,
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("generateRequestSchema", () => {
  const videoOptions = {
    referenceMode: "references", ratio: "16:9", resolution: "720p",
    duration: 5, count: 1, audio: true, watermark: false, cameraFixed: false,
  };

  it("rejects generation counts outside the safe 1–4 range", () => {
    const result = generateRequestSchema.safeParse({
      conversationId: "conversation-1", modelId: "ch0101-sd-2.0-720p",
      prompt: "测试", attachments: [], videoOptions: { ...videoOptions, count: 5 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts image, video and audio references", () => {
    const result = generateRequestSchema.safeParse({
      conversationId: "conversation-1", modelId: "ch0101-sd-2.0-720p", prompt: "测试",
      attachments: [
        { kind: "image", path: "uploads/a.png", name: "a.png" },
        { kind: "video", path: "uploads/b.mp4", name: "b.mp4" },
        { kind: "audio", path: "uploads/c.mp3", name: "c.mp3" },
      ],
      videoOptions,
    });
    expect(result.success).toBe(true);
  });

  it("leaves the options to the model type: video options or image options", () => {
    const base = { conversationId: "conversation-1", modelId: "gpt-image-2", prompt: "测试", attachments: [] };
    expect(generateRequestSchema.safeParse(base).success).toBe(true);
    const image = { ratio: "16:9", background: "auto", format: "png", count: 2 };
    expect(generateRequestSchema.safeParse({ ...base, imageOptions: image }).success).toBe(true);
    expect(generateRequestSchema.safeParse({ ...base, imageOptions: { ...image, ratio: "21:9" } }).success).toBe(true);
    expect(generateRequestSchema.safeParse({ ...base, imageOptions: { ...image, ratio: "7:5" } }).success).toBe(true);
    expect(generateRequestSchema.safeParse({ ...base, imageOptions: { ...image, ratio: "1:9" } }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...base, imageOptions: { ...image, ratio: "宽" } }).success).toBe(false);
  });
});
