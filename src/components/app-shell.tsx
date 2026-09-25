"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp, AtSign, BookOpen, ChevronDown, ImagePlus, Images, Menu,
  PanelLeftClose, Plus, Search as SearchIcon, Settings, Square, X,
} from "lucide-react";
import type { AppConfig, Conversation, ImageOptions, MediaRef, Message, ModelConfig, VideoOptions } from "@/lib/types";
import type { Asset } from "@/lib/asset-store";
import { createClientId } from "@/lib/client-id";
import { GenerationStatus } from "@/components/generation-status";
import { ImageControls, VideoControls } from "@/components/generation-controls";
import { HistoryMenu } from "@/components/history-menu";
import { ConversationNavigator } from "@/components/conversation-navigator";
import { EmptyStatePrompt } from "@/components/empty-state-prompt";
import { pickImageFiles } from "@/lib/image-files";
import { validateReferenceCount } from "@/lib/reference-images";
import { unfinishedTaskIds } from "@/lib/generation-stop";
import { ConversationSearch } from "@/components/conversation-search";
import {
  REFERENCE_CARD_CLASS, createReferenceCard, referenceLabel, serializePrompt, splitPromptReferences,
} from "@/lib/prompt-references";
import { VideoTaskCard } from "@/components/video-task-card";
import { LogoMark } from "@/components/logo-mark";

type PublicConfig = AppConfig & { providers: Array<AppConfig["providers"][number] & { hasApiKey?: boolean }> };
type ModelChoice = { providerId: string; providerName: string; model: ModelConfig };

const videoDefaults: VideoOptions = {
  referenceMode: "text", ratio: "adaptive", resolution: "720p", duration: 5,
  count: 1, audio: true, watermark: false, cameraFixed: false,
};
const imageDefaults: ImageOptions = { ratio: "adaptive", resolution: "2K", count: 1 };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function freshConversation(choice?: ModelChoice): Conversation {
  const now = new Date().toISOString();
  return {
    id: createClientId(), title: "新对话",
    providerId: choice?.providerId, modelId: choice?.model.id,
    createdAt: now, updatedAt: now,
    imageOptions: imageDefaults, videoOptions: videoDefaults, messages: [],
  };
}

