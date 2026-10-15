"use client";

import { ImageIcon, Puzzle, TerminalSquare } from "lucide-react";
import type { ReactElement } from "react";
import { usePluginSettings } from "@/components/plugin-settings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WORKSPACE_PLUGINS } from "@/lib/plugins";

function PluginConfigContent() {
  const plugins = usePluginSettings();
  const enabledCount = WORKSPACE_PLUGINS.filter((plugin) => plugins.isEnabled(plugin.id)).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border bg-card px-3.5 py-3">
          <p className="text-[11px] text-muted-foreground">内置插件</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{WORKSPACE_PLUGINS.length}</p>
        </div>
        <div className="rounded-xl border bg-card px-3.5 py-3">
          <p className="text-[11px] text-muted-foreground">已启用</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{enabledCount}</p>
        </div>
      </div>

      <div className="space-y-2.5">
        {WORKSPACE_PLUGINS.map((plugin) => {
          const enabled = plugins.isEnabled(plugin.id);

          return (
            <section
              key={plugin.id}
              className="rounded-xl border bg-card p-3.5 text-card-foreground"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <ImageIcon className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">{plugin.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {enabled ? "已在当前浏览器启用" : "已停用"}
                      </p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <span className="sr-only">
                        {enabled ? "停用" : "启用"}
                        {plugin.name}
                      </span>
                      <input
                        type="checkbox"
                        className="switch-control"
                        checked={enabled}
                        onChange={(event) => plugins.setEnabled(plugin.id, event.target.checked)}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {plugin.description}
              </p>
              <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-[auto_1fr] sm:items-center">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
                  <TerminalSquare className="size-3.5" /> {plugin.command}
                </span>
                <p className="truncate text-xs text-muted-foreground" title={plugin.usage}>
                  示例：{plugin.usage}
                </p>
              </div>
            </section>
          );
        })}
      </div>

      <p className="rounded-xl border border-dashed px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        这里只管理本站审核过的内置插件，不支持添加未知第三方插件。MCP 服务请在“MCP
        工具”面板中单独管理。
      </p>
    </div>
  );
}

export function PluginConfigDialog({ trigger }: { trigger?: ReactElement }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          trigger ?? (
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="插件管理"
              title="插件管理"
            >
              <Puzzle className="size-4" />
            </button>
          )
        }
      />
      <DialogContent className="settings-dialog max-h-[min(780px,calc(100dvh-2rem))] w-full overflow-y-auto p-0 sm:max-w-[600px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Puzzle className="size-4.5" /> 插件管理
          </DialogTitle>
          <DialogDescription>
            启用或停用聊天工作台的内置能力。输入“/”可以查看已启用插件的命令。
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-5">
          <PluginConfigContent />
        </div>
      </DialogContent>
    </Dialog>
  );
}
