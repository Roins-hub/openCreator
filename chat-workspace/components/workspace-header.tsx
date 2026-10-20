"use client";

import { Clapperboard, Home, ImageIcon, Menu, Moon, PanelLeft, Paperclip, Settings2, Sun } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { ConnectionSettingsDialog } from "@/components/connection-settings-dialog";
import { McpConfigDialog } from "@/components/assistant-ui/mcp-config";
import { PluginConfigDialog } from "@/components/plugin-config-dialog";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { BackToTop } from "@/components/assistant-ui/back-to-top";
import { useTheme } from "@/components/theme-provider";
import { getImageWorkspaceOrigin } from "@/lib/image-workspace";
import { HOME_URL } from "@/lib/home";
import { VIDEO_WORKSPACE_URL } from "@/lib/video-workspace";
import { MOTE_ATTACHMENTS, MOTE_HOME, MOTE_MODE } from "@/lib/mote";

type WorkspaceHeaderProps = {
  onOpenSidebar: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function WorkspaceHeader({
  onOpenSidebar,
  sidebarCollapsed,
  onToggleSidebar,
}: WorkspaceHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const threadTitle = useAuiState((state) => {
    const activeThread = state.threads.threadItems.find(
      (thread) => thread.id === state.threads.mainThreadId,
    );
    return activeThread?.title?.trim() || "新聊天";
  });

  return (
    <header className="workspace-header flex h-12 shrink-0 items-center gap-2 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <TooltipIconButton tooltip="打开会话列表" className="md:hidden" onClick={onOpenSidebar}>
          <Menu />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          side="bottom"
          onClick={onToggleSidebar}
          className="hidden size-8 md:flex"
        >
          <PanelLeft className="size-4" />
        </TooltipIconButton>
        <h1 className="truncate text-sm font-medium" title={threadTitle}>
          {threadTitle}
        </h1>
      </div>

      <nav className="ms-auto flex items-center gap-0.5" aria-label="工作台导航">
        {/* 顶栏右侧,和视频工作台的「回到顶部」同位置、同样式 */}
        <BackToTop />
        {MOTE_MODE ? (
          // 和视频、图片同一个网站:一个入口回工作台;主题在工作台设置里统一切换
          <>
            <TooltipIconButton tooltip="附件（聊天里上传的图片）" onClick={() => window.location.assign(MOTE_ATTACHMENTS)}>
              <Paperclip />
            </TooltipIconButton>
            <TooltipIconButton tooltip="视频 · 图片工作台" onClick={() => window.location.assign(MOTE_HOME)}>
              <Clapperboard />
            </TooltipIconButton>
          </>
        ) : (
          <>
            <TooltipIconButton
              tooltip="返回首页"
              onClick={() => window.location.assign(HOME_URL)}
            >
              <Home />
            </TooltipIconButton>
            <TooltipIconButton
              tooltip="生图工作台"
              onClick={() => window.location.assign(getImageWorkspaceOrigin())}
            >
              <ImageIcon />
            </TooltipIconButton>
            <TooltipIconButton
              tooltip="视频工作台"
              onClick={() => window.location.assign(VIDEO_WORKSPACE_URL)}
            >
              <Clapperboard />
            </TooltipIconButton>
            <TooltipIconButton
              tooltip={theme === "dark" ? "切换到浅色" : "切换到深色"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </TooltipIconButton>
          </>
        )}
        <PluginConfigDialog />
        <McpConfigDialog />
        <ConnectionSettingsDialog
          trigger={
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="连接设置"
              title="连接设置"
            >
              <Settings2 className="size-4" />
            </button>
          }
        />
      </nav>
    </header>
  );
}
