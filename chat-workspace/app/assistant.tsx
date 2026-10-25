"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  WebSpeechDictationAdapter,
  useRemoteThreadListRuntime,
  Tools,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AuiConfig } from "@assistant-ui/store";
import { McpLocalStorage, McpManagerResource, McpOAuthCallback } from "@assistant-ui/react-mcp";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { ChatCacheSync } from "@/components/chat-cache-sync";
import { Thread } from "@/components/assistant-ui/thread";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspaceHeader } from "@/components/workspace-header";
import { ChatSettingsProvider, useChatSettings } from "@/components/chat-settings";
import { PluginSettingsProvider, usePluginSettings } from "@/components/plugin-settings";
import { indexedDbThreadAdapter } from "@/lib/thread-adapter";
import { imageWorkspaceToolkit } from "@/components/image-workspace-tool";
import { IMAGE_WORKSPACE_TOOL_NAME } from "@/lib/image-workspace";
import { BASE_PATH, MIGRATE_URL, MOTE_MODE, withBasePath } from "@/lib/mote";
import {
  inlineMoteImages, MoteDocumentAttachmentAdapter, MoteImageAttachmentAdapter, openMoteSession,
} from "@/lib/mote-attachments";

// 工作台模式下文档(PDF 等)可以到 20 MB
const MAX_ATTACHMENT_BYTES = (MOTE_MODE ? 20 : 10) * 1024 * 1024;

// 工作台模式:图片和文档存到工作台的对象存储(附件页能看到),聊天记录里只存地址或文字;不收视频、音频
const baseAttachmentAdapter = new CompositeAttachmentAdapter(MOTE_MODE
  ? [new MoteImageAttachmentAdapter(), new MoteDocumentAttachmentAdapter()]
  : [new SimpleImageAttachmentAdapter(), new SimpleTextAttachmentAdapter()]);