export function AppShell() {
  const [config, setConfig] = useState<PublicConfig>({ providers: [] });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MediaRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [draggingImages, setDraggingImages] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [referenceQuery, setReferenceQuery] = useState("");
  const [referencePickerPosition, setReferencePickerPosition] = useState({ left: 10, top: 8 });
  const referenceRangeRef = useRef<Range | null>(null);
  const referenceAnchorRef = useRef<DOMRect | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const generationControllerRef = useRef<AbortController | null>(null);

  const choices = useMemo<ModelChoice[]>(() => config.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.id, providerName: provider.name, model,
    }))), [config]);
  const active = conversations.find((item) => item.id === activeId);
  const selected = choices.find((item) =>
    item.providerId === active?.providerId && item.model.id === active?.modelId) || choices[0];
  // 对话模型仅在支持图片输入时才允许附件(并受其参考图上限约束);图像/视频模型沿用各自约束。
  const uploadLimit = selected?.model.type === "chat"
    ? (selected.model.supportsImageInput ? selected.model.maxReferenceImages : 0)
    : (selected?.model.maxReferenceImages ?? 8);
  const processingMessage = active?.messages.find((message) => message.status === "processing");
  const isGenerating = busy || Boolean(processingMessage);

  const load = useCallback(async () => {
    const [nextConfig, nextConversations, nextFavorites] = await Promise.all([
      request<PublicConfig>("/api/config"),
      request<Conversation[]>("/api/conversations"),
      request<string[]>("/api/favorites").catch(() => []),
    ]);
    setConfig(nextConfig);
    setFavorites(new Set(nextFavorites));
    setConversations(nextConversations);
    if (nextConversations.length) {
      const requested = typeof window === "undefined" ? null :
        new URLSearchParams(window.location.search).get("conversation");
      setActiveId((id) =>
        requested && nextConversations.some((item) => item.id === requested)
          ? requested : id || nextConversations[0].id);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load().catch((cause) => setError(cause.message)), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    const timer = window.setTimeout(() => setSidebarOpen(false), 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [active?.messages.length]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const paths = attachments.map((item) => item.path);
    let changed = false;
    editor.querySelectorAll<HTMLElement>(`.${REFERENCE_CARD_CLASS}`).forEach((card) => {
      const index = paths.indexOf(card.dataset.path || "");
      if (index < 0) {
        card.remove();
        changed = true;
      } else {
        card.dataset.label = referenceLabel(index);
      }
    });
    if (changed) setDraft(editor.innerText);
  }, [attachments]);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.style.height = "auto";
    editor.style.height = `${Math.min(Math.max(editor.scrollHeight, 42), 156)}px`;
  }, [draft]);

  const persist = async (conversation: Conversation) => {
    const saved = await request<Conversation>(`/api/conversations/${conversation.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conversation),
    }).catch(async () => request<Conversation>("/api/conversations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conversation),
    }));
    setConversations((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    return saved;
  };

  const closeSidebarOnMobile = () => {
    if (window.matchMedia("(max-width: 700px)").matches) setSidebarOpen(false);
  };

  const positionReferencePicker = useCallback(() => {
    const editor = editorRef.current;
    const composer = composerRef.current;
    if (!editor || !composer) return;
    const editorRect = editor.getBoundingClientRect();
    const savedAnchor = referenceAnchorRef.current;
    const markerRect = savedAnchor && (savedAnchor.width || savedAnchor.height || savedAnchor.top || savedAnchor.left)
      ? savedAnchor : editorRect;
    const lineHeight = Number.parseFloat(window.getComputedStyle(editor).lineHeight) || 23;
    const pickerWidth = Math.min(430, window.innerWidth - 32);
    const left = Math.max(8, Math.min(markerRect.left - 14, window.innerWidth - pickerWidth - 8));
    const pickerHeight = 300;
    const top = markerRect.top > pickerHeight + 12
      ? markerRect.top - pickerHeight - 8
      : Math.min(markerRect.bottom + lineHeight + 8, window.innerHeight - pickerHeight - 8);
    setReferencePickerPosition({ left, top });
  }, []);

  const captureReferenceAnchor = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    referenceRangeRef.current = range;
    const rangeRect = range?.getBoundingClientRect();
    referenceAnchorRef.current = rangeRect && (rangeRect.width || rangeRect.height || rangeRect.top || rangeRect.left)
      ? rangeRect : editor?.getBoundingClientRect() || null;
  };

  useLayoutEffect(() => {
    if (!referencePickerOpen) return;
    const frame = window.requestAnimationFrame(positionReferencePicker);
    return () => window.cancelAnimationFrame(frame);
  }, [draft, referencePickerOpen, positionReferencePicker]);

  const openReferencePicker = async () => {
    if (uploadLimit === 0) return;
    if (referencePickerOpen) {
      referenceRangeRef.current = null;
      referenceAnchorRef.current = null;
      setReferencePickerOpen(false);
      return;
    }
    try {
      const assets = await request<Asset[]>("/api/assets");
      const currentAssets: Asset[] = attachments.map((item) => ({
        id: `current:${item.path}`,
        kind: item.kind,
        path: item.path,
        name: item.name,
        mimeType: item.mimeType || (item.kind === "video" ? "video/mp4" : "image/jpeg"),
        size: 0,
        modifiedAt: new Date().toISOString(),
      }));
      // 目前所有供应商都只接受图片参考,视频素材不进入选择器。
      const merged = [...currentAssets, ...assets.filter((asset) => !asset.trashed)]
        .filter((asset) => asset.kind === "image");
      setReferenceAssets(merged.filter((asset, index, list) =>
        list.findIndex((candidate) => candidate.path === asset.path) === index));
      setReferenceQuery("");
      setReferencePickerOpen(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const selectReferenceAsset = (asset: Asset) => {
    if (uploadLimit === 0 || asset.kind !== "image") return;
    const alreadyAttached = attachments.some((item) => item.path === asset.path);
    if (!alreadyAttached && attachments.length >= uploadLimit) {
      setError(`最多选择 ${uploadLimit} 个参考素材`);
      return;
    }
    const nextAttachments = alreadyAttached ? attachments : [...attachments, {
      kind: asset.kind, path: asset.path, name: asset.name, mimeType: asset.mimeType,
    }];
    setAttachments(nextAttachments);
    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      const selection = window.getSelection();
      const range = referenceRangeRef.current || document.createRange();
      if (!referenceRangeRef.current) {
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      selection?.removeAllRanges();
      selection?.addRange(range);
      const card = createReferenceCard(
        asset.path, asset.name, nextAttachments.findIndex((item) => item.path === asset.path),
      );
      range.deleteContents();
      range.insertNode(card);
      const spacer = document.createTextNode(" ");
      card.after(spacer);
      range.setStartAfter(spacer);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      setDraft(editor.innerText);
    }
    referenceRangeRef.current = null;
    referenceAnchorRef.current = null;
    setReferencePickerOpen(false);
  };

  const create = async () => {
    const conversation = freshConversation(choices[0]);
    await persist(conversation);
    setActiveId(conversation.id);
    setDraft("");
    setAttachments([]);
    if (editorRef.current) editorRef.current.innerHTML = "";
    closeSidebarOnMobile();
  };

  const remove = async (id: string) => {
    await request(`/api/conversations/${id}`, { method: "DELETE" });
    const rest = conversations.filter((item) => item.id !== id);
    setConversations(rest);
    if (activeId === id) setActiveId(rest[0]?.id);
  };

  const rename = async (conversation: Conversation, title: string) => {
    await persist({ ...conversation, title, updatedAt: new Date().toISOString() });
  };

  const chooseModel = async (value: string) => {
    const [providerId, modelId] = value.split("::");
    const choice = choices.find((item) => item.providerId === providerId && item.model.id === modelId);
    if (!choice) return;
    if (!active) {
      const conversation = freshConversation(choice);
      await persist(conversation);
      setActiveId(conversation.id);
      return;
    }
    await persist({ ...active, providerId, modelId, updatedAt: new Date().toISOString() });
  };

  const changeGenerationOptions = (options: { imageOptions?: ImageOptions; videoOptions?: VideoOptions }) => {
    if (!active) {
      const conversation = { ...freshConversation(selected), ...options };
      setConversations((items) => [conversation, ...items]);
      setActiveId(conversation.id);
      void persist(conversation).catch((cause) => setError(cause.message));
      return;
    }
    const updated = { ...active, ...options, updatedAt: new Date().toISOString() };
    setConversations((items) => items.map((item) => item.id === updated.id ? updated : item));
    void request<Conversation>(`/api/conversations/${updated.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    }).catch((cause) => setError(cause.message));
  };

  const upload = async (files: readonly File[]) => {
    const selection = pickImageFiles(files, uploadLimit, attachments.length);
    if (selection.error) setError(selection.error);
    else setError("");
    if (!selection.accepted.length) return;
    const form = new FormData();
    selection.accepted.forEach((file) => form.append("files", file));
    try {
      const uploaded = await request<MediaRef[]>("/api/uploads", {
        method: "POST", body: form,
      });
      setAttachments((items) => [...items, ...uploaded].slice(0, uploadLimit));
    } catch (cause) { setError((cause as Error).message); }
  };

  const pastedImages = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    void upload(files);
  };

  const send = () => {
    if (isGenerating || !selected || (!draft.trim() && !attachments.length)) return;
    const prompt = editorRef.current
      ? serializePrompt(editorRef.current, attachments.map((item) => item.path))
      : draft.trim();
    return submit(prompt, attachments, { clearComposer: true });
  };

  const submit = async (
    prompt: string, usedAttachments: MediaRef[],
    { clearComposer, videoOptions }: { clearComposer: boolean; videoOptions?: VideoOptions },
  ) => {
    if (isGenerating || !selected) return;
    const currentVideoOptions = videoOptions || active?.videoOptions || videoDefaults;
    if (selected.model.type === "video") {
      try {
        validateReferenceCount(
          currentVideoOptions.referenceMode, usedAttachments.length, selected.model.maxReferenceImages,
        );
      } catch (cause) {
        setError((cause as Error).message);
        return;
      }
    }
    setBusy(true);
    setError("");
    const controller = new AbortController();
    generationControllerRef.current = controller;
    let pendingMessageId: string | undefined;
    try {
      let conversation = active || freshConversation(selected);
      const now = new Date().toISOString();
      const user: Message = {
        id: createClientId(), role: "user", content: prompt,
        attachments: usedAttachments, createdAt: now, status: "complete",
      };
      conversation = {
        ...conversation,
        title: conversation.messages.length ? conversation.title :
          (prompt || "图片生成").slice(0, 28),
        providerId: selected.providerId, modelId: selected.model.id,
        updatedAt: now, messages: [...conversation.messages, user],
      };
      await persist(conversation);
      setActiveId(conversation.id);
      if (clearComposer) {
        setDraft("");
        setAttachments([]);
        if (editorRef.current) editorRef.current.innerHTML = "";
      }
      if (selected.model.type !== "chat") {
        pendingMessageId = `pending-${createClientId()}`;
        const pendingMessage: Message = {
          id: pendingMessageId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "processing",
          generation: {
            type: selected.model.type, providerName: selected.providerName,
            modelName: selected.model.name, modelId: selected.model.modelId,
            ...(selected.model.type === "video" ? { videoOptions: currentVideoOptions } : {}),
          },
        };
        const optimistic = {
          ...conversation,
          messages: [...conversation.messages, pendingMessage],
        };
        setConversations((items) => [
          optimistic,
          ...items.filter((item) => item.id !== optimistic.id),
        ]);
      }
      const result = await request<{ conversation: Conversation }>("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: conversation.id, providerId: selected.providerId,
          modelId: selected.model.id, prompt, attachments: usedAttachments,
          imageOptions: conversation.imageOptions || imageDefaults,
          videoOptions: currentVideoOptions,
        }),
      });
      if (controller.signal.aborted) return;
      setConversations((items) => [result.conversation, ...items.filter((item) => item.id !== result.conversation.id)]);
    } catch (cause) {
      if (controller.signal.aborted || (cause as Error).name === "AbortError") return;
      const message = (cause as Error).message;
      setError(message);
      if (pendingMessageId) {
        setConversations((items) => items.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((item) =>
            item.id === pendingMessageId ? { ...item, status: "failed", error: message } : item),
        })));
      }
    }
    finally {
      if (generationControllerRef.current === controller) generationControllerRef.current = null;
      setBusy(false);
    }
  };

  const updateActiveMessages = (update: (messages: Message[]) => Message[]) => {
    if (!active) return;
    const updated = { ...active, messages: update(active.messages), updatedAt: new Date().toISOString() };
    setConversations((items) => items.map((item) => item.id === updated.id ? updated : item));
    void persist(updated).catch((cause) => setError(cause.message));
  };

  const toggleFavorite = async (paths: string[], favorite: boolean) => {
    if (!paths.length) return;
    try {
      const next = await request<string[]>("/api/favorites", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths, favorite }),
      });
      setFavorites(new Set(next));
    } catch (cause) { setError((cause as Error).message); }
  };

  const deleteTurn = (messageId: string, userMessageId?: string) => updateActiveMessages((messages) =>
    messages.filter((item) => item.id !== messageId && item.id !== userMessageId));

  const reedit = (prompt: string, references: MediaRef[], videoOptions?: VideoOptions) => {
    const editor = editorRef.current;
    if (!editor) return;
    setAttachments(references);
    editor.innerHTML = "";
    for (const segment of splitPromptReferences(prompt)) {
      const ref = segment.kind === "reference" ? references[segment.index] : undefined;
      if (segment.kind === "text") editor.append(document.createTextNode(segment.text));
      else if (ref) editor.append(createReferenceCard(ref.path, ref.name, segment.index));
    }
    setDraft(editor.innerText);
    if (videoOptions && selected?.model.type === "video") changeGenerationOptions({ videoOptions });
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const stop = async () => {
    generationControllerRef.current?.abort();
    generationControllerRef.current = null;
    setBusy(false);
    setError("");
    if (!active) return;

    const pending = active.messages.find((message) => message.status === "processing");
    const taskIds = pending ? unfinishedTaskIds(pending) : [];
    if (taskIds.length) {
      let stoppedConversation = active;
      for (const taskId of taskIds) {
        try {
          const result = await request<{ conversation: Conversation }>(
            `/api/tasks/${taskId}?conversationId=${active.id}`,
            { method: "DELETE" },
          );
          stoppedConversation = result.conversation;
        } catch {
          stoppedConversation = {
            ...stoppedConversation,
            updatedAt: new Date().toISOString(),
            messages: stoppedConversation.messages.map((message) =>
              message.id === pending?.id ? {
                ...message,
                status: "stopped",
                error: "已停止等待，云端任务可能仍在生成",
              } : message),
          };
        }
      }
      setConversations((items) => [
        stoppedConversation,
        ...items.filter((item) => item.id !== stoppedConversation.id),
      ]);
      return;
    }

    const now = new Date().toISOString();
    const stoppedConversation: Conversation = {
      ...active,
      updatedAt: now,
      messages: pending
        ? active.messages.map((message) => message.id === pending.id
          ? { ...message, status: "stopped" as const, error: "已停止生成" }
          : message)
        : [...active.messages, {
          id: createClientId(), role: "assistant", content: "",
          createdAt: now, status: "stopped", error: "已停止生成",
        }],
    };
    setConversations((items) => [
      stoppedConversation,
      ...items.filter((item) => item.id !== stoppedConversation.id),
    ]);
    try {
      await request<Conversation>(`/api/conversations/${stoppedConversation.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stoppedConversation),
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  useEffect(() => {
    const pending = active?.messages.find((message) =>
      message.status === "processing" && (message.taskIds?.length || message.taskId));
    if (!pending || !active) return;
    const taskId = pending.taskIds?.find((id) =>
      !pending.completedTaskIds?.includes(id) && !pending.failedTaskIds?.includes(id)) || pending.taskId;
    if (!taskId) return;
    const timer = window.setTimeout(async () => {
      try {
        const result = await request<{ conversation: Conversation }>(
          `/api/tasks/${taskId}?conversationId=${active.id}`,
        );
        setConversations((items) => [result.conversation, ...items.filter((item) => item.id !== active.id)]);
      } catch (cause) { setError((cause as Error).message); }
    }, 5000);
    return () => clearTimeout(timer);
  }, [active]);

  return (
    <main className="app-frame">
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-head">
          <button className="wordmark" onClick={create} aria-label="新建对话"><LogoMark size={27} /> Mote</button>
          <div className="sidebar-head-actions">
            <button className="icon-button" onClick={() => setSearchOpen(true)}
              aria-label="搜索对话" title="搜索对话 · ⌘ K">
              <SearchIcon size={17} />
            </button>
            <button className="icon-button desktop-only" onClick={() => setSidebarOpen(false)} aria-label="收起侧栏">
              <PanelLeftClose size={17} />
            </button>
          </div>
        </div>
        <button className="new-chat" onClick={create}><Plus size={16} /> 新对话</button>
        <Link className="asset-link" href="/assets"><Images size={16} /> 资产</Link>
        <div className="history-label">最近</div>
        <nav className="history">
          {conversations.map((conversation) => (
            <div key={conversation.id}
              className={`history-row ${conversation.id === activeId ? "active" : ""}`}>
              <button className="history-title"
                onClick={() => { setActiveId(conversation.id); closeSidebarOnMobile(); }}>
                {conversation.title}
              </button>
              <HistoryMenu title={conversation.title}
                onRename={(title) => void rename(conversation, title)}
                onDelete={() => void remove(conversation.id)} />
            </div>
          ))}
        </nav>
        <div className="sidebar-utilities">
          <Link className="settings-link" href="/docs"><BookOpen size={16} /> 文档</Link>
          <Link className="settings-link" href="/settings"><Settings size={16} /> 设置</Link>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" />}

      <section className="workspace">
        <header className="topbar">
          {!sidebarOpen && <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏">
            <Menu size={18} />
          </button>}
          <div className="model-select-wrap">
            <select value={selected ? `${selected.providerId}::${selected.model.id}` : ""}
              onChange={(event) => chooseModel(event.target.value)} aria-label="选择模型">
              {!choices.length && <option value="">尚未配置模型</option>}
              {choices.map((choice) => (
                <option key={`${choice.providerId}:${choice.model.id}`}
                  value={`${choice.providerId}::${choice.model.id}`}>
                  {choice.model.name} · {choice.providerName}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <span className={`capability ${selected?.model.type || ""}`}>
            {selected?.model.type === "video" ? "视频" : selected?.model.type === "image" ? "图像" : "对话"}
          </span>
        </header>

        <div className="conversation" ref={conversationRef}>
          {!active?.messages.length ? (
            <div className="empty-state">
              <LogoMark size={44} className="empty-mark" />
              <h1>今天，想创造什么？</h1>
              {choices.length && selected
                ? <EmptyStatePrompt key={selected.model.type} type={selected.model.type} />
                : <p>先添加一个供应商和模型，然后开始。</p>}
              {!choices.length && <Link className="text-link" href="/settings">前往设置 <span>↗</span></Link>}
            </div>
          ) : (
            <div className="message-list">
              {(() => {
                let lastDate = "";
                return active.messages.map((message, index) => {
                  const next = active.messages[index + 1];
                  if (message.role === "user" && next && isVideoTurn(next, selected?.model.type)) return null;
                  if (!isVideoTurn(message, selected?.model.type)) {
                    return <MessageView key={message.id} message={message} processingType={selected?.model.type} />;
                  }
                  const previous = active.messages[index - 1];
                  const userMessage = previous?.role === "user" ? previous : undefined;
                  const prompt = userMessage?.content || "";
                  const references = userMessage?.attachments || [];
                  const videoPaths = (message.media || []).filter((item) => item.kind === "video").map((item) => item.path);
                  const favorite = videoPaths.length > 0 && videoPaths.every((path) => favorites.has(path));
                  const date = localDate(message.createdAt);
                  const showDate = date !== lastDate;
                  lastDate = date;
                  return (
                    <div key={message.id}>
                      {showDate && <div className="task-date">{date}</div>}
                      <VideoTaskCard prompt={prompt} references={references} message={message}
                        fallbackModelName={selected?.model.name} favorite={favorite}
                        onReedit={() => reedit(prompt, references, message.generation?.videoOptions)}
                        onRegenerate={() => void submit(prompt, references, {
                          clearComposer: false, videoOptions: message.generation?.videoOptions,
                        })}
                        onToggleFavorite={() => void toggleFavorite(videoPaths, !favorite)}
                        onDelete={() => deleteTurn(message.id, userMessage?.id)} />
                    </div>
                  );
                });
              })()}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        <ConversationNavigator messages={active?.messages || []} scrollRootRef={conversationRef} />

        <div className={`composer-region ${draggingImages ? "drag-active" : ""}`}
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            dragDepthRef.current += 1;
            setDraggingImages(true);
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setDraggingImages(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepthRef.current = 0;
            setDraggingImages(false);
            void upload([...event.dataTransfer.files]);
          }}>
          {draggingImages && (
            <div className="drop-overlay" role="status">
              <ImagePlus size={20} />
              <strong>松手添加图片</strong>
              <span>JPG、PNG 或 WebP，最多 {uploadLimit} 张</span>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="attachment-strip">
              {attachments.map((item, index) => (
                <div className="attachment-chip" key={item.path} title={`${referenceLabel(index)} · ${item.name}`}>
                  <span className="attachment-chip-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${item.path}`} alt={item.name} />
                  </span>
                  <span className="attachment-chip-index">{referenceLabel(index)}</span>
                  <span className="attachment-label">{item.name}</span>
                  <button onClick={() => {
                    setAttachments((items) => items.filter((_, i) => i !== index));
                  }} aria-label={`移除 ${item.name}`}><X size={13} /></button>
                </div>
              ))}
              <button className="attachment-add" type="button" onClick={() => fileRef.current?.click()} aria-label="继续添加参考素材">
                <ImagePlus size={16} /><span>参考素材</span>
              </button>
            </div>
          )}
          {error && <div className="inline-error">{error}<button onClick={() => setError("")}><X size={13} /></button></div>}
          <div className="composer" ref={composerRef}>
            <div ref={editorRef} className="composer-editor" contentEditable suppressContentEditableWarning role="textbox" aria-label="提示词"
              data-placeholder={selected?.model.type === "video" ? "描述运动、镜头和氛围…" :
                selected?.model.type === "image" ? "描述你想看到的画面…" : "输入消息…"}
              onPaste={pastedImages}
              onKeyDown={(event) => {
                if (event.key === "@" && !event.ctrlKey && !event.metaKey) {
                  event.preventDefault();
                  captureReferenceAnchor();
                  void openReferencePicker();
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
              }}
              onInput={(event) => setDraft(event.currentTarget.innerText)} />
            <div className="composer-tools">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
                onChange={(event) => {
                  void upload(event.target.files ? [...event.target.files] : []);
                  event.target.value = "";
                }} />
              <button className="icon-button" onClick={() => fileRef.current?.click()}
                disabled={uploadLimit === 0}
                title={uploadLimit === 0
                  ? (selected?.model.type === "chat"
                    ? "当前模型不支持图片输入"
                    : "文生视频模式不需要参考图")
                  : undefined}
                aria-label="添加图片">
                <ImagePlus size={18} />
              </button>
              <button className={`icon-button reference-trigger ${referencePickerOpen ? "active" : ""}`} onClick={() => {
                captureReferenceAnchor();
                void openReferencePicker();
              }}
                disabled={uploadLimit === 0} aria-label="选择参考内容" title="选择本地参考内容">
                <AtSign size={18} />
              </button>
              {selected?.model.type === "image" && <ImageControls
                value={active?.imageOptions || imageDefaults}
                onChange={(imageOptions) => changeGenerationOptions({ imageOptions })} />}
              {selected?.model.type === "video" && <VideoControls
                value={active?.videoOptions || videoDefaults}
                maxReferenceImages={selected.model.maxReferenceImages}
                maxVideoDuration={selected.model.maxVideoDuration}
                onChange={(videoOptions) => changeGenerationOptions({ videoOptions })} />}
              <span className="composer-spacer">{selected?.model.type === "video" && attachments.length > 0
                ? (active?.videoOptions || videoDefaults).referenceMode === "references"
                  ? `${attachments.length} 张参考图`
                  : attachments.length === 2 ? "首帧 · 尾帧" : "首帧"
                : attachments.length ? `${attachments.length} 张参考图` : ""}</span>
              <button className={`send-button ${isGenerating ? "is-stopping" : ""}`}
                onClick={isGenerating ? () => void stop() : send}
                disabled={!isGenerating && (!selected || (!draft.trim() && !attachments.length))}
                aria-label={isGenerating ? "停止生成" : "发送"}>
                {isGenerating
                  ? <Square size={13} fill="currentColor" strokeWidth={2.4} />
                  : <ArrowUp size={17} strokeWidth={2.4} />}
              </button>
            </div>
            {referencePickerOpen && <div className="reference-picker" role="dialog" aria-label="选择参考内容"
              style={{ left: referencePickerPosition.left, top: referencePickerPosition.top }}>
              <div className="reference-picker-head"><strong>选择参考内容</strong><button className="icon-button" onClick={() => setReferencePickerOpen(false)} aria-label="关闭"><X size={15} /></button></div>
              <input className="reference-picker-search" value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="搜索参考内容" autoFocus />
              {referenceAssets.length === 0 ? <p className="reference-picker-empty">资产库里还没有图片。</p> :
                <div className="reference-picker-grid">{referenceAssets.filter((asset) => !referenceQuery.trim() || asset.name.toLowerCase().includes(referenceQuery.trim().toLowerCase())).map((asset) => {
                  const selectedReference = attachments.some((item) => item.path === asset.path);
                  return <button className={`reference-picker-item ${selectedReference ? "selected" : ""}`} key={asset.id}
                    type="button" onClick={() => selectReferenceAsset(asset)} title={asset.name}>
                    <span className="reference-picker-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/media/${asset.path}`} alt="" />
                    </span>
                    <span>{asset.name}</span>
                  </button>;
                })}</div>}
            </div>}
          </div>
          <p className="composer-note">结果保存在本机 · Enter 发送，Shift + Enter 换行</p>
        </div>
      </section>
      {searchOpen && <ConversationSearch conversations={conversations}
        onClose={() => setSearchOpen(false)}
        onSelect={(conversationId) => {
          setActiveId(conversationId);
          setSearchOpen(false);
          closeSidebarOnMobile();
        }} />}
    </main>
  );
}

