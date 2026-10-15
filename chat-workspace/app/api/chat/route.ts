import { createOpenAI } from "@ai-sdk/openai";
import { frontendTools, injectQuoteContext, type FrontendTools } from "@assistant-ui/react-ai-sdk";
import { streamText, convertToModelMessages, type ToolSet, type UIMessage } from "ai";
import { normalizeApiKey, normalizeModel } from "@/lib/providers";
import { resolveRelayTarget } from "@/lib/relay-target";
import { IMAGE_WORKSPACE_TOOL_NAME } from "@/lib/image-workspace";
import { reasoningOptionsForModel } from "@/lib/reasoning";
import { usesChatCompletions, repairResponsesStream, chatErrorMessage } from "@/lib/relay-compat";

export const runtime = "nodejs";
export const maxDuration = 300;

const errorResponse = (message: string, status: number) =>
  Response.json({ error: message }, { status });

const IMAGE_TOOL_SCHEMA: FrontendTools = {
  [IMAGE_WORKSPACE_TOOL_NAME]: {
    description:
      "Prepare an optimized image-generation prompt and let the user open the image workspace with that prompt prefilled.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: 6000,
          description: "A polished, detailed prompt ready for an image generation model.",
        },
      },
      required: ["prompt"],
    },
  },
};

const getLatestUserText = (messages: UIMessage[]) => {
  const message = [...messages].reverse().find((item) => item.role === "user");
  if (!message) return "";
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const parseImageCommand = (text: string) => {
  const match = text.match(/^\/生图(?:\s*[:：]\s*|\s+)?([\s\S]*)$/);
  if (!match) return null;
  return match[1]?.trim() ?? "";
};

const parseSlashCommand = (text: string) => {
  const match = text.match(/^\/([^\s:：]+)(?:\s*[:：]\s*|\s+)?([\s\S]*)$/);
  if (!match) return null;
  return {
    name: match[1] ?? "",
    request: match[2]?.trim() ?? "",
  };
};

const imageCommandSystem = (request: string) =>
  `
The user invoked the /生图 command. Turn their request into one production-ready image-generation prompt, then call ${IMAGE_WORKSPACE_TOOL_NAME} exactly once.

Requirements:
- Preserve the user's subject, intent, language, named entities, and constraints.
- Expand useful visual details: composition, subject appearance, environment, lighting, color, camera/viewpoint, materials, mood, and finish.
- Do not add explanations, alternatives, markdown, or policy commentary.
- Put only the final prompt in the tool's prompt argument.
- Never claim that an image was already generated.

Original request:
${request}
`.trim();

const mcpCommandSystem = (toolName: string, request: string) =>
  `
The user explicitly invoked the MCP tool /${toolName}. Call the selected tool exactly once and use the following request to construct valid arguments for its input schema.

Requirements:
- Do not choose a different tool.
- Preserve the user's intent and supplied values.
- Do not invent required values that the user did not provide.
- After the tool returns, explain the result in the user's language.

Request:
${request}
`.trim();

const FILE_OUTPUT_SYSTEM = [
  "Downloadable file output:",
  "- When the user explicitly asks you to create, generate, or provide a downloadable text or code file, return the complete file content in a fenced code block.",
  '- Add filename metadata to the opening fence using this exact form: ```html filename="example.html".',
  "- Choose the correct fence language and a safe filename with the proper extension. For multiple files, use one complete fenced block per file.",
  "- Do not emit raw <a download> tags, data URLs, blob URLs, or base64 solely to create a download link. The chat UI creates the download locally.",
  "- Do not claim that a native binary file was generated. If a binary format is requested without a suitable tool, offer a text-based alternative such as CSV, Markdown, HTML, SVG, or JSON.",
].join("\n");

export async function POST(req: Request) {
  let body: {
    messages?: UIMessage[];
    system?: string;
    provider?: unknown;
    customUrl?: unknown;
    key?: unknown;
    model?: unknown;
    webSearch?: unknown;
    reasoningEffort?: unknown;
    imagePluginEnabled?: unknown;
    tools?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse("请求内容不是有效的 JSON。", 400);
  }

  const relay = resolveRelayTarget(body.provider, body.customUrl);
  if (!relay.ok) {
    return errorResponse(relay.error, 400);
  }

  const apiKey = normalizeApiKey(body.key);
  const model = normalizeModel(body.model);
  if (!apiKey || apiKey.length > 4096) {
    return errorResponse("请先填写 API Key。", 400);
  }
  if (!model || model.length > 256) {
    return errorResponse("请先选择模型。", 400);
  }
  if (!Array.isArray(body.messages)) {
    return errorResponse("消息格式无效。", 400);
  }

  const uploadedTools = body.tools ?? {};
  if (typeof uploadedTools !== "object" || uploadedTools === null || Array.isArray(uploadedTools)) {
    return errorResponse("工具格式无效。", 400);
  }

  if (Object.keys(uploadedTools).length > 64) {
    return errorResponse("单次请求最多可使用 64 个工具。", 400);
  }

  let uploadedToolBytes = 0;
  try {
    uploadedToolBytes = JSON.stringify(uploadedTools).length;
  } catch {
    return errorResponse("工具格式无效。", 400);
  }
  if (uploadedToolBytes > 200_000) {
    return errorResponse("工具定义过大。", 413);
  }

  const chatProtocol = usesChatCompletions(model);
  const openai = createOpenAI({
    baseURL: relay.apiBase,
    apiKey,
    fetch: async (url, init) => {
      const response = await relay.fetch(url, init);
      return chatProtocol ? response : repairResponsesStream(response);
    },
  });

  const webSearchEnabled = body.webSearch === true;
  const reasoningOptions = reasoningOptionsForModel(model, body.reasoningEffort);
  const imagePluginEnabled = body.imagePluginEnabled !== false;

  const enabledUploadedTools = { ...(uploadedTools as Record<string, unknown>) };
  if (!imagePluginEnabled) delete enabledUploadedTools[IMAGE_WORKSPACE_TOOL_NAME];

  let clientTools: ToolSet;
  try {
    clientTools = frontendTools(enabledUploadedTools as FrontendTools);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? `工具定义无效：${error.message}` : "工具定义无效。",
      400,
    );
  }

  const latestUserText = getLatestUserText(body.messages);
  const imageRequest = imagePluginEnabled ? parseImageCommand(latestUserText) : null;
  const hasImageCommand = imageRequest !== null;
  const hasImageRequest = typeof imageRequest === "string" && imageRequest.length > 0;
  const slashCommand = hasImageCommand ? null : parseSlashCommand(latestUserText);
  const mcpToolMatches = slashCommand
    ? Object.keys(enabledUploadedTools).filter(
        (toolName) =>
          toolName !== IMAGE_WORKSPACE_TOOL_NAME &&
          (toolName === slashCommand.name || toolName.endsWith(`__${slashCommand.name}`)),
      )
    : [];
  if (mcpToolMatches.length > 1) {
    return errorResponse(
      `有多个 MCP 服务提供同名工具“${slashCommand?.name}”，请停用重复服务后重试。`,
      409,
    );
  }
  const mcpToolName = mcpToolMatches[0] ?? null;
  const hasMcpCommand = mcpToolName !== null;
  const hasMcpRequest = hasMcpCommand && Boolean(slashCommand?.request);
  if (chatProtocol && webSearchEnabled && !hasImageCommand && !hasMcpCommand) {
    return errorResponse(
      "Gemini 当前使用 Chat Completions 接口，不支持此联网开关。请关闭联网后重试，或使用 MCP 搜索工具。",
      400,
    );
  }
  const imageTool: ToolSet = imagePluginEnabled ? frontendTools(IMAGE_TOOL_SCHEMA) : {};
  const tools: ToolSet = {
    ...clientTools,
    ...imageTool,
    ...(webSearchEnabled && !hasImageCommand && !hasMcpCommand
      ? {
          web_search: openai.tools.webSearch({
            searchContextSize: "high",
          }),
        }
      : {}),
  };
  const activeTools = hasImageRequest
    ? [IMAGE_WORKSPACE_TOOL_NAME]
    : hasMcpRequest && mcpToolName
      ? [mcpToolName]
      : hasImageCommand || hasMcpCommand
        ? []
        : Object.keys(tools).filter((toolName) => toolName !== IMAGE_WORKSPACE_TOOL_NAME);

  const commandSystem = hasImageRequest
    ? [body.system, imageCommandSystem(imageRequest)].filter(Boolean).join("\n\n")
    : hasImageCommand
      ? [
          body.system,
          "用户只输入了 /生图，没有提供画面内容。请简短提醒用户在命令后补充描述，不要调用任何工具。",
        ]
          .filter(Boolean)
          .join("\n\n")
      : hasMcpRequest && mcpToolName && slashCommand
        ? [body.system, mcpCommandSystem(slashCommand.name, slashCommand.request)]
            .filter(Boolean)
            .join("\n\n")
        : hasMcpCommand
          ? [
              body.system,
              `用户只输入了 MCP 命令 /${slashCommand?.name}，没有提供任务内容。请简短提醒用户在命令后补充需要该工具处理的内容，不要调用任何工具。`,
            ]
              .filter(Boolean)
              .join("\n\n")
          : body.system;
  const system = hasImageCommand
    ? commandSystem
    : [commandSystem, FILE_OUTPUT_SYSTEM].filter(Boolean).join("\n\n");

  const result = streamText({
    model: chatProtocol ? openai.chat(model) : openai.responses(model),
    messages: await convertToModelMessages(injectQuoteContext(body.messages), { tools }),
    system,
    tools,
    activeTools,
    providerOptions: {
      openai: {
        store: false,
        ...reasoningOptions,
      },
    },
    ...(hasImageRequest
      ? { toolChoice: { type: "tool" as const, toolName: IMAGE_WORKSPACE_TOOL_NAME } }
      : hasImageCommand
        ? { toolChoice: "none" as const }
        : hasMcpRequest && mcpToolName
          ? { toolChoice: { type: "tool" as const, toolName: mcpToolName } }
          : hasMcpCommand
            ? { toolChoice: "none" as const }
            : webSearchEnabled
              ? { toolChoice: { type: "tool" as const, toolName: "web_search" } }
              : {}),
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    sendSources: true,
    onError: chatErrorMessage,
  });
}
