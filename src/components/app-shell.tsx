"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp, AtSign, BookOpen, Clapperboard, ImagePlus, Images, KeyRound, LogIn, Menu, PanelLeftClose, Plus, Search as SearchIcon, Settings, X, BookMarked, Pencil, Trash2,
} from "lucide-react";
import type { Conversation, MediaRef, Message, ModelType, VideoOptions } from "@/lib/types";
import type { Asset } from "@/lib/asset-store";
import { createClientId } from "@/lib/client-id";
import { GenerationStatus } from "@/components/generation-status";
import { VideoControls } from "@/components/generation-controls";
import { ConversationList, type ConversationGroup } from "@/components/conversation-list";
import { ConversationNavigator } from "@/components/conversation-navigator";
import { EmptyStatePrompt } from "@/components/empty-state-prompt";
import { acceptAttribute, MEDIA_KIND_LABEL, MEDIA_RULES, pickMediaFiles } from "@/lib/media-files";
import { apiKeyHeaders, onApiKeyChange, openSession, readApiKey, readRelayBase } from "@/lib/api-key";
import { openAuthDialog, refreshAccount, useAccount } from "@/lib/account-client";
import { AccountPanel } from "@/components/account-panel";
import {
  countMedia, durationSummary, effectiveReferenceMode, fitVideoOptions, formatPrice, normalizeReferenceMode, remainingMedia,
  TANGZHI_PROVIDER_ID, TANGZHI_PROVIDER_NAME, videoRequestError, type MediaKind, type VideoModel,
} from "@/lib/tangzhi";
import { unfinishedTaskIds } from "@/lib/generation-stop";
import { keepLocalMessages, patchMessage } from "@/lib/conversation-merge";
import { buildTurns } from "@/lib/turns";
import { ConversationSearch } from "@/components/conversation-search";
import {
  REFERENCE_CARD_CLASS, createReferenceCard, findReference, referenceLabels, serializePrompt, splitPromptReferences,
} from "@/lib/prompt-references";
import { VideoTaskCard } from "@/components/video-task-card";
import { LogoMark } from "@/components/logo-mark";
import { Dropdown } from "@/components/dropdown";
import { PromptLibrary, type CustomPromptInput, type PromptUseMode } from "@/components/prompt-library";
import { fitDuration, type PromptTemplate } from "@/lib/prompt-library";
import { MediaThumb } from "@/components/media-thumb";

type PickerAsset = { id: string; kind: MediaKind; path: string; name: string; mimeType: string };
/** 输入框里的素材:上传完成前用本地 blob 预览,上传完成后换成服务器路径(仍保留 blob 预览避免闪烁)。 */
type ComposerAttachment = MediaRef & { previewUrl?: string; uploading?: boolean };

const toMediaRef = (item: ComposerAttachment): MediaRef => ({
  kind: item.kind, path: item.path, name: item.name,
  ...(item.mimeType ? { mimeType: item.mimeType } : {}),
  ...(item.dataUrl ? { dataUrl: item.dataUrl } : {}),
});
const attachmentSrc = (item: ComposerAttachment) => item.previewUrl || `/api/media/${item.path}`;
const revokePreview = (item: ComposerAttachment) => {
  if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
};

const videoDefaults: VideoOptions = {
  referenceMode: "references", ratio: "16:9", resolution: "720p", duration: 5,
  count: 1, audio: true, watermark: false, cameraFixed: false,
};
const MEDIA_KINDS: MediaKind[] = ["image", "video", "audio"];
const RESOLUTION_ORDER: VideoOptions["resolution"][] = ["480p", "720p", "1080p", "4k"];

const POLL_ERROR_PREFIX = "查询任务状态失败";