function isVideoTurn(message: Message, currentType?: ModelConfig["type"]) {
  if (message.role !== "assistant") return false;
  if (message.generation) return message.generation.type === "video";
  if (message.media?.some((item) => item.kind === "video")) return true;
  // 旧记录没有 generation 快照:有任务 ID 或正在生成时,按当前模型类型判断。
  const hasTask = message.taskIds?.length || message.taskId || message.id.startsWith("pending-");
  return Boolean(hasTask || message.status === "processing") && currentType === "video";
}

function localDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function MessageView({
  message,
  processingType = "chat",
}: {
  message: Message;
  processingType?: ModelConfig["type"];
}) {
  return (
    <article id={`message-${message.id}`} className={`message ${message.role}`}>
      <div className="message-meta">{message.role === "user" ? "你" : "Mote"}</div>
      <div className="message-body">
        {message.attachments?.length ? <div className="media-grid">
          {message.attachments.map((media) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={media.path} src={`/api/media/${media.path}`} alt={media.name} />
          ))}
        </div> : null}
        {message.content && <p>{message.content}</p>}
        {message.status === "processing" && (
          processingType === "image" || processingType === "video"
            ? <GenerationStatus type={processingType} />
            : <div className="processing"><span className="pulse-dot" /><span>正在思考</span></div>
        )}
        {message.status === "failed" && <div className="message-error">{message.error || "生成失败"}</div>}
        {message.status === "stopped" && <div className="message-stopped">{message.error || "已停止生成"}</div>}
        {message.media?.map((media) => media.kind === "video" ? (
          <video key={media.path} controls src={`/api/media/${media.path}`} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="generated-image" key={media.path} src={`/api/media/${media.path}`} alt={media.name} />
        ))}
      </div>
    </article>
  );
}
