"use client";

import { useRef, useState, type MouseEvent } from "react";
import { ArrowUpRight, Clapperboard, Download, FileUp, MessageSquare, Paperclip, Trash2, X } from "lucide-react";
import {
  ThreadListItems,
  ThreadListNew,
  ThreadListRoot,
} from "@/components/assistant-ui/thread-list";
import { clearAllChatHistory, exportChatHistory, importChatHistory } from "@/lib/chat-storage";
import { MOTE_ATTACHMENTS, MOTE_HOME, MOTE_MODE } from "@/lib/mote";
import { cn } from "@/lib/utils";
import { HOME_URL } from "@/lib/home";

function HistoryTools() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const exportHistory = async () => {
    setBusy(true);
    try {
      const json = await exportChatHistory();
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sub2-chat-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const importHistory = async (file: File) => {
    setBusy(true);
    try {
      if (MOTE_MODE && !window.confirm("导入会替换当前账号里的全部聊天记录，确定继续吗？")) return;
      await importChatHistory(await file.text());
      location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const clearHistory = async () => {
    const scope = MOTE_MODE ? "当前账号" : "此浏览器";
    if (!window.confirm(`确定清空${scope}中的全部聊天记录吗？此操作无法撤销。`)) return;
    setBusy(true);
    try {
      await clearAllChatHistory();
      location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "清空失败");
      setBusy(false);
    }
  };

  return (
    <div className="sidebar-tools grid grid-cols-3 gap-1 p-2">
      <button className="history-tool" onClick={() => void exportHistory()} disabled={busy}>
        <Download /> 导出
      </button>
      <button className="history-tool" onClick={() => inputRef.current?.click()} disabled={busy}>
        <FileUp /> 导入
      </button>
      <button className="history-tool" onClick={() => void clearHistory()} disabled={busy}>
        <Trash2 /> 清空
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importHistory(file);
        }}
      />
    </div>
  );
}

type WorkspaceSidebarProps = {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
};

export function WorkspaceSidebar({ open, onClose, collapsed }: WorkspaceSidebarProps) {
  const closeMobileSidebarAfterNavigation = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    if (
      event.target.closest(
        '[data-slot="aui_thread-list-item-trigger"], [data-slot="aui_thread-list-new"]',
      )
    ) {
      onClose();
    }
  };

  return (
    <>
      {open && (
        <button
          className="fixed inset-0 z-30 bg-black/25 backdrop-blur-[1px] md:hidden"
          onClick={onClose}
          aria-label="关闭侧栏"
        />
      )}
      <aside
        className={cn(
          "workspace-sidebar fixed inset-y-0 start-0 z-40 flex w-65 shrink-0 flex-col overflow-hidden border-e transition-[width,transform] duration-200 md:relative md:z-0 md:translate-x-0",
          collapsed ? "md:w-12" : "md:w-65",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between px-2">
          <a
            href={MOTE_MODE ? MOTE_HOME : HOME_URL}
            className="flex min-w-0 items-center gap-2 overflow-hidden px-2 text-sm font-medium"
            title={MOTE_MODE ? "回到视频 · 图片工作台" : undefined}
          >
            <MessageSquare className="size-5 shrink-0" strokeWidth={2.15} />
            <span className="whitespace-nowrap text-foreground/90">{MOTE_MODE ? "TZ 聊天" : "SUB2 聊天"}</span>
          </a>
          <button
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
            onClick={onClose}
            aria-label="关闭侧栏"
          >
            <X className="size-4" />
          </button>
        </div>

        <ThreadListRoot
          className={cn(
            "relative min-h-0 flex-1 transition-[padding,width] duration-200",
            collapsed ? "md:w-12 md:overflow-hidden md:px-2 md:pt-1" : "w-65 overflow-y-auto p-3",
          )}
          onClick={closeMobileSidebarAfterNavigation}
        >
          <ThreadListNew
            className={cn(
              "overflow-hidden transition-all duration-200",
              collapsed
                ? "md:w-8 md:gap-0 md:px-2 md:has-[>svg]:px-2"
                : "w-full gap-2 px-2.5 has-[>svg]:px-2.5",
            )}
            labelClassName={cn(
              "overflow-hidden transition-all duration-200",
              collapsed ? "md:max-w-0 md:opacity-0" : "max-w-24 opacity-100",
            )}
            title={collapsed ? "新聊天" : undefined}
          />
          {MOTE_MODE && (
            // 附件管理:聊天里上传的图片和文档(和工作台的资产页同一套)
            <a
              href={MOTE_ATTACHMENTS}
              title={collapsed ? "附件" : "聊天里上传的图片和文档"}
              className={cn(
                "flex h-8 shrink-0 items-center overflow-hidden rounded-md text-sm text-foreground/90 transition-all duration-200 hover:bg-muted",
                collapsed ? "md:w-8 md:justify-center md:gap-0 md:px-2" : "w-full gap-2 px-2.5",
              )}
            >
              <Paperclip className="size-4 shrink-0" />
              <span className={cn(
                "overflow-hidden whitespace-nowrap transition-all duration-200",
                collapsed ? "md:max-w-0 md:opacity-0" : "max-w-24 opacity-100",
              )}>附件</span>
            </a>
          )}
          <ThreadListItems
            aria-hidden={collapsed}
            inert={collapsed}
            className={cn(
              "transition-[opacity,transform] duration-150",
              collapsed ? "md:pointer-events-none md:opacity-0" : "translate-x-0 opacity-100",
            )}
          />
        </ThreadListRoot>

        <div
          aria-hidden={collapsed}
          inert={collapsed}
          className={cn(
            "transition-opacity duration-150",
            collapsed && "md:pointer-events-none md:opacity-0",
          )}
        >
          {MOTE_MODE && (
            // 回工作台的入口:做成一张带边框的卡片,比底部的小工具按钮醒目
            <a
              href={MOTE_HOME}
              className="group mx-2 mb-1 mt-2 flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-foreground/25 hover:shadow-md"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                <Clapperboard className="size-[18px]" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold text-foreground">视频 · 图片工作台</span>
                <span className="truncate text-xs text-muted-foreground">去生成图片和视频</span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
          )}
          <HistoryTools />
        </div>
      </aside>
    </>
  );
}
