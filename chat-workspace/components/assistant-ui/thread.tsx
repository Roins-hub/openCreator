import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { MessageTiming } from "@/components/assistant-ui/message-timing";
import {
  ComposerQuotePreview,
  QuoteBlock,
  SelectionToolbar,
} from "@/components/assistant-ui/quote";
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import { Sources } from "@/components/assistant-ui/sources";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ConnectionSettingsDialog } from "@/components/connection-settings-dialog";
import { useChatSettings } from "@/components/chat-settings";
import { usePluginSettings } from "@/components/plugin-settings";
import { ModelSelect } from "@/components/model-select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/browser-actions";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { useAuiState as useStoreAuiState } from "@assistant-ui/store";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrainCircuitIcon,
  CheckIcon,
  ChartNoAxesColumnIncreasingIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudSunIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  Globe2Icon,
  ImageIcon,
  LightbulbIcon,
  MicIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type CSSProperties,
  type FC,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { WORKSPACE_PLUGINS } from "@/lib/plugins";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_LABELS,
  reasoningEffortsForModel,
} from "@/lib/reasoning";

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading);

export const Thread: FC = () => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className={cn(
          "relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4",
          isEmpty && "justify-center",
        )}
      >
        <AuiIf condition={isNewChatView}>
          <ThreadWelcome />
        </AuiIf>

        <div data-slot="aui_message-group" className="mb-14 flex flex-col gap-y-6 empty:hidden">
          <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
        </div>

        <ThreadPrimitive.ViewportFooter
          className={cn(
            "aui-thread-viewport-footer bg-background mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible pb-4 md:pb-6",
            !isEmpty && "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
          )}
        >
          <ThreadScrollToBottom />
          <Composer />
          <AuiIf condition={isNewChatView}>
            <div className="aui-thread-welcome-suggestions-shell min-h-19">
              <AuiIf condition={(s) => s.composer.isEmpty}>
                <ThreadSuggestions />
              </AuiIf>
            </div>
          </AuiIf>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
      <SelectionToolbar />
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="滚动到底部"
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        今天我能帮你什么？
      </h1>
    </div>
  );
};

type SuggestionGroup = {
  label: string;
  icon: ReactNode;
  options: { label: string; prompt: string }[];
};

const SUGGESTION_GROUPS: SuggestionGroup[] = [
  {
    label: "天气",
    icon: <CloudSunIcon />,
    options: [
      { label: "查询今天的天气", prompt: "帮我查询今天的天气，并给出出行建议" },
      { label: "规划周末出行", prompt: "结合周末天气，帮我规划一个适合出行的安排" },
    ],
  },
  {
    label: "代码",
    icon: <Code2Icon />,
    options: [
      { label: "解释一段代码", prompt: "帮我解释这段代码的逻辑和潜在问题" },
      { label: "优化实现", prompt: "帮我分析并改进一段代码" },
    ],
  },
  {
    label: "写作",
    icon: <PenLineIcon />,
    options: [
      { label: "润色文字", prompt: "帮我润色和改写一段文字" },
      { label: "撰写说明", prompt: "根据我提供的信息，写一份清晰简洁的说明" },
    ],
  },
  {
    label: "分析",
    icon: <ChartNoAxesColumnIncreasingIcon />,
    options: [
      { label: "拆解问题", prompt: "帮我分析一个问题，列出关键因素和结论" },
      { label: "比较方案", prompt: "帮我比较几个方案的优缺点，并给出建议" },
    ],
  },
  {
    label: "头脑风暴",
    icon: <LightbulbIcon />,
    options: [
      { label: "扩展想法", prompt: "围绕我的想法进行头脑风暴" },
      { label: "列出创意", prompt: "围绕我给出的主题，提出五个可执行的创意" },
    ],
  },
];

const suggestionChipClass =
  "aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors [&_svg]:size-4";