const attachmentAdapter = {
  accept: baseAttachmentAdapter.accept,
  add: ({ file }: { file: File }) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`单个附件不能超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
    }
    return baseAttachmentAdapter.add({ file });
  },
  send: baseAttachmentAdapter.send.bind(baseAttachmentAdapter),
  remove: baseAttachmentAdapter.remove.bind(baseAttachmentAdapter),
};

const assistantConfig = AuiConfig({
  tools: Tools({ toolkit: imageWorkspaceToolkit }),
  mcp: McpManagerResource({
    connectors: [],
    storage: McpLocalStorage({ keyPrefix: "sub2-chat-mcp" }),
    // 挂在子路径下时授权回调也要带上前缀
    ...(BASE_PATH && typeof window !== "undefined"
      ? { oauthRedirectUri: `${window.location.origin}${BASE_PATH}/mcp/callback` }
      : {}),
    connectionTimeout: 15_000,
  }),
});

const shouldContinueAfterFrontendTool = ({ messages }: { messages: UIMessage[] }) => {
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false;
  const lastMessage = messages.at(-1);
  const usedImageWorkspace = lastMessage?.parts.some((part) => {
    if (part.type === `tool-${IMAGE_WORKSPACE_TOOL_NAME}`) return true;
    return "toolName" in part && part.toolName === IMAGE_WORKSPACE_TOOL_NAME;
  });
  return !usedImageWorkspace;
};

function ChatRuntime({ children }: { children: React.ReactNode }) {
  const { provider, customUrl, apiKey, model, webSearch, reasoningEffort } = useChatSettings();
  const plugins = usePluginSettings();
  const imagePluginEnabled = plugins.isEnabled("image-workspace");
  const [dictationAdapter, setDictationAdapter] = useState<WebSpeechDictationAdapter | undefined>(
    undefined,
  );

  // 直接打开 /chat 时补上看图用的登录 Cookie
  useEffect(() => {
    if (MOTE_MODE) void openMoteSession();
  }, [apiKey]);

  useEffect(() => {
    if (WebSpeechDictationAdapter.isSupported()) {
      setDictationAdapter(
        new WebSpeechDictationAdapter({
          language: "zh-CN",
          continuous: true,
          interimResults: true,
        }),
      );
    }
  }, []);

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: withBasePath("/api/chat"),
        prepareSendMessagesRequest: async (options) => ({
          body: {
            ...(options.body as Record<string, unknown> | undefined),
            id: options.id,
            messages: MOTE_MODE ? await inlineMoteImages(options.messages) : options.messages,
            trigger: options.trigger,
            messageId: options.messageId,
            metadata: options.requestMetadata,
            provider,
            customUrl,
            key: apiKey,
            model,
            webSearch,
            reasoningEffort,
            imagePluginEnabled,
          },
        }),
      }),
    [provider, customUrl, apiKey, model, webSearch, reasoningEffort, imagePluginEnabled],
  );

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        transport,
        sendAutomaticallyWhen: shouldContinueAfterFrontendTool,
        adapters: {
          attachments: attachmentAdapter,
          ...(dictationAdapter ? { dictation: dictationAdapter } : {}),
        },
      }),
    adapter: indexedDbThreadAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime} config={assistantConfig}>
      {MOTE_MODE && <ChatCacheSync />}
      {children}
    </AssistantRuntimeProvider>
  );
}

function Workspace() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="workspace-shell h-dvh overflow-hidden bg-background p-0 text-foreground md:p-5">
      <div className="workspace-frame mx-auto flex h-full max-w-[1720px] overflow-hidden">
        <WorkspaceSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
        />
        <div className="chat-panel-shell flex min-w-0 flex-1 flex-col overflow-hidden p-2 md:ps-0">
          {!MOTE_MODE && MIGRATE_URL && <MigrationNotice />}
          <main className="chat-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background">
            <WorkspaceHeader
              onOpenSidebar={() => setSidebarOpen(true)}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
            />
            <div className="min-h-0 flex-1">
              <Thread />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/** 旧站提示:聊天已经搬到工作台,导出记录后到新地址导入 */
function MigrationNotice() {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card px-3.5 py-2.5 text-sm">
      <strong className="font-medium">聊天已搬到工作台</strong>
      <span className="text-muted-foreground">
        和视频、图片在同一个网站，记录保存在服务器上、换设备也在。旧记录请先点左下角「导出」，再到新地址「导入」。
      </span>
      <a className="ms-auto font-medium underline underline-offset-4" href={MIGRATE_URL}>
        前往 {MIGRATE_URL.replace(/^https?:\/\//, "")}
      </a>
    </div>
  );
}

export function Assistant() {
  return (
    <ChatSettingsProvider>
      <PluginSettingsProvider>
        <ChatRuntime>
          <Workspace />
        </ChatRuntime>
      </PluginSettingsProvider>
    </ChatSettingsProvider>
  );
}

function McpCallbackContent() {
  const router = useRouter();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 text-foreground">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <McpOAuthCallback onComplete={() => router.replace("/")} onError={() => undefined}>
          {({ status, error }) => (
            <>
              <h1 className="text-base font-semibold">MCP 授权</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {status === "error"
                  ? "授权未完成，请返回聊天工作台检查服务配置。"
                  : status === "done"
                    ? "授权完成，正在返回聊天工作台。"
                    : "正在完成授权，请不要关闭此页面。"}
              </p>
              {error && (
                <p className="mt-4 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                  {error.message}
                </p>
              )}
              {status === "error" && (
                <button
                  type="button"
                  onClick={() => router.replace("/")}
                  className="mt-4 h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
                >
                  返回聊天工作台
                </button>
              )}
            </>
          )}
        </McpOAuthCallback>
      </div>
    </main>
  );
}

export function AssistantMcpOAuthCallback() {
  return (
    <ChatSettingsProvider>
      <PluginSettingsProvider>
        <ChatRuntime>
          <McpCallbackContent />
        </ChatRuntime>
      </PluginSettingsProvider>
    </ChatSettingsProvider>
  );
}
