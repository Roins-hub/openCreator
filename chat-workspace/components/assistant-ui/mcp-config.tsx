"use client";

import { useMemo, useState, type ReactElement } from "react";
import {
  AlertTriangle,
  Blocks,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Plus,
  Plug,
  Power,
  PowerOff,
  Server,
  Trash2,
  Wrench,
} from "lucide-react";
import { useAui, useAuiState } from "@assistant-ui/store";
import {
  McpManagerPrimitive,
  McpServerPrimitive,
  type MCPAuthConfig,
  type MCPConnectionState,
  type MCPServerState,
} from "@assistant-ui/react-mcp";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUS: Record<MCPConnectionState, { label: string; className: string; icon: typeof Check }> =
  {
    disconnected: {
      label: "未连接",
      className: "bg-muted text-muted-foreground",
      icon: PowerOff,
    },
    authRequired: {
      label: "需要授权",
      className: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
      icon: CircleAlert,
    },
    authPending: {
      label: "等待授权",
      className: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
      icon: LoaderCircle,
    },
    connecting: {
      label: "连接中",
      className: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
      icon: LoaderCircle,
    },
    connected: {
      label: "已连接",
      className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
      icon: Check,
    },
    error: {
      label: "连接失败",
      className: "bg-destructive/10 text-destructive",
      icon: CircleAlert,
    },
  };

type AuthType = MCPAuthConfig["type"];

const inputClass =
  "h-10 rounded-xl bg-background px-3 shadow-none focus-visible:ring-2 focus-visible:ring-ring/20";

function StatusBadge({ state }: { state: MCPConnectionState }) {
  const meta = STATUS[state];
  const Icon = meta.icon;
  const pending = state === "connecting" || state === "authPending";

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        meta.className,
      )}
    >
      <Icon className={cn("size-3.5", pending && "animate-spin")} />
      {meta.label}
    </span>
  );
}