const ThreadSuggestions: FC = () => {
  const aui = useAui();
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const expandedGroup = SUGGESTION_GROUPS.find((group) => group.label === expandedLabel);

  const sendPrompt = (prompt: string) => {
    if (aui.thread.getState().isRunning) return;
    aui.thread.append({
      content: [{ type: "text", text: prompt }],
      runConfig: aui.composer.getState().runConfig,
    });
  };

  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col gap-2 px-4">
      <div className="w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex w-max items-center gap-2">
          {SUGGESTION_GROUPS.map((group) => (
            <Button
              key={group.label}
              variant="ghost"
              className={cn(suggestionChipClass, group.label === expandedLabel && "bg-muted")}
              onClick={() => setExpandedLabel(group.label === expandedLabel ? null : group.label)}
            >
              {group.icon}
              {group.label}
            </Button>
          ))}
        </div>
      </div>
      {expandedGroup && (
        <div className="fade-in slide-in-from-top-1 animate-in w-full overflow-x-auto duration-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mx-auto flex w-max items-center gap-2">
            {expandedGroup.options.map((option) => (
              <Button
                key={option.label}
                variant="ghost"
                className={suggestionChipClass}
                onClick={() => sendPrompt(option.prompt)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

type SlashCommandItem = {
  id: string;
  command: string;
  label: string;
  description: string;
  source: "plugin" | "mcp";
  sourceLabel: string;
};

const useSlashCommands = (): SlashCommandItem[] => {
  const mcp = useStoreAuiState((s) => s.mcp);
  const plugins = usePluginSettings();
  const pluginCommands: SlashCommandItem[] = WORKSPACE_PLUGINS.filter((plugin) =>
    plugins.isEnabled(plugin.id),
  ).map((plugin) => ({
    id: plugin.id,
    command: plugin.command,
    label: plugin.name,
    description: plugin.description,
    source: "plugin",
    sourceLabel: "内置插件",
  }));
  const mcpCommands: SlashCommandItem[] = mcp.servers
    .filter((server) => server.connectionState === "connected")
    .flatMap((server) =>
      server.tools.map((tool) => ({
        id: `${server.id}__${tool.name}`,
        command: `/${tool.name}`,
        label: tool.name,
        description: tool.description?.trim() || "调用这个 MCP 工具",
        source: "mcp" as const,
        sourceLabel: server.name,
      })),
    );

  return [...pluginCommands, ...mcpCommands];
};

const CommandBadge: FC<{ item: SlashCommandItem }> = ({ item }) => (
  <span className="composer-command-badge">
    <span>{item.command}</span>
    {item.source === "mcp" ? <WrenchIcon aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
  </span>
);

const SelectedCommandChip: FC<{ item: SlashCommandItem }> = ({ item }) => (
  <span className="composer-command-badge">
    {item.source === "mcp" ? <WrenchIcon aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
    <span>{item.label}</span>
  </span>
);

const commandIconMarkup = (source: SlashCommandItem["source"]) =>
  source === "mcp"
    ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/><path d="m11 11 2 2"/></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );

const editableNodeLength = (node: Node): number => {
  if (node instanceof HTMLElement && node.dataset.commandToken) {
    return node.dataset.commandToken.length;
  }
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue?.length ?? 0;
  if (node instanceof HTMLBRElement) return 1;
  return Array.from(node.childNodes).reduce((total, child) => total + editableNodeLength(child), 0);
};

const editableText = (root: HTMLElement) => {
  const walk = (node: Node): string => {
    if (node instanceof HTMLElement && node.dataset.commandToken) {
      return node.dataset.commandToken;
    }
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
    if (node instanceof HTMLBRElement) return "\n";
    return Array.from(node.childNodes).map(walk).join("");
  };
  return walk(root);
};

const selectionTextOffset = (root: HTMLElement, node: Node, offset: number) => {
  let total = 0;
  let found = false;

  const walk = (current: Node): void => {
    if (found) return;
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) total += offset;
      else
        total += Array.from(current.childNodes)
          .slice(0, offset)
          .reduce((sum, child) => sum + editableNodeLength(child), 0);
      found = true;
      return;
    }
    if (current instanceof HTMLElement && current.dataset.commandToken) {
      total += current.dataset.commandToken.length;
      return;
    }
    for (const child of Array.from(current.childNodes)) walk(child);
  };

  walk(root);
  return found ? total : editableNodeLength(root);
};

const setEditableCaret = (root: HTMLElement, targetOffset: number) => {
  const selection = window.getSelection();
  if (!selection) return;

  let total = 0;
  let target: { node: Node; offset: number } | null = null;
  const walk = (current: Node): void => {
    if (target) return;
    if (current instanceof HTMLElement && current.dataset.commandToken) {
      const length = current.dataset.commandToken.length;
      if (targetOffset <= total)
        target = { node: root, offset: Array.from(root.childNodes).indexOf(current) };
      else if (targetOffset < total + length) {
        target = {
          node: root,
          offset:
            Array.from(root.childNodes).indexOf(current) +
            (targetOffset - total >= length / 2 ? 1 : 0),
        };
      }
      total += length;
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      const length = current.nodeValue?.length ?? 0;
      if (targetOffset <= total + length)
        target = { node: current, offset: Math.max(0, targetOffset - total) };
      total += length;
      return;
    }
    if (current instanceof HTMLBRElement) {
      if (targetOffset <= total)
        target = { node: root, offset: Array.from(root.childNodes).indexOf(current) };
      total += 1;
      return;
    }
    for (const child of Array.from(current.childNodes)) walk(child);
  };
  walk(root);
  target ??= { node: root, offset: root.childNodes.length };
  const range = document.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const renderEditableValue = (root: HTMLElement, value: string, item: SlashCommandItem | null) => {
  root.replaceChildren();
  if (!item || !value.startsWith(item.command)) {
    root.append(document.createTextNode(value));
    return;
  }

  const token = document.createElement("span");
  token.className = "composer-command-badge composer-command-token";
  token.contentEditable = "false";
  token.dataset.commandToken = item.command;
  token.dataset.label = item.label;
  token.setAttribute("aria-label", item.command);
  token.innerHTML = `<span class="sr-only">${escapeHtml(item.command)}</span>${commandIconMarkup(item.source)}`;
  root.append(token, document.createTextNode(value.slice(item.command.length)));
};

const ComposerEditableInput: FC<{
  value: string;
  commandItem: SlashCommandItem | null;
  disabled: boolean;
  onChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPaste: ClipboardEventHandler<HTMLDivElement>;
  inputRef: React.RefObject<HTMLDivElement | null>;
}> = ({ value, commandItem, disabled, onChange, onKeyDown, onPaste, inputRef }) => {
  useLayoutEffect(() => {
    const root = inputRef.current;
    if (!root || editableText(root) === value) return;
    const hadFocus = document.activeElement === root;
    renderEditableValue(root, value, commandItem);
    if (hadFocus) setEditableCaret(root, value.length);
  }, [commandItem, inputRef, value]);

  return (
    <div
      ref={inputRef}
      role="textbox"
      aria-label="消息输入框"
      aria-multiline="true"
      aria-placeholder="发个消息……"
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck
      tabIndex={disabled ? -1 : 0}
      className="aui-composer-input caret-primary relative z-10 max-h-32 min-h-10 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-2.5 py-1 text-base leading-6 outline-none placeholder:text-muted-foreground/80"
      data-placeholder="发个消息……"
      onInput={(event) => onChange(editableText(event.currentTarget))}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
};

const Composer: FC = () => {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const composerInput = unstable_useComposerInput();
  const inputRef = useRef<HTMLDivElement>(null);
  const isNewChat = useAuiState(isNewChatView);
  const allCommands = useSlashCommands();
  const [activeCommand, setActiveCommand] = useState(0);
  const [dismissedText, setDismissedText] = useState<string | null>(null);
  const commandMatch = text.match(/^\/([^\s]*)$/);
  const commandQuery = commandMatch?.[1] ?? null;
  const normalizedQuery = commandQuery?.toLocaleLowerCase() ?? null;
  const commands = allCommands.filter(
    (item) =>
      normalizedQuery !== null &&
      (item.command.slice(1).toLocaleLowerCase().includes(normalizedQuery) ||
        item.label.toLocaleLowerCase().includes(normalizedQuery)),
  );
  const visiblePluginCommands = commands.filter((item) => item.source === "plugin");
  const visibleMcpCommands = commands.filter((item) => item.source === "mcp");
  const leadingCommand = text.match(/^(\/[^\s]+)/)?.[1] ?? null;
  const highlightedCommand = allCommands.some((item) => item.command === leadingCommand)
    ? leadingCommand
    : null;
  const highlightedCommandItem = highlightedCommand
    ? (allCommands.find((item) => item.command === highlightedCommand) ?? null)
    : null;
  const menuOpen = commandQuery !== null && dismissedText !== text;

  useEffect(() => setActiveCommand(0), [commandQuery]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  const selectCommand = (command: string) => {
    const nextText = `${command} `;
    aui.composer.setText(nextText);
    setDismissedText(null);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      renderEditableValue(
        input,
        nextText,
        allCommands.find((item) => item.command === command) ?? null,
      );
      input.focus();
      setEditableCaret(input, nextText.length);
    });
  };

  const handleComposerKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (
      highlightedCommandItem &&
      !event.nativeEvent.isComposing &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      const selection = window.getSelection();
      if (!selection || !inputRef.current) return;
      const selectionStart = selectionTextOffset(
        inputRef.current,
        selection.anchorNode ?? inputRef.current,
        selection.anchorOffset,
      );
      const selectionEnd = selectionTextOffset(
        inputRef.current,
        selection.focusNode ?? inputRef.current,
        selection.focusOffset,
      );
      const rangeStart = Math.min(selectionStart, selectionEnd);
      const rangeEnd = Math.max(selectionStart, selectionEnd);
      const commandEnd = highlightedCommandItem.command.length;
      const suffixStart = text[commandEnd] === " " ? commandEnd + 1 : commandEnd;
      const deletionStart =
        rangeStart === rangeEnd && event.key === "Backspace"
          ? Math.max(0, rangeStart - 1)
          : rangeStart;
      const deletionEnd =
        rangeStart === rangeEnd && event.key === "Delete"
          ? Math.min(text.length, rangeEnd + 1)
          : rangeEnd;
      const deletesCommand = deletionStart < suffixStart && deletionEnd > 0;

      if (deletesCommand) {
        event.preventDefault();
        const nextText = text.slice(Math.max(suffixStart, deletionEnd));
        aui.composer.setText(nextText);
        setDismissedText(null);
        requestAnimationFrame(() => {
          const input = inputRef.current;
          if (!input) return;
          renderEditableValue(input, nextText, null);
          input.focus();
          setEditableCaret(input, 0);
        });
        return;
      }
    }

    if (event.key === "Escape") {
      if (menuOpen) {
        event.preventDefault();
        setDismissedText(text);
      } else if (aui.composer.getState().canCancel) {
        event.preventDefault();
        aui.composer.cancel();
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !menuOpen) {
      event.preventDefault();
      if (composerInput.canSend) composerInput.send();
      return;
    }

    if (!menuOpen) return;

    if (commands.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveCommand((current) => (current + 1) % commands.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveCommand((current) => (current - 1 + commands.length) % commands.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && !event.nativeEvent.isComposing) {
      event.preventDefault();
      selectCommand(commands[activeCommand]?.command ?? commands[0].command);
    }
  };

  const handlePaste: ClipboardEventHandler<HTMLDivElement> = async (event) => {
    const files = Array.from(event.clipboardData.files ?? []);
    if (!aui.thread.getState().capabilities.attachments || files.length === 0) return;
    event.preventDefault();
    await Promise.all(
      files.map(async (file) => {
        try {
          await aui.composer.addAttachment(file);
        } catch {
          // Attachment errors are emitted by the composer runtime.
        }
      }),
    );
  };

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      {menuOpen && (
        <div
          role="listbox"
          aria-label="斜杠命令"
          className={cn(
            "absolute right-0 bottom-full left-0 z-30 mb-2 flex flex-col overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-[0_16px_40px_color-mix(in_oklab,#000_18%,transparent)]",
            isNewChat
              ? "max-h-[min(16rem,calc(50dvh-4rem))]"
              : "max-h-[min(32rem,calc(100dvh-11rem))]",
          )}
        >
          <div className="flex shrink-0 items-center justify-between px-2.5 py-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">斜杠命令</span>
            <span className="text-[10px] text-muted-foreground">↑↓ 选择 · Enter 使用</span>
          </div>
          <div className="slash-command-scroll min-h-0 overflow-y-auto pr-1">
            {commands.length > 0 ? (
              <>
                {visiblePluginCommands.length > 0 && (
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-medium text-muted-foreground">
                    内置插件
                  </div>
                )}
                {visiblePluginCommands.map((item) => {
                  const index = commands.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={index === activeCommand}
                      onMouseEnter={() => setActiveCommand(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCommand(item.command)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-muted aria-selected:bg-muted"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-border">
                        <ImageIcon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <CommandBadge item={item} />
                          <span className="text-xs text-muted-foreground">{item.label}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}

                {visibleMcpCommands.length > 0 && (
                  <div className="mt-1 border-t px-2.5 pt-2.5 pb-1 text-[10px] font-medium text-muted-foreground">
                    MCP 工具
                  </div>
                )}
                {visibleMcpCommands.map((item) => {
                  const index = commands.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={index === activeCommand}
                      onMouseEnter={() => setActiveCommand(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCommand(item.command)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-muted aria-selected:bg-muted"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-border">
                        <WrenchIcon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <CommandBadge item={item} />
                          <span className="truncate text-xs text-muted-foreground">
                            {item.sourceLabel}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                没有匹配的插件或已连接 MCP 工具。
              </div>
            )}
          </div>
        </div>
      )}
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="aui_composer-shell"
          className="composer-shell border-border/60 data-[dragging=true]:border-ring focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] data-[dragging=true]:border-dashed dark:shadow-none"
        >
          <ComposerQuotePreview />
          <ComposerAttachments />
          <div className="relative">
            <ComposerEditableInput
              value={text}
              commandItem={highlightedCommandItem}
              disabled={composerInput.isDisabled}
              onChange={composerInput.setText}
              onKeyDown={handleComposerKeyDown}
              onPaste={handlePaste}
              inputRef={inputRef}
            />
          </div>
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const settings = useChatSettings();

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-1">
        <ComposerAddAttachment />
        {settings.models.length > 0 ? (
          <ModelSelect
            models={settings.models}
            value={settings.model}
            onValueChange={settings.setModel}
            compact
          />
        ) : (
          <ConnectionSettingsDialog
            trigger={
              <button
                type="button"
                className="model-button max-w-[190px] truncate px-2 py-1.5 text-sm font-medium"
              >
                {settings.model || "选择模型"}
                <ChevronDownIcon className="ml-1 inline size-3.5" />
              </button>
            }
          />
        )}
        <button
          type="button"
          onClick={() => settings.setWebSearch(!settings.webSearch)}
          className={cn(
            "web-search-button flex h-7 items-center gap-1.5 rounded-full px-2 text-xs",
            settings.webSearch && "web-search-active",
          )}
          aria-pressed={settings.webSearch}
          title="联网搜索"
        >
          <Globe2Icon className="size-3.5" />
          <span className="hidden sm:inline">联网</span>
          <span className="web-search-toggle" aria-hidden="true">
            <span />
          </span>
          <span className="sr-only">{settings.webSearch ? "已开启" : "已关闭"}</span>
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <ReasoningEffortControl />
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="语音输入"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate size-7 rounded-full"
                aria-label="开始语音输入"
              >
                <MicIcon className="aui-composer-dictate-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="停止语音输入"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
                aria-label="停止语音输入"
              >
                <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="发送消息"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-7 rounded-full"
              aria-label="发送消息"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-7 rounded-full"
              aria-label="停止生成"
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const ReasoningEffortControl: FC = () => {
  const settings = useChatSettings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const availableEfforts = reasoningEffortsForModel(settings.model);
  const effectiveEffort = availableEfforts.includes(settings.reasoningEffort)
    ? settings.reasoningEffort
    : (availableEfforts.at(-1) ?? DEFAULT_REASONING_EFFORT);
  const effortIndex = Math.max(0, availableEfforts.indexOf(effectiveEffort));
  const progress = availableEfforts.length > 1 ? effortIndex / (availableEfforts.length - 1) : 0;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (availableEfforts.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <TooltipIconButton
        tooltip={`思考强度：${REASONING_EFFORT_LABELS[effectiveEffort]}`}
        side="bottom"
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "reasoning-trigger flex h-7 w-auto items-center gap-1 rounded-full px-2 text-xs font-medium",
          open && "reasoning-trigger-active",
        )}
        aria-label={`思考强度：${REASONING_EFFORT_LABELS[effectiveEffort]}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <BrainCircuitIcon className="size-3.5" />
        <span>思考</span>
      </TooltipIconButton>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="设置思考强度"
          className="reasoning-panel fade-in zoom-in-95 animate-in absolute right-0 bottom-10 z-50 w-[min(15rem,calc(100vw-2rem))] duration-150"
        >
          <div className="reasoning-current-value">
            <span>{REASONING_EFFORT_LABELS[effectiveEffort]}</span>
            <ChevronRightIcon aria-hidden="true" />
          </div>
          <div
            className="reasoning-slider"
            style={{ "--reasoning-progress": progress } as CSSProperties}
          >
            <input
              className="reasoning-slider-input"
              type="range"
              min={0}
              max={availableEfforts.length - 1}
              step={1}
              value={effortIndex}
              aria-label="思考强度"
              aria-valuetext={REASONING_EFFORT_LABELS[effectiveEffort]}
              onChange={(event) => {
                const effort = availableEfforts[Number(event.currentTarget.value)];
                if (effort) settings.setReasoningEffort(effort);
              }}
            />
            <div className="reasoning-slider-visual" aria-hidden="true">
              <span className="reasoning-slider-fill" />
              {availableEfforts.map((effort, index) => (
                <span
                  key={effort}
                  className="reasoning-slider-node"
                  style={
                    {
                      "--reasoning-node-progress": index / (availableEfforts.length - 1),
                    } as CSSProperties
                  }
                />
              ))}
              <span className="reasoning-slider-thumb" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;
  const isRunning = useAuiState((s) => s.message.status?.type === "running");
  const isLast = useAuiState((s) => s.message.isLast);
  const isEmpty = useAuiState((s) => s.message.parts.length === 0);

  if (isRunning && !isLast && isEmpty) return null;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative mx-auto w-full max-w-(--thread-max-width) -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-2 leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-invocation", "group-reasoning"],
            source: ["group-source"],
            "tool-call": ["group-invocation", "group-tool"],
          })}
        >
          {({ part, children }) => {
            if (part.type === "group-invocation") {
              const isStreaming = part.status.type === "running";
              return (
                <ReasoningRoot streaming={isStreaming} variant="outline" className="my-3">
                  <ReasoningTrigger
                    active={isStreaming}
                    label="全部调用过程"
                    icon={<WrenchIcon className="size-4 shrink-0" aria-hidden="true" />}
                    className="max-w-full"
                  />
                  <ReasoningContent aria-busy={isStreaming}>
                    <div className="border-border/60 mt-1 border-t pt-2">{children}</div>
                  </ReasoningContent>
                </ReasoningRoot>
              );
            }
            if (part.type === "group-reasoning") {
              const isStreaming = part.status.type === "running";
              return (
                <ReasoningRoot streaming={isStreaming} variant="ghost">
                  <ReasoningTrigger active={isStreaming} />
                  <ReasoningContent aria-busy={isStreaming}>
                    <ReasoningText>{children}</ReasoningText>
                  </ReasoningContent>
                </ReasoningRoot>
              );
            }
            if (part.type === "group-source") {
              return (
                <div className="my-3">
                  <div className="text-muted-foreground mb-1.5 text-xs font-medium">
                    联网来源 · {part.indices.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">{children}</div>
                </div>
              );
            }
            if (part.type === "group-tool") {
              const isRunning = part.status.type === "running";
              return (
                <ToolGroupRoot variant="ghost" className="my-2">
                  <ToolGroupTrigger count={part.indices.length} active={isRunning} />
                  <ToolGroupContent>{children}</ToolGroupContent>
                </ToolGroupRoot>
              );
            }
            if (part.type === "text") {
              // Older builds rendered the loading dot as message content. Ignore it when
              // reopening a history entry so it cannot appear beside the new thinking state.
              if (
                part.text.trim() === "●" ||
                (part.text === "" && part.status?.type === "running")
              ) {
                return null;
              }
              return <MarkdownText />;
            }
            if (part.type === "reasoning") return <MarkdownText />;
            if (part.type === "source") return <Sources {...part} />;
            if (part.type === "tool-call") {
              if (!part.toolUI) return <ToolFallback {...part} />;
              const toolName = part.toolName.split("__").at(-1) ?? part.toolName;
              return (
                <div className="border-border/70 bg-muted/20 dark:bg-muted/10 my-2 overflow-hidden rounded-xl border shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_5%,transparent)]">
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <span className="border-border/70 bg-background flex size-8 shrink-0 items-center justify-center rounded-lg border shadow-xs">
                      <WrenchIcon className="text-muted-foreground size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="text-muted-foreground block text-[11px] font-medium">
                        插件工具
                      </span>
                      <span className="block truncate text-sm font-semibold">{toolName}</span>
                    </span>
                  </div>
                  <div className="border-border/60 border-t px-3.5 py-3">{part.toolUI}</div>
                </div>
              );
            }
            if (part.type === "indicator") return null;
            return null;
          }}
        </MessagePrimitive.GroupedParts>
        <AuiIf
          condition={(s) =>
            s.message.isLast && s.message.status?.type === "running" && s.message.parts.length === 0
          }
        >
          <span
            data-slot="aui_assistant-message-indicator"
            className="text-muted-foreground inline-flex items-center gap-2 align-middle"
            role="status"
            aria-label="助手正在连接"
          >
            <DotMatrix state="connecting" label="正在连接" />
            <span className="text-sm">正在连接</span>
          </span>
        </AuiIf>
        <MessageError />
      </div>

      <AuiIf condition={(s) => s.message.status?.type !== "running"}>
        <div
          data-slot="aui_assistant-message-footer"
          className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
        >
          <BranchPicker />
          <AssistantActionBar />
        </div>
      </AuiIf>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  const aui = useAui();
  const isCopied = useAuiState((s) => s.message.isCopied);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    const content = aui.message.getCopyText();
    if (!content) return;

    const copied = await copyTextToClipboard(content);
    setCopyFailed(!copied);
    aui.message.setIsCopied(copied);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = null;
      setCopyFailed(false);
      aui.message.setIsCopied(false);
    }, 3000);
  };

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
    >
      <TooltipIconButton
        tooltip={copyFailed ? "复制失败，请重试" : isCopied ? "已复制" : "复制"}
        onClick={handleCopy}
        className={copyFailed ? "text-destructive" : undefined}
      >
        {isCopied ? (
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        ) : (
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        )}
      </TooltipIconButton>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="重新生成">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <MessageTiming side="bottom" />
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip="更多" className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              导出为 Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  const allCommands = useSlashCommands();

  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Quote>{(quote) => <QuoteBlock {...quote} />}</MessagePrimitive.Quote>
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type !== "text") return null;
              const leadingCommand = part.text.match(/^(\/[^\s]+)/)?.[1] ?? null;
              if (!leadingCommand) return <span className="whitespace-pre-wrap">{part.text}</span>;

              const knownCommand = allCommands.find((item) => item.command === leadingCommand);
              const plugin = WORKSPACE_PLUGINS.find((item) => item.command === leadingCommand);
              const commandItem: SlashCommandItem = knownCommand ?? {
                id: leadingCommand,
                command: leadingCommand,
                label: leadingCommand.slice(1),
                description: "已发送的工具命令",
                source: plugin ? "plugin" : "mcp",
                sourceLabel: plugin ? "内置插件" : "MCP 工具",
              };
              const suffix = part.text.slice(leadingCommand.length).replace(/^\s+/, "");

              return (
                <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1">
                  <SelectedCommandChip item={commandItem} />
                  {suffix && <span className="min-w-0 whitespace-pre-wrap">{suffix}</span>}
                </span>
              );
            }}
          </MessagePrimitive.Parts>
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="编辑" className="aui-user-action-edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
              取消
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 rounded-full px-3.5">
              更新
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="上一个分支">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="下一个分支">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