/** 所有本站接口都带上当前用户的 API Key(服务端据此区分用户数据)。 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...apiKeyHeaders(), ...init?.headers } });
  // 服务重启或网关出错时返回的是 HTML 错误页,不是 JSON
  const data = await response.json().catch(() => {
    throw new Error(response.ok ? "服务器返回了无法识别的内容" : `服务暂时不可用（${response.status}），请稍后重试`);
  });
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function freshConversation(model?: VideoModel): Conversation {
  const now = new Date().toISOString();
  return {
    id: createClientId(), title: "新对话",
    providerId: TANGZHI_PROVIDER_ID, modelId: model?.id,
    createdAt: now, updatedAt: now,
    videoOptions: model ? fitVideoOptions(model, videoDefaults) : videoDefaults, messages: [],
  };
}

export function AppShell() {
  const [models, setModels] = useState<VideoModel[]>([]);
  // undefined = 还没读到浏览器里保存的 Key
  const [apiKey, setApiKey] = useState<string>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const uploading = attachments.some((item) => item.uploading);
  const [pollFailures, setPollFailures] = useState(0);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [draggingImages, setDraggingImages] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [customPrompts, setCustomPrompts] = useState<PromptTemplate[]>([]);
  const [groups, setGroups] = useState<ConversationGroup[]>([]);
  // 自定义中转站的域名;空 = 内置中转站
  const [relayHost, setRelayHost] = useState("");
  const account = useAccount();
  // 当前身份:内置中转站只认登录账号(令牌在服务端);自定义中转站用浏览器里的 Key;undefined = 还在读取
  const credential = apiKey === undefined || account === undefined ? undefined
    : relayHost ? apiKey : account.loggedIn ? `account:${account.username}` : "";
  const accountMode = Boolean(credential?.startsWith("account:"));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [referencePickerPosition, setReferencePickerPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: 10, top: 8 });
  const referenceRangeRef = useRef<Range | null>(null);
  const referenceAnchorRef = useRef<DOMRect | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  // 正在提交中的本地消息(用户消息、生成占位),服务端返回整份对话时要保留它们
  const inflightRef = useRef(new Set<string>());

  const active = conversations.find((item) => item.id === activeId);
  // 默认选第一个支持多种比例的模型(个别渠道只支持竖屏)
  const selected = models.find((item) => item.id === active?.modelId) ||
    models.find((item) => item.ratios.length > 1) || models[0];
  // 当前模型可用的参数:模型不支持的比例/分辨率/时长自动收回到可用值
  const videoOptions = selected ? fitVideoOptions(selected, active?.videoOptions || videoDefaults) : videoDefaults;
  const mode = normalizeReferenceMode(videoOptions.referenceMode);
  const remaining = Object.fromEntries(MEDIA_KINDS.map((kind) => [
    kind, selected ? remainingMedia(selected, mode, attachments, kind) : 0,
  ])) as Record<MediaKind, number>;
  const allowedKinds = MEDIA_KINDS.filter((kind) => remaining[kind] > 0);
  const remainingTotal = !selected ? 0 :
    mode === "first_last" ? remaining.image : Math.max(0, selected.limits.total - attachments.length);
  const uploadLimit = allowedKinds.length ? remainingTotal : 0;
  // 当前模式下这个模型能接受的素材类型(不看已选数量),决定 @ 选择框和上传入口
  const modeKinds = MEDIA_KINDS.filter((kind) => selected && remainingMedia(selected, mode, [], kind) > 0);
  const labels = referenceLabels(attachments);

  // 模型列表与个人数据分开加载:模型列表慢或失败不影响查看历史对话
  useEffect(() => {
    request<VideoModel[]>("/api/models").then(setModels).catch((cause) => setError(cause.message));
  }, []);

  const load = useCallback(async (key: string) => {
    if (!key) {
      // 没登录也没有 Key 就没有个人空间
      setConversations([]);
      setFavorites(new Set());
      setCustomPrompts([]);
      setGroups([]);
      setActiveId(undefined);
      await openSession("");
      return;
    }
    // 账号登录时看媒体用的 Cookie 已在登录时写好
    if (!key.startsWith("account:")) await openSession(key);
    const [nextConversations, nextFavorites, nextPrompts, nextGroups] = await Promise.all([
      request<Conversation[]>("/api/conversations"),
      request<string[]>("/api/favorites").catch(() => []),
      request<PromptTemplate[]>("/api/prompts").catch(() => []),
      request<ConversationGroup[]>("/api/groups").catch(() => []),
    ]);
    setFavorites(new Set(nextFavorites));
    setCustomPrompts(nextPrompts);
    setGroups(nextGroups);
    setConversations(nextConversations);
    if (nextConversations.length) {
      const requested = typeof window === "undefined" ? null :
        new URLSearchParams(window.location.search).get("conversation");
      setActiveId((id) =>
        requested && nextConversations.some((item) => item.id === requested)
          ? requested : id && nextConversations.some((item) => item.id === id) ? id : nextConversations[0].id);
    } else {
      setActiveId(undefined);
    }
  }, []);

  useEffect(() => {
    if (credential === undefined) return;
    const timer = window.setTimeout(() => load(credential).catch((cause) => setError(cause.message)), 0);
    return () => clearTimeout(timer);
  }, [load, credential]);
  useEffect(() => {
    const sync = () => { setApiKey(readApiKey()); setRelayHost(readRelayBase().replace(/^https?:\/\//, "")); };
    const timer = window.setTimeout(sync, 0);
    const unsubscribe = onApiKeyChange(sync);
    return () => { clearTimeout(timer); unsubscribe(); };
  }, []);
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
    const labels = referenceLabels(attachments);
    let changed = false;
    editor.querySelectorAll<HTMLElement>(`.${REFERENCE_CARD_CLASS}`).forEach((card) => {
      const index = paths.indexOf(card.dataset.path || "");
      if (index < 0) {
        card.remove();
        changed = true;
      } else {
        card.dataset.label = labels[index];
      }
    });
    if (changed) setDraft(editor.innerText);
  }, [attachments]);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.style.height = "auto";
    editor.style.height = `${Math.min(Math.max(editor.scrollHeight, 84), 280)}px`;
  }, [draft]);

  const persist = async (conversation: Conversation) => {
    const saved = await request<Conversation>(`/api/conversations/${conversation.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conversation),
    }).catch(async () => request<Conversation>("/api/conversations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conversation),
    }));
    setConversations((items) => [
      keepLocalMessages(saved, items.find((item) => item.id === saved.id), inflightRef.current),
      ...items.filter((item) => item.id !== saved.id),
    ]);
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
    const composerRect = composer.getBoundingClientRect();
    const pickerWidth = Math.min(430, window.innerWidth - 32);
    const left = Math.max(8, Math.min(markerRect.left - 14, window.innerWidth - pickerWidth - 8));
    // 贴着输入框上沿弹出(用 bottom 锚定,内容多少都不会悬空);上方空间不够时改到输入框下方。
    setReferencePickerPosition(composerRect.top > 240
      ? { left, bottom: window.innerHeight - composerRect.top + 10 }
      : { left, top: composerRect.bottom + 10 });
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
    if (!modeKinds.length) return;
    if (referencePickerOpen) {
      referenceRangeRef.current = null;
      referenceAnchorRef.current = null;
      setReferencePickerOpen(false);
      return;
    }
    try {
      const assets = await request<Asset[]>("/api/assets");
      setReferenceAssets(assets.filter((asset) => !asset.trashed));
      setReferenceQuery("");
      setReferencePickerOpen(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  // 当前对话的素材实时并入(选择框打开期间新上传的也会出现);只列出当前模型和模式能用的素材类型。
  const pickerAssets: PickerAsset[] = [
    ...attachments.filter((item) => !item.uploading).map((item) => ({
      id: `current:${item.path}`, kind: item.kind, path: item.path, name: item.name,
      mimeType: item.mimeType || "image/jpeg",
    })),
    ...referenceAssets,
  ]
    .filter((asset) => modeKinds.includes(asset.kind))
    .filter((asset, index, list) => list.findIndex((candidate) => candidate.path === asset.path) === index);

  const selectReferenceAsset = (asset: PickerAsset) => {
    if (!modeKinds.includes(asset.kind)) return;
    const alreadyAttached = attachments.some((item) => item.path === asset.path);
    if (!alreadyAttached && (remaining[asset.kind] <= 0 || remainingTotal <= 0)) {
      setError(`已达到当前模型的${MEDIA_KIND_LABEL[asset.kind]}或素材合计上限`);
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
      const position = nextAttachments.findIndex((item) => item.path === asset.path);
      const card = createReferenceCard(asset.path, asset.name, referenceLabels(nextAttachments)[position], asset.kind);
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

  const clearAttachments = () => {
    attachments.forEach(revokePreview);
    setAttachments([]);
  };

  const clearPrompt = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = "";
    setDraft("");
    editor.focus();
  };

  const create = async () => {
    const conversation = freshConversation(selected);
    await persist(conversation);
    setActiveId(conversation.id);
    setDraft("");
    setAttachments([]);
    if (editorRef.current) editorRef.current.innerHTML = "";
    closeSidebarOnMobile();
  };

  const removeConversations = async (ids: string[]) => {
    try {
      await request("/api/conversations", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
      });
      const gone = new Set(ids);
      const rest = conversations.filter((item) => !gone.has(item.id));
      setConversations((items) => items.filter((item) => !gone.has(item.id)));
      if (activeId && gone.has(activeId)) setActiveId(rest[0]?.id);
    } catch (cause) { setError((cause as Error).message); }
  };

  const moveConversations = async (ids: string[], groupId: string | undefined) => {
    const targets = new Set(ids);
    const previous = conversations;
    setConversations((items) => items.map((item) => !targets.has(item.id) ? item : { ...item, groupId }));
    try {
      await request("/api/conversations", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, groupId }),
      });
    } catch (cause) {
      setConversations(previous);
      setError((cause as Error).message);
    }
  };

  const saveGroups = (next: ConversationGroup[]) => {
    setGroups(next);
    void request<ConversationGroup[]>("/api/groups", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
    }).catch((cause) => setError((cause as Error).message));
  };

  const createGroup = (name: string) => {
    const group: ConversationGroup = { id: createClientId(), name };
    saveGroups([group, ...groups]);
    return group;
  };

  const rename = async (conversation: Conversation, title: string) => {
    await persist({ ...conversation, title, updatedAt: new Date().toISOString() });
  };

  const chooseModel = async (modelId: string) => {
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    if (!active) {
      const conversation = freshConversation(model);
      await persist(conversation);
      setActiveId(conversation.id);
      return;
    }
    await persist({
      ...active, providerId: TANGZHI_PROVIDER_ID, modelId,
      videoOptions: fitVideoOptions(model, active.videoOptions || videoDefaults),
      updatedAt: new Date().toISOString(),
    });
  };

  const changeGenerationOptions = (options: { videoOptions?: VideoOptions }) => {
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
    if (!selected || !files.length) return;
    const selection = pickMediaFiles(files, remaining, remainingTotal);
    if (selection.error) setError(selection.error);
    else setError("");
    if (!selection.accepted.length) return;
    // 逐个上传:视频素材较大,单次请求不超过站点的上传上限
    const pending = selection.accepted.map(({ file, kind }) => ({
      file,
      item: {
        kind, path: `pending:${createClientId()}`, name: file.name, mimeType: file.type,
        previewUrl: URL.createObjectURL(file), uploading: true,
      } as ComposerAttachment,
    }));
    setAttachments((items) => [...items, ...pending.map((entry) => entry.item)]);
    await Promise.all(pending.map(async ({ file, item: placeholder }) => {
      const form = new FormData();
      form.append("files", file);
      try {
        const [uploaded] = await request<MediaRef[]>("/api/uploads", { method: "POST", body: form });
        setAttachments((items) => items.map((item) =>
          item.path === placeholder.path ? { ...uploaded, previewUrl: item.previewUrl } : item));
      } catch (cause) {
        setAttachments((items) => items.filter((item) => item.path !== placeholder.path));
        revokePreview(placeholder);
        setError((cause as Error).message);
      }
    }));
  };

  const pastedImages = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    void upload(files);
  };

  const send = () => {
    if (!selected || (!draft.trim() && !attachments.length)) return;
    const prompt = editorRef.current
      ? serializePrompt(editorRef.current, attachments)
      : draft.trim();
    if (uploading) {
      setError("素材还在上传，请稍候再发送");
      return;
    }
    return submit(prompt, attachments.map(toMediaRef), { clearComposer: true });
  };

  // 同一对话可以连续提交多个生成任务,不必等上一个完成
  const submit = async (
    prompt: string, usedAttachments: MediaRef[],
    { clearComposer, videoOptions }: { clearComposer: boolean; videoOptions?: VideoOptions },
  ) => {
    if (!selected) return;
    const fitted = fitVideoOptions(selected, videoOptions || active?.videoOptions || videoDefaults);
    // 快照记录实际生成方式:没有素材时就是文生视频
    const currentVideoOptions: VideoOptions = {
      ...fitted, referenceMode: effectiveReferenceMode(fitted.referenceMode, usedAttachments.length),
    };
    if (!credential) {
      if (relayHost) setError("请先在「设置」中填写自定义中转站的 API Key");
      else openAuthDialog("login");
      return;
    }
    const invalid = videoRequestError(selected, prompt, currentVideoOptions, usedAttachments);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError("");
    // 先清空输入框,连点发送不会重复提交同一条
    if (clearComposer) {
      setDraft("");
      attachments.forEach(revokePreview);
      setAttachments([]);
      if (editorRef.current) editorRef.current.innerHTML = "";
    }
    const now = new Date().toISOString();
    const user: Message = {
      id: createClientId(), role: "user", content: prompt,
      attachments: usedAttachments, createdAt: now, status: "complete",
    };
    const pendingMessage: Message = {
      id: `pending-${createClientId()}`, role: "assistant", content: "", createdAt: now, status: "processing",
      replyTo: user.id,
      generation: {
        type: "video", providerName: TANGZHI_PROVIDER_NAME,
        modelName: selected.id, modelId: selected.id, videoOptions: currentVideoOptions,
      },
    };
    inflightRef.current.add(user.id);
    inflightRef.current.add(pendingMessage.id);
    let conversationId = active?.id;
    try {
      if (!active) {
        const created = await persist(freshConversation(selected));
        conversationId = created.id;
        setActiveId(created.id);
      }
      const id = conversationId as string;
      setConversations((items) => items.map((item) => item.id !== id ? item : {
        ...item,
        title: item.messages.length ? item.title : (prompt || "视频生成").slice(0, 28),
        providerId: TANGZHI_PROVIDER_ID, modelId: selected.id, updatedAt: now,
        messages: [...item.messages, user, pendingMessage],
      }));
      const result = await request<{ conversation: Conversation; assistant: Message }>("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiKeyHeaders(apiKey) },
        body: JSON.stringify({
          conversationId: id, userMessageId: user.id, modelId: selected.id,
          prompt, attachments: usedAttachments, videoOptions: currentVideoOptions,
        }),
      });
      inflightRef.current.delete(user.id);
      inflightRef.current.delete(pendingMessage.id);
      // 提交时中转站已预扣费用
      if (accountMode) void refreshAccount().catch(() => undefined);
      setConversations((items) => items.map((item) => item.id !== id ? item :
        patchMessage({
          ...item, title: result.conversation.title, providerId: result.conversation.providerId,
          modelId: result.conversation.modelId, videoOptions: result.conversation.videoOptions,
          updatedAt: result.conversation.updatedAt,
        }, result.assistant, pendingMessage.id)));
    } catch (cause) {
      // 失败卡片留在本地(服务端也会记一张),不随后续保存消失
      const message = (cause as Error).message;
      setError(message);
      setConversations((items) => items.map((item) => item.id !== conversationId ? item : {
        ...item,
        messages: item.messages.map((entry) =>
          entry.id === pendingMessage.id ? { ...entry, status: "failed", error: message } : entry),
      }));
    }
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

  // 只告诉服务端删哪几条,不用浏览器里的整份副本覆盖(其他任务可能刚写入结果)
  const deleteTurn = (messageId: string, userMessageId?: string) => {
    if (!active) return;
    const removed = [messageId, userMessageId].filter((id): id is string => Boolean(id));
    removed.forEach((id) => inflightRef.current.delete(id));
    const updated = {
      ...active, updatedAt: new Date().toISOString(),
      messages: active.messages.filter((item) => !removed.includes(item.id)),
    };
    setConversations((items) => items.map((item) => item.id === updated.id ? updated : item));
    void request<Conversation>(`/api/conversations/${updated.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...updated, removedMessageIds: removed }),
    }).then((saved) => setConversations((items) => items.map((item) => item.id !== saved.id ? item :
      keepLocalMessages(saved, item, inflightRef.current))))
      .catch((cause) => setError(cause.message));
  };

  const reedit = (prompt: string, references: MediaRef[], videoOptions?: VideoOptions) => {
    const editor = editorRef.current;
    if (!editor) return;
    setAttachments(references);
    editor.innerHTML = "";
    const labels = referenceLabels(references);
    for (const segment of splitPromptReferences(prompt)) {
      if (segment.kind === "text") {
        editor.append(document.createTextNode(segment.text));
        continue;
      }
      const position = findReference(references, segment.mediaKind, segment.index);
      const ref = references[position];
      if (ref) editor.append(createReferenceCard(ref.path, ref.name, labels[position], ref.kind));
    }
    setDraft(editor.innerText);
    if (videoOptions) changeGenerationOptions({ videoOptions });
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const closeLibrary = useCallback(() => setLibraryOpen(false), []);

  const saveCustomPrompt = async (input: CustomPromptInput) => {
    const saved = await request<PromptTemplate>("/api/prompts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    setCustomPrompts((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
  };

  const deleteCustomPrompt = async (id: string) => {
    try {
      await request(`/api/prompts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setCustomPrompts((items) => items.filter((item) => item.id !== id));
    } catch (cause) { setError((cause as Error).message); }
  };

  const applyPromptTemplate = (template: PromptTemplate, mode: PromptUseMode, applyParams: boolean) => {
    const editor = editorRef.current;
    if (editor) {
      const hasContent = Boolean(editor.textContent?.trim() || editor.querySelector(`.${REFERENCE_CARD_CLASS}`));
      if (mode === "replace" || !hasContent) editor.innerHTML = "";
      else editor.append(document.createTextNode("\n"));
      editor.append(document.createTextNode(template.prompt));
      setDraft(editor.innerText);
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (applyParams && selected) {
      const max = selected.durations[selected.durations.length - 1];
      changeGenerationOptions({
        videoOptions: fitVideoOptions(selected, {
          ...videoOptions,
          ratio: template.ratio ?? videoOptions.ratio,
          duration: fitDuration(template.duration, max, selected.durations) ?? videoOptions.duration,
          referenceMode: template.referenceMode ?? videoOptions.referenceMode,
        }),
      });
    }
    setLibraryOpen(false);
  };

  // 所有对话里未完成的视频任务都要查,不只当前打开的这一个:
  // 切到别的对话后,后台任务完成也能及时取回视频。
  // 早期版本「停止」过的任务云端其实还在生成,也继续查,把结果取回来
  const pendingTasks = conversations.flatMap((conversation) => conversation.messages
    .filter((message) => message.status === "processing" || message.status === "stopped")
    .flatMap((message) => unfinishedTaskIds(message).map((taskId) => ({ conversationId: conversation.id, taskId }))));
  const pendingKey = pendingTasks.map((item) => `${item.conversationId}:${item.taskId}`).join("|");

  useEffect(() => {
    if (!pendingKey) return;
    const tasks = pendingKey.split("|").map((entry) => {
      const [conversationId, taskId] = entry.split(":");
      return { conversationId, taskId };
    });
    // 查询失败(网络抖动、中转站临时错误)时不放弃,逐步拉长间隔继续查
    const timer = window.setTimeout(async () => {
      const results = await Promise.allSettled(tasks.map((task) =>
        request<{ message?: Message }>(
          `/api/tasks/${task.taskId}?conversationId=${task.conversationId}`, { headers: apiKeyHeaders() },
        ).then((result) => ({ conversationId: task.conversationId, message: result.message }))));
      // 同一对话可能有多个任务同时返回:逐条更新对应的消息,不整份替换
      const patches: { conversationId: string; message: Message }[] = [];
      let failure: unknown;
      for (const result of results) {
        if (result.status === "rejected") failure ??= result.reason;
        else if (result.value.message) patches.push({ conversationId: result.value.conversationId, message: result.value.message });
      }
      if (patches.length) {
        // 任务结束(成功结算或失败退款)后余额会变
        if (accountMode && patches.some((patch) => patch.message.status !== "processing")) {
          void refreshAccount().catch(() => undefined);
        }
        setConversations((items) => items.map((item) => patches
          .filter((patch) => patch.conversationId === item.id)
          .reduce((conversation, patch) => patchMessage(conversation, patch.message), item)));
      }
      if (failure) {
        setError(`${POLL_ERROR_PREFIX}，稍后自动重试：${(failure as Error).message}`);
        setPollFailures((count) => count + 1);
      } else {
        setPollFailures(0);
        // 查询恢复后,收起之前的查询失败提示(其他错误保留)
        setError((current) => (current.startsWith(POLL_ERROR_PREFIX) ? "" : current));
      }
    }, Math.min(5000 * 2 ** pollFailures, 30_000));
    return () => clearTimeout(timer);
  }, [pendingKey, pollFailures, conversations, accountMode]);

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
        <ConversationList conversations={conversations} groups={groups} activeId={activeId}
          onOpen={(id) => { setActiveId(id); closeSidebarOnMobile(); }}
          onRename={(conversation, title) => void rename(conversation, title)}
          onDelete={removeConversations} onMove={moveConversations}
          onGroupsChange={saveGroups} onCreateGroup={createGroup} />
        <div className="sidebar-utilities">
          <Link className="settings-link" href="/docs"><BookOpen size={16} /> 文档</Link>
          <Link className="settings-link" href="/settings"><Settings size={16} /> 设置</Link>
        </div>
        {!relayHost && <AccountPanel />}
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" />}

      <section className="workspace">
        <header className="topbar">
          {!sidebarOpen && <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏">
            <Menu size={18} />
          </button>}
          {selected && <span className="model-spec" title={selected.description}>
            <b>{selected.id}</b>
            <span>{selected.resolution.toUpperCase()}</span>
            <span>{durationSummary(selected.durations)}</span>
            <span>{selected.limits.images}图 · {selected.limits.videos}视频 · {selected.limits.audios}音频 · 合计≤{selected.limits.total}</span>
            <span>{formatPrice(selected)}</span>
          </span>}
          {credential === "" && (relayHost
            ? <Link className="key-missing" href="/settings"><KeyRound size={13} />填写 API Key</Link>
            : <button type="button" className="key-missing" onClick={() => openAuthDialog("login")}><LogIn size={13} />登录 / 注册</button>)}
          {accountMode && account?.balance && (
            <span className="topbar-balance" title="中转站账户余额">余额 <b>{account.balance}</b></span>
          )}
        </header>

        <div className="conversation" ref={conversationRef}>
          {!active?.messages.length ? (
            <div className="empty-state">
              <LogoMark size={44} className="empty-mark" />
              <h1>今天，想创造什么？</h1>
              {credential
                ? <EmptyStatePrompt type="video" />
                : credential === undefined ? null
                  : relayHost
                    ? <p>先到设置里填写自定义中转站的 API Key，然后开始。</p>
                    : <p>登录或注册 {TANGZHI_PROVIDER_NAME} 账号即可开始，余额与中转站通用。</p>}
              {credential === "" && (relayHost
                ? <Link className="text-link" href="/settings">前往设置 <span>↗</span></Link>
                : <button type="button" className="text-link" onClick={() => openAuthDialog("register")}>注册账号 <span>↗</span></button>)}
              {selected && (
                <button type="button" className="empty-library-link" data-prompt-library-trigger
                  onClick={() => setLibraryOpen(true)}><BookMarked size={14} />从提示词库开始</button>
              )}
            </div>
          ) : (
            <div className="message-list">
              {(() => {
                let lastDate = "";
                return buildTurns(active.messages, isVideoTurn).map((turn) => {
                  const { message } = turn;
                  if (turn.kind === "message") {
                    return message.role === "user"
                      // 没有对应生成记录的提示词(提交失败、旧数据):可以重新编辑或删除
                      ? <MessageView key={message.id} message={message}
                        onReedit={() => reedit(message.content, message.attachments || [])}
                        onDelete={() => deleteTurn(message.id)} />
                      : <MessageView key={message.id} message={message} />;
                  }
                  const userMessage = turn.user;
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
                        fallbackModelName={selected?.id} favorite={favorite}
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
              <strong>{uploadLimit ? "松手添加素材" : "当前模式不能添加素材"}</strong>
              <span>{uploadLimit
                ? `${allowedKinds.map((kind) => MEDIA_RULES[kind].label).join("、")}，还可添加 ${uploadLimit} 个`
                : "已达到当前模型的素材上限"}</span>
            </div>
          )}
          <PromptLibrary open={libraryOpen} onClose={closeLibrary} onUse={applyPromptTemplate}
            customPrompts={customPrompts} currentPrompt={draft}
            onSaveCustom={saveCustomPrompt} onDeleteCustom={deleteCustomPrompt} />
          {error && <div className="inline-error">{error}<button onClick={() => setError("")}><X size={13} /></button></div>}
          <div className="composer" ref={composerRef}>
            <div className="composer-body">
              {attachments.length > 0 && (
                <div className="attachment-stack" aria-label={`${attachments.length} 个参考素材`}
                  style={{ "--count": attachments.length + 1 } as React.CSSProperties}>
                  {attachments.map((item, index) => (
                    <div className={`stack-card kind-${item.kind} ${item.uploading ? "is-uploading" : ""}`} key={item.path}
                      title={item.uploading ? `正在上传 · ${item.name}` : `${labels[index]} · ${item.name}`}
                      style={{ "--i": index, "--r": `${stackTilt(index)}deg` } as React.CSSProperties}>
                      <MediaThumb media={item} src={attachmentSrc(item)} alt={item.name} />
                      {item.uploading && <span className="stack-card-spinner" aria-label="上传中" />}
                      <span className="stack-card-index">{labels[index]}</span>
                      <button type="button" className="stack-card-remove" onClick={() => {
                        revokePreview(item);
                        setAttachments((items) => items.filter((_, i) => i !== index));
                      }} aria-label={`移除 ${item.name}`}><X size={11} strokeWidth={2.6} /></button>
                    </div>
                  ))}
                  <button type="button" className="stack-add" onClick={() => fileRef.current?.click()}
                    disabled={uploadLimit === 0}
                    style={{ "--i": attachments.length } as React.CSSProperties}
                    aria-label="继续添加参考素材" title="继续添加参考素材"><Plus size={16} /></button>
                  <button type="button" className="stack-add stack-clear" onClick={clearAttachments}
                    style={{ "--i": attachments.length + 1 } as React.CSSProperties}
                    aria-label="清空全部素材" title="清空全部素材"><Trash2 size={15} /></button>
                  {attachments.length > 1 && <span className="stack-count">{attachments.length}</span>}
                </div>
              )}
              <div ref={editorRef} className="composer-editor" contentEditable suppressContentEditableWarning role="textbox" aria-label="提示词"
                data-placeholder={attachments.length ? "描述画面、运动和镜头，输入 @ 引用素材（至少 10 个字）…" :
                  "描述画面、运动、镜头和氛围（至少 10 个字）；添加素材可按参考图或首尾帧生成"}
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
                onInput={(event) => {
                  const editor = event.currentTarget;
                  // 删光文字后浏览器常留下 <br>、换行或零宽字符,:empty 不再成立,占位提示就不显示了
                  const leftover = (editor.textContent || "").replace(/[\s\u200b\ufeff]/g, "");
                  if (!leftover && !editor.querySelector(`.${REFERENCE_CARD_CLASS}`)) editor.innerHTML = "";
                  setDraft(editor.innerText);
                }} />
              {draft.trim() && <button type="button" className="composer-clear" onClick={clearPrompt}
                aria-label="清空提示词" title="清空提示词"><X size={15} /></button>}
            </div>
            <div className="composer-tools">
              <input ref={fileRef} type="file" accept={acceptAttribute(allowedKinds)} multiple hidden
                onChange={(event) => {
                  void upload(event.target.files ? [...event.target.files] : []);
                  event.target.value = "";
                }} />
              <button className="icon-button" onClick={() => fileRef.current?.click()}
                disabled={uploadLimit === 0}
                title={uploadLimit === 0
                  ? (mode === "first_last" ? "首尾帧最多两张图片" : "已达到当前模型的素材上限")
                  : `添加${allowedKinds.map((kind) => MEDIA_KIND_LABEL[kind]).join(" / ")}`}
                aria-label="添加素材">
                <ImagePlus size={18} />
              </button>
              <button className={`icon-button reference-trigger ${referencePickerOpen ? "active" : ""}`} onClick={() => {
                captureReferenceAnchor();
                void openReferencePicker();
              }}
                disabled={!modeKinds.length} aria-label="选择参考内容" title="选择本地参考内容">
                <AtSign size={18} />
              </button>
              {selected && (
                <button type="button" className={`icon-button prompt-library-trigger ${libraryOpen ? "active" : ""}`}
                  data-prompt-library-trigger onClick={() => setLibraryOpen((open) => !open)}
                  aria-label="提示词库" aria-expanded={libraryOpen} title="提示词库">
                  <BookMarked size={18} />
                </button>
              )}
              <Dropdown className="model-dropdown composer-model" ariaLabel="选择模型" placeholder="正在加载模型"
                value={selected?.id || ""}
                options={[...models].sort((a, b) => RESOLUTION_ORDER.indexOf(a.resolution) - RESOLUTION_ORDER.indexOf(b.resolution))
                  .map((model) => ({
                    value: model.id,
                    label: model.id,
                    group: model.resolution.toUpperCase(),
                    hint: `${durationSummary(model.durations)} · ${formatPrice(model)}`,
                    detail: model.description.replace(/^\(按[次秒]计费\)\s*/, "").replace(/\s+/g, " "),
                  }))}
                renderValue={() => selected
                  ? <><Clapperboard size={14} /><span className="composer-model-name">{selected.id}</span></>
                  : <span className="dropdown-placeholder">正在加载模型</span>}
                onChange={(value) => void chooseModel(value)} />
              {selected && <VideoControls key={selected.id} value={videoOptions} model={selected}
                attachmentCount={attachments.length}
                onChange={(next) => changeGenerationOptions({ videoOptions: next })} />}
              <span className="composer-spacer">{attachmentSummary(mode, attachments)}</span>
              <button className="send-button" onClick={send}
                disabled={!selected || uploading || (!draft.trim() && !attachments.length)}
                aria-label="发送" title="发送（生成中也可以继续提交）">
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            </div>
            {referencePickerOpen && <div className="reference-picker" role="dialog" aria-label="选择参考内容"
              style={referencePickerPosition}>
              <div className="reference-picker-head"><strong>选择参考内容</strong><button className="icon-button" onClick={() => setReferencePickerOpen(false)} aria-label="关闭"><X size={15} /></button></div>
              <input className="reference-picker-search" value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="搜索参考内容" autoFocus />
              {pickerAssets.length === 0 ? <p className="reference-picker-empty">还没有可引用的素材，先上传或拖入一个。</p> :
                <div className="reference-picker-grid">{pickerAssets.filter((asset) => !referenceQuery.trim() || asset.name.toLowerCase().includes(referenceQuery.trim().toLowerCase())).map((asset) => {
                  const selectedReference = attachments.some((item) => item.path === asset.path);
                  return <button className={`reference-picker-item ${selectedReference ? "selected" : ""}`} key={asset.id}
                    type="button" onClick={() => selectReferenceAsset(asset)} title={asset.name}>
                    <span className="reference-picker-thumb"><MediaThumb media={asset} /></span>
                    <span>{asset.name}</span>
                  </button>;
                })}</div>}
            </div>}
          </div>
          <p className="composer-note">由 {relayHost || `${TANGZHI_PROVIDER_NAME} `}中转站生成 · Enter 发送，Shift + Enter 换行</p>
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