function ServerCard({ server }: { server: MCPServerState }) {
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <McpServerPrimitive.Root className="rounded-xl border bg-card p-3.5 text-card-foreground">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Server className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <McpServerPrimitive.Name className="max-w-full truncate text-sm font-medium" />
            <StatusBadge state={server.connectionState} />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={server.url}>
            {server.url}
          </p>
        </div>
      </div>

      <McpServerPrimitive.Error className="mt-3 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs leading-relaxed text-destructive" />

      {server.tools.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <button
            type="button"
            onClick={() => setToolsOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-3 text-xs text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Wrench className="size-3.5" /> 已发现 {server.tools.length} 个工具
            </span>
            {toolsOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {toolsOpen && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <McpServerPrimitive.Tools>
                {(tool) => (
                  <span
                    title={tool.description}
                    className="max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
                  >
                    {tool.name}
                  </span>
                )}
              </McpServerPrimitive.Tools>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
        <McpServerPrimitive.OAuthLink className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/80">
          前往授权 <ExternalLink className="size-3.5" />
        </McpServerPrimitive.OAuthLink>
        <McpServerPrimitive.ConnectButton className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/80">
          <Power className="size-3.5" /> 连接
        </McpServerPrimitive.ConnectButton>
        <McpServerPrimitive.DisconnectButton className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted">
          <PowerOff className="size-3.5" /> 断开
        </McpServerPrimitive.DisconnectButton>
        <McpServerPrimitive.RemoveButton
          onClick={(event) => {
            if (!window.confirm(`删除 MCP 服务“${server.name}”？`)) event.preventDefault();
          }}
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`删除 ${server.name}`}
          title="删除服务"
        >
          <Trash2 className="size-3.5" />
        </McpServerPrimitive.RemoveButton>
      </div>
    </McpServerPrimitive.Root>
  );
}

function AddServerForm({ onDone }: { onDone: () => void }) {
  const aui = useAui();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [token, setToken] = useState("");
  const [scopes, setScopes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedUrl = url.trim();

    if (!normalizedName) {
      setError("请填写服务名称。");
      return;
    }

    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
    } catch {
      setError("请填写有效的 HTTP 或 HTTPS MCP 地址。");
      return;
    }

    if (authType === "bearer" && !token.trim()) {
      setError("Bearer 认证需要填写 Token。");
      return;
    }

    const auth: MCPAuthConfig =
      authType === "bearer"
        ? { type: "bearer", token: token.trim() }
        : authType === "oauth"
          ? {
              type: "oauth",
              scopes: scopes
                .split(/[\s,]+/)
                .map((scope) => scope.trim())
                .filter(Boolean),
            }
          : { type: "none" };

    setSubmitting(true);
    setError(null);
    try {
      await aui.mcp.addCustomServer({ name: normalizedName, url: normalizedUrl, auth });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加失败，请检查服务地址后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border bg-muted/35 p-4">
      <div className="mb-4">
        <h3 className="text-sm font-medium">添加远程 MCP 服务</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          需要支持 Streamable HTTP，并允许此网站通过浏览器 CORS 访问。
        </p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-1.5 text-xs font-medium">
          <span>服务名称</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：知识库"
            className={inputClass}
            autoFocus
          />
        </label>
        <label className="block space-y-1.5 text-xs font-medium">
          <span>MCP 地址</span>
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/mcp"
            className={inputClass}
            inputMode="url"
          />
        </label>
        <label className="block space-y-1.5 text-xs font-medium">
          <span>认证方式</span>
          <select
            value={authType}
            onChange={(event) => setAuthType(event.target.value as AuthType)}
            className={cn(inputClass, "w-full border px-3 outline-none")}
          >
            <option value="none">无需认证</option>
            <option value="bearer">Bearer Token</option>
            <option value="oauth">OAuth</option>
          </select>
        </label>
        {authType === "bearer" && (
          <label className="block space-y-1.5 text-xs font-medium">
            <span>Bearer Token</span>
            <Input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="输入 MCP 服务令牌"
              type="password"
              autoComplete="off"
              className={inputClass}
            />
          </label>
        )}
        {authType === "oauth" && (
          <label className="block space-y-1.5 text-xs font-medium">
            <span>OAuth Scopes（可选）</span>
            <Input
              value={scopes}
              onChange={(event) => setScopes(event.target.value)}
              placeholder="read write"
              className={inputClass}
            />
          </label>
        )}
      </div>

      {error && (
        <div className="mt-3 flex gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle className="animate-spin" /> : <Plus />}
          {submitting ? "添加中" : "添加并连接"}
        </Button>
      </div>
    </form>
  );
}

function McpConfigContent() {
  const [adding, setAdding] = useState(false);
  const state = useAuiState((current) => current.mcp);
  const connectedCount = useMemo(
    () => state.servers.filter((server) => server.connectionState === "connected").length,
    [state.servers],
  );
  const toolCount = useMemo(
    () =>
      state.servers
        .filter((server) => server.connectionState === "connected")
        .reduce((total, server) => total + server.tools.length, 0),
    [state.servers],
  );

  return (
    <McpManagerPrimitive.Root className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border bg-card px-3.5 py-3">
          <p className="text-[11px] text-muted-foreground">已连接服务</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{connectedCount}</p>
        </div>
        <div className="rounded-xl border bg-card px-3.5 py-3">
          <p className="text-[11px] text-muted-foreground">可用工具</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{toolCount}</p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3.5 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          仅添加你信任的 MCP 服务。服务地址和认证令牌会明文保存在此浏览器的本地存储中，
          不会上传到本站服务器。
        </p>
      </div>

      {!state.isHydrated ? (
        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> 正在读取本地 MCP 配置
        </div>
      ) : state.customServers.length === 0 && !adding ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed px-5 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Plug className="size-4.5" />
          </div>
          <p className="mt-3 text-sm font-medium">还没有 MCP 服务</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            添加后，已连接服务提供的工具会自动出现在当前聊天模型的工具列表中。
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <McpManagerPrimitive.CustomServers>
            {({ server }) => <ServerCard server={server} />}
          </McpManagerPrimitive.CustomServers>
        </div>
      )}

      {adding ? (
        <AddServerForm onDone={() => setAdding(false)} />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
          onClick={() => setAdding(true)}
        >
          <Plus /> 添加 MCP 服务
        </Button>
      )}
    </McpManagerPrimitive.Root>
  );
}

export function McpConfigDialog({ trigger }: { trigger?: ReactElement }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          trigger ?? (
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="MCP 工具"
              title="MCP 工具"
            >
              <Blocks className="size-4" />
            </button>
          )
        }
      />
      <DialogContent className="settings-dialog max-h-[min(780px,calc(100dvh-2rem))] w-full overflow-y-auto p-0 sm:max-w-[600px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Blocks className="size-4.5" /> MCP 工具
          </DialogTitle>
          <DialogDescription>
            添加远程 MCP 服务，让模型在对话中按需调用其中的工具。
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-5">
          <McpConfigContent />
        </div>
      </DialogContent>
    </Dialog>
  );
}