/** 叠放素材的倾角:首张微倾,其余左右交替、越往后越歪,营造一叠照片的感觉。 */
function stackTilt(index: number) {
  if (index === 0) return -3;
  return (index % 2 ? 1 : -1) * Math.min(6 + index * 3, 14);
}

function isVideoTurn(message: Message) {
  if (message.role !== "assistant") return false;
  if (message.generation) return message.generation.type === "video";
  if (message.media?.some((item) => item.kind === "video")) return true;
  // 旧记录没有 generation 快照:有任务 ID 或正在生成时按视频任务展示。
  const hasTask = message.taskIds?.length || message.taskId || message.id.startsWith("pending-");
  return Boolean(hasTask || message.status === "processing");
}

function attachmentSummary(mode: string, attachments: readonly Pick<MediaRef, "kind">[]) {
  if (!attachments.length) return "";
  if (mode === "first_last") return attachments.length === 2 ? "首帧 · 尾帧" : "首帧（还需一张尾帧）";
  const counts = countMedia(attachments);
  return [
    counts.images && `${counts.images} 张图片`,
    counts.videos && `${counts.videos} 个视频`,
    counts.audios && `${counts.audios} 个音频`,
  ].filter(Boolean).join(" · ");
}

function localDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function MessageView({
  message,
  processingType = "video",
  onReedit,
  onDelete,
}: {
  message: Message;
  processingType?: ModelType;
  onReedit?: () => void;
  onDelete?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);
  return (
    <article id={`message-${message.id}`} className={`message ${message.role}`}>
      <div className="message-meta">{message.role === "user" ? "你" : "Mote"}</div>
      <div className="message-body">
        {(onReedit || onDelete) && <div className="message-actions">
          {onReedit && <button type="button" onClick={onReedit} title="放回输入框重新编辑"><Pencil size={13} />重新编辑</button>}
          {onDelete && <button type="button" className={confirmDelete ? "danger" : ""} title="删除这条提示词"
            onClick={() => { if (confirmDelete) onDelete(); else setConfirmDelete(true); }}>
            <Trash2 size={13} />{confirmDelete ? "再点一次删除" : "删除"}</button>}
        </div>}
        {message.attachments?.length ? <div className="media-grid">
          {message.attachments.map((media) => <MediaThumb key={media.path} media={media} alt={media.name} />)}
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
