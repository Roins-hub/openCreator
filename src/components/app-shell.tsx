"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp, AtSign, Check, Clapperboard, Download, Image as ImageIcon, ImagePlus, KeyRound, ListChecks, Loader2, Maximize2, Menu,
  Minimize2, PanelLeftClose, Plus, Search as SearchIcon, Sparkles, Undo2, X, BookMarked, Pencil, Trash2,
} from "lucide-react";
import type { Conversation, GenerationMeta, ImageOptions, MediaRef, Message, ModelType, VideoOptions } from "@/lib/types";
import type { Asset, AssetFolder } from "@/lib/asset-store";
import { createClientId } from "@/lib/client-id";
import { GenerationStatus } from "@/components/generation-status";
import { ImageControls, VideoControls } from "@/components/generation-controls";
import { ConversationList, type ConversationGroup } from "@/components/conversation-list";
import { GroupPicker } from "@/components/group-picker";
import { BackToTop } from "@/components/back-to-top";
import { ThemeQuickPicker } from "@/components/theme-quick-picker";
import { readWorkspaceCache, writeWorkspaceCache, type WorkspaceSnapshot } from "@/lib/workspace-cache";
import { AssetsIcon, ChatIcon, CreateIcon, DocsIcon, SettingsIcon } from "@/components/rail-icons";
import { ConversationNavigator } from "@/components/conversation-navigator";
import { EmptyStatePrompt } from "@/components/empty-state-prompt";
import { acceptAttribute, MEDIA_KIND_LABEL, MEDIA_RULES, pickMediaFiles } from "@/lib/media-files";
import { NETWORK_ERROR, readableError } from "@/lib/network-error";
import {
  apiKeyHeaders, assistKeyHeaders, effectiveAssistKey, isImageOnly, onApiKeyChange, openSession, readApiKey, readAssistModel,
  readRelayBase,
} from "@/lib/api-key";
import {
  countMedia, durationSummary, effectiveReferenceMode, fitVideoOptions, formatPrice, normalizeReferenceMode, remainingMedia,
  smartVideoRatio, TANGZHI_PROVIDER_ID, TANGZHI_PROVIDER_NAME, videoRequestError, type MediaKind, type VideoModel,
} from "@/lib/tangzhi";
import { unfinishedTaskIds } from "@/lib/generation-stop";
import { keepLocalMessages, patchMessage } from "@/lib/conversation-merge";
import { buildTurns, isGenerationTurn, isImageRecord } from "@/lib/turns";
import { ConversationSearch } from "@/components/conversation-search";
import {
  REFERENCE_CARD_CLASS, createReferenceCard, findReference, referenceLabels, serializePrompt, splitPromptReferences,
} from "@/lib/prompt-references";
import { VideoTaskCard } from "@/components/video-task-card";
import { ImageTaskCard } from "@/components/image-task-card";
import {
  fitImageOptions, fitImageToModel, imageDefaults, imageRequestError, parseRatio, type ImageModel,
} from "@/lib/image-models";
import { LogoMark } from "@/components/logo-mark";
import { useSlidingIndicator } from "@/components/sliding-indicator";
import { PromptLibrary, type CustomPromptInput, type PromptUseMode } from "@/components/prompt-library";
import { fitDuration, type PromptTemplate } from "@/lib/prompt-library";
import { emptyPromptLayout, recordUsage, type PromptLayout } from "@/lib/prompt-layout";
import { MediaThumb, PosterVideo, ThumbImage } from "@/components/media-thumb";
import { MediaPreview } from "@/components/media-preview";
import { thumbUrl } from "@/lib/media-url";
import { COMPOSER_DROP, EDITOR_DROP, ReferencePicker, type PickerAsset } from "@/components/reference-picker";
import { useCardDrag, type DropPoint } from "@/components/card-drag";
import { usePresence } from "@/components/use-presence";
import { readReferenceCache, writeReferenceCache } from "@/lib/reference-cache";
import { ModelPicker } from "@/components/model-picker";
import { PANEL_EDGES, useExpandablePanel } from "@/lib/expandable-panel";
import { uploadMedia } from "@/lib/direct-upload";
import { downloadFiles } from "@/lib/download-files";
import { applyPromptPreset } from "@/lib/prompt-preset";
import { PromptPresetBar, usePromptPreset } from "@/components/prompt-preset";

/** /api/models 返回的视频模型和生图模型 */
type CatalogModel = VideoModel | ImageModel;
/** 输入框里的素材:上传完成前用本地 blob 预览,上传完成后换成服务器路径(仍保留 blob 预览避免闪烁)。 */
type ComposerAttachment = MediaRef & { previewUrl?: string; uploading?: boolean; progress?: number };

const toMediaRef = (item: ComposerAttachment): MediaRef => ({
  kind: item.kind, path: item.path, name: item.name,
  ...(item.mimeType ? { mimeType: item.mimeType } : {}),
  ...(item.dataUrl ? { dataUrl: item.dataUrl } : {}),
});
/** 每一类(图片 / 视频)上次选的模型,切换类型时回到它 */
const LAST_MODEL_KEY = "mote.lastModel";
// 放大查看输入框里的素材:刚上传的用本地预览,其余图片用大图(WebP),视频、音频用原文件
const attachmentSrc = (item: ComposerAttachment) =>
  item.previewUrl || (item.kind === "image" ? `/api/media/${item.path}?view=1` : `/api/media/${item.path}`);

/** 读一张图片的宽高(「智能」视频比例用);读不到或超过 5 秒就不用它 */
function imageDimensions(src: string) {
  return new Promise<{ width: number; height: number } | undefined>((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(undefined), 5000);
    image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { clearTimeout(timer); resolve(undefined); };
    image.src = src;
  });
}
const revokePreview = (item: ComposerAttachment) => {
  if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
};

const videoDefaults: VideoOptions = {
  referenceMode: "references", ratio: "16:9", resolution: "720p", duration: 5,
  count: 1, audio: true, watermark: false, cameraFixed: false,
};
const MEDIA_KINDS: MediaKind[] = ["image", "video", "audio"];

/**
 * 所有本站接口都带上当前用户的 API Key(服务端据此区分用户数据)。
 * 浏览器层面的网络失败(fetch 直接抛 TypeError,即「Failed to fetch」)换成中文提示;
 * 读取类请求和幂等的保存(GET / PUT)先自动重试一次,提交生成等 POST 不重试,避免重复扣费。
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const send = () => fetch(url, { ...init, headers: { ...apiKeyHeaders(), ...init?.headers } });
  const method = (init?.method || "GET").toUpperCase();
  let response: Response;
  try {
    response = await send().catch(async (cause) => {
      if (!(cause instanceof TypeError) || (method !== "GET" && method !== "PUT")) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 800));
      return send();
    });
  } catch (cause) {
    if (cause instanceof TypeError) throw new Error(NETWORK_ERROR);
    throw cause;
  }
  const data = await response.json().catch(() => ({ error: `服务器返回异常（${response.status}），请稍后重试` }));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function freshConversation(model?: CatalogModel): Conversation {
  const now = new Date().toISOString();
  return {
    id: createClientId(), title: "新对话",
    providerId: TANGZHI_PROVIDER_ID, modelId: model?.id,
    createdAt: now, updatedAt: now,
    videoOptions: model?.type === "video" ? fitVideoOptions(model, videoDefaults) : videoDefaults,
    imageOptions: imageDefaults, messages: [],
  };
}

/** 同一套参数对象:切换模型时视频、生图参数各自保留 */
function withModel(conversation: Conversation, model: CatalogModel): Conversation {
  return {
    ...conversation, providerId: TANGZHI_PROVIDER_ID, modelId: model.id,
    videoOptions: model.type === "video" ? fitVideoOptions(model, conversation.videoOptions || videoDefaults) : conversation.videoOptions,
    imageOptions: model.type === "image" ? fitImageToModel(model, fitImageOptions(conversation.imageOptions))
      : fitImageOptions(conversation.imageOptions),
  };
}

export function AppShell() {
  const [models, setModels] = useState<CatalogModel[]>([]);
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
  // 批量管理生成记录:只对开始管理时的那个对话有效,换对话就自动退出
  const [turnSelection, setTurnSelection] = useState<{ conversationId?: string; ids: Set<string>; confirming: boolean; closing?: boolean }>(
    () => ({ ids: new Set(), confirming: false }));
  const lastPickedRef = useRef<string | null>(null);
  const { preset: promptPreset, save: savePromptPreset } = usePromptPreset();
  // 旧生成记录没有记下文件大小:从资产列表(带大小)查一次
  const [assetSizes, setAssetSizes] = useState<Record<string, number>>({});
  const assetSizesLoaded = useRef(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  // 输入框里已添加的素材放大查看(第几个)
  const [attachmentPreview, setAttachmentPreview] = useState<number | null>(null);
  const [referenceAssets, setReferenceAssets] = useState<(Asset & { kind: MediaKind })[]>([]);
  const [referenceFolders, setReferenceFolders] = useState<AssetFolder[]>([]);
  // 素材库列表:打开页面后先在后台读一次,点 @ 时直接用,同时再刷新一次(不用等它才弹出)
  const [referenceLoading, setReferenceLoading] = useState(false);
  // 列表是哪个 Key 读的:换了账号就不再显示上一个账号的素材
  const [referenceLoadedFor, setReferenceLoadedFor] = useState<string>();
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [customPrompts, setCustomPrompts] = useState<PromptTemplate[]>([]);
  const [promptLayout, setPromptLayout] = useState<PromptLayout>(emptyPromptLayout);
  const promptLayoutTimer = useRef<number | undefined>(undefined);
  const [groups, setGroups] = useState<ConversationGroup[]>([]);
  // 自定义中转站的域名;空 = 内置中转站
  const [relayHost, setRelayHost] = useState("");
  // 只填了图片 Key(没有视频 Key):视频入口不可用
  const [imageOnly, setImageOnly] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const { containerRef: kindSliderRef, indicator: kindIndicator } = useSlidingIndicator<HTMLDivElement>();
  const [optimizing, setOptimizing] = useState(false);
  // 优化前的输入框内容,可以一键撤销
  const [beforeOptimize, setBeforeOptimize] = useState<{ html: string; draft: string }>();
  // 从「对话」页带过来的提示词(/?compose=...&kind=image),模型和 Key 就绪后填进输入框
  const composeRef = useRef<{ prompt: string; kind: string } | null>(null);
  const [referencePickerPosition, setReferencePickerPosition] = useState<{ left: number; top?: number; bottom?: number; maxHeight?: number }>({ left: 10, top: 8 });
  const referenceRangeRef = useRef<Range | null>(null);
  const referenceAnchorRef = useRef<DOMRect | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // 放大编辑:输入框整个飞到屏幕中间,可拖边角调整大小
  const composerRef = useRef<HTMLDivElement>(null);
  const composerHolderRef = useRef<HTMLDivElement>(null);
  const composerPanel = useExpandablePanel({
    panelRef: composerRef, holderRef: composerHolderRef, storageKey: "mote.composerPanelSize",
    onOpened: () => focusEditorEnd(), onClosed: () => focusEditorEnd(),
  });
  const conversationRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  // 正在提交中的本地消息(用户消息、生成占位),服务端返回整份对话时要保留它们
  const inflightRef = useRef(new Set<string>());

  const active = conversations.find((item) => item.id === activeId);
  const videoModels = models.filter((item): item is VideoModel => item.type === "video");
  const imageModels = models.filter((item): item is ImageModel => item.type === "image");
  // 默认选第一个支持多种比例的视频模型(个别渠道只支持竖屏)
  const selected: CatalogModel | undefined = models.find((item) => item.id === active?.modelId) ||
    videoModels.find((item) => item.ratios.length > 1) || videoModels[0] || models[0];
  const videoModel = selected?.type === "video" ? selected : undefined;
  const imageModel = selected?.type === "image" ? selected : undefined;
  // 当前模型可用的参数:模型不支持的比例/分辨率/时长自动收回到可用值
  const videoOptions = videoModel ? fitVideoOptions(videoModel, active?.videoOptions || videoDefaults) : videoDefaults;
  const imageOptions = imageModel ? fitImageToModel(imageModel, fitImageOptions(active?.imageOptions)) : fitImageOptions(active?.imageOptions);
  // 生图只有「参考图」一种方式
  const mode = imageModel ? "references" : normalizeReferenceMode(videoOptions.referenceMode);
  const remainingFor = (kind: MediaKind, current: readonly Pick<MediaRef, "kind">[]) =>
    imageModel ? (kind === "image" ? Math.max(0, imageModel.maxReferences - current.length) : 0)
      : videoModel ? remainingMedia(videoModel, mode, current, kind) : 0;
  const remaining = Object.fromEntries(MEDIA_KINDS.map((kind) => [kind, remainingFor(kind, attachments)])) as Record<MediaKind, number>;
  const allowedKinds = MEDIA_KINDS.filter((kind) => remaining[kind] > 0);
  const remainingTotal = imageModel ? remaining.image : !videoModel ? 0 :
    mode === "first_last" ? remaining.image : Math.max(0, videoModel.limits.total - attachments.length);
  const uploadLimit = allowedKinds.length ? remainingTotal : 0;
  // 当前模式下这个模型能接受的素材类型(不看已选数量),决定 @ 选择框和上传入口
  const modeKinds = MEDIA_KINDS.filter((kind) => remainingFor(kind, []) > 0);
  const labels = referenceLabels(attachments);

  // 模型列表与个人数据分开加载:模型列表慢或失败不影响查看历史对话
  useEffect(() => {
    request<CatalogModel[]>("/api/models").then(setModels).catch((cause) => setError(cause.message));
  }, []);

  // 这台设备见过的分组 ID:保存时告诉服务端只改这些,别的设备新建的分组不会被覆盖掉
  const knownGroupIdsRef = useRef<Set<string>>(new Set());
  const rememberGroups = (list: readonly ConversationGroup[]) => list.forEach((group) => knownGroupIdsRef.current.add(group.id));

  const load = useCallback(async (key: string) => {
    if (!key) {
      // 没有 Key 就没有个人空间
      setConversations([]);
      setFavorites(new Set());
      setCustomPrompts([]);
      setPromptLayout(emptyPromptLayout());
      setGroups([]);
      setActiveId(undefined);
      await openSession("");
      return;
    }
    // 先显示这个账号上次的数据(浏览器缓存),不用等服务端;下面取到最新的再整体替换
    const apply = (snapshot: WorkspaceSnapshot) => {
      setFavorites(new Set(snapshot.favorites));
      setCustomPrompts(snapshot.prompts);
      setPromptLayout(snapshot.layout);
      knownGroupIdsRef.current = new Set(snapshot.groups.map((group) => group.id));
      setGroups(snapshot.groups);
      setConversations(snapshot.conversations);
      pickActive(snapshot.conversations);
    };
    const pickActive = (list: Conversation[]) => {
      if (!list.length) { setActiveId(undefined); return; }
      const requested = typeof window === "undefined" ? null :
        new URLSearchParams(window.location.search).get("conversation");
      setActiveId((id) =>
        requested && list.some((item) => item.id === requested)
          ? requested : id && list.some((item) => item.id === id) ? id : list[0].id);
    };
    const cached = readWorkspaceCache();
    if (cached) apply(cached);
    // 换看图片 / 视频用的 Cookie 和读数据同时进行,少等一轮
    const [, nextConversations, nextFavorites, nextPrompts, nextGroups, nextLayout] = await Promise.all([
      openSession(key),
      request<Conversation[]>("/api/conversations"),
      request<string[]>("/api/favorites").catch(() => []),
      request<PromptTemplate[]>("/api/prompts").catch(() => []),
      request<ConversationGroup[]>("/api/groups").catch(() => []),
      request<PromptLayout>("/api/prompt-library").catch(() => emptyPromptLayout()),
    ]);
    const fresh: WorkspaceSnapshot = {
      conversations: nextConversations, favorites: nextFavorites, prompts: nextPrompts, groups: nextGroups, layout: nextLayout,
    };
    writeWorkspaceCache(fresh);
    setFavorites(new Set(nextFavorites));
    setCustomPrompts(nextPrompts);
    setPromptLayout(nextLayout);
    knownGroupIdsRef.current = new Set(nextGroups.map((group) => group.id));
    setGroups(nextGroups);
    // 缓存显示期间本机刚建、还没存到服务端的对话先留着(和切回页面时的同步一样)
    setConversations((current) => {
      const serverIds = new Set(nextConversations.map((item) => item.id));
      const pending = cached ? current.filter((item) => !serverIds.has(item.id) && !cached.conversations.some((old) => old.id === item.id)) : [];
      return [...pending, ...nextConversations];
    });
    const requested = typeof window === "undefined" ? null :
      new URLSearchParams(window.location.search).get("conversation");
    setActiveId((id) => {
      if (requested && nextConversations.some((item) => item.id === requested)) return requested;
      // 缓存显示期间新建的对话(服务端还没有)保持打开
      const createdMeanwhile = id && cached && !cached.conversations.some((item) => item.id === id);
      if (id && (nextConversations.some((item) => item.id === id) || createdMeanwhile)) return id;
      return nextConversations[0]?.id;
    });
  }, []);

  // 切回这个标签页 / 窗口时,拉一次最新的对话和分组(另一台设备可能刚改过);15 秒内不重复拉
  const lastSyncRef = useRef(0);
  useEffect(() => {
    if (!apiKey) return;
    const sync = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastSyncRef.current < 15_000) return;
      lastSyncRef.current = Date.now();
      void Promise.all([
        request<Conversation[]>("/api/conversations"),
        request<ConversationGroup[]>("/api/groups"),
      ]).then(([serverConversations, serverGroups]) => {
        rememberGroups(serverGroups);
        setGroups(serverGroups);
        setConversations((current) => {
          const serverIds = new Set(serverConversations.map((item) => item.id));
          // 本机刚建、还没保存到服务端的对话先留着
          const pending = current.filter((item) => !serverIds.has(item.id) && Date.now() - new Date(item.createdAt).getTime() < 60_000);
          return [...pending, ...serverConversations.map((item) =>
            keepLocalMessages(item, current.find((local) => local.id === item.id), inflightRef.current))];
        });
        // 当前打开的对话保持不变;还没打开过对话时打开最新的一个
        setActiveId((id) => id || serverConversations[0]?.id);
      }).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [apiKey]);

  useEffect(() => {
    if (apiKey === undefined) return;
    const timer = window.setTimeout(() => load(apiKey).catch((cause) => setError(cause.message)), 0);
    return () => clearTimeout(timer);
  }, [load, apiKey]);
  useEffect(() => {
    const sync = () => {
      setApiKey(readApiKey());
      setImageOnly(isImageOnly());
      setRelayHost(readRelayBase().replace(/^https?:\/\//, ""));
    };
    const timer = window.setTimeout(sync, 0);
    const unsubscribe = onApiKeyChange(sync);
    return () => { clearTimeout(timer); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    const timer = window.setTimeout(() => setSidebarOpen(false), 0);
    return () => clearTimeout(timer);
  }, []);
  const activeMessages = conversations.find((item) => item.id === activeId)?.messages;
  const needsSizes = Boolean(activeMessages?.some((message) => message.role === "assistant" &&
    (message.media || []).some((media) => media.size === undefined)));
  useEffect(() => {
    if (!needsSizes || assetSizesLoaded.current || !readApiKey()) return;
    assetSizesLoaded.current = true;
    request<Asset[]>("/api/assets")
      .then((assets) => setAssetSizes(Object.fromEntries(assets.map((asset) => [asset.path, asset.size]))))
      .catch(() => { assetSizesLoaded.current = false; });
  }, [needsSizes]);
  useEffect(() => {
    if (turnSelection.conversationId === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable=true], [contenteditable='']");
      if (event.key === "Escape" && !event.defaultPrevented) {
        lastPickedRef.current = null;
        setTurnSelection((current) => ({ ...current, closing: true }));
        window.setTimeout(() => setTurnSelection((current) => current.closing ? { ids: new Set(), confirming: false } : current), 180);
      } else if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const ids = [...document.querySelectorAll<HTMLElement>("[data-turn-id]")].map((element) => element.dataset.turnId as string);
        setTurnSelection((current) => ({ ...current, confirming: false, ids: new Set(ids) }));
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [turnSelection.conversationId]);
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
    // 放大编辑时编辑区由面板撑开;按内容算高度只用于普通输入框(否则会把面板的高度带回来)
    if (composerPanel.expanded) return;
    editor.style.height = `${Math.min(Math.max(editor.scrollHeight, 84), 280)}px`;
  }, [draft, composerPanel.expanded]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prompt = params.get("compose");
    if (!prompt) return;
    composeRef.current = { prompt: prompt.slice(0, 6000), kind: params.get("kind") || "image" };
    params.delete("compose");
    params.delete("kind");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

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
    const pickerWidth = Math.min(680, window.innerWidth - 32);
    const leftOf = (rect: DOMRect) => Math.max(8, Math.min(rect.left - 14, window.innerWidth - pickerWidth - 8));
    const GAP = 10;
    const MARGIN = 8;
    // 放大编辑时编辑区几乎占满屏幕,不能按整个编辑区定位(上方放不下会被顶出屏幕):
    // 有光标就跟着光标,没有就贴着下面的 @ 按钮;上下哪边空间大放哪边,高度按剩下的空间收
    if (composer.classList.contains("is-expanded")) {
      const caret = savedAnchor && savedAnchor.height > 0 && savedAnchor.height < 80 ? savedAnchor : undefined;
      const anchor = caret || composer.querySelector(".reference-trigger")?.getBoundingClientRect() || markerRect;
      const below = window.innerHeight - anchor.bottom - GAP - MARGIN;
      const above = anchor.top - GAP - MARGIN;
      setReferencePickerPosition(caret && below >= 380 || below > above
        ? { left: leftOf(anchor), top: anchor.bottom + GAP, maxHeight: below }
        : { left: leftOf(anchor), bottom: window.innerHeight - anchor.top + GAP, maxHeight: above });
      return;
    }
    // 贴着输入框上沿弹出(用 bottom 锚定,内容多少都不会悬空);上方空间不够时改到输入框下方。
    const left = leftOf(markerRect);
    setReferencePickerPosition(composerRect.top > 240
      ? { left, bottom: window.innerHeight - composerRect.top + GAP, maxHeight: composerRect.top - GAP - MARGIN }
      : { left, top: composerRect.bottom + GAP, maxHeight: window.innerHeight - composerRect.bottom - GAP - MARGIN });
  }, []);

  const captureReferenceAnchor = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    // 只认输入框里的光标:之前在页面别处(比如卡片里的文字)点过时,选区还留在那里,弹框会跑过去
    const current = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    const range = current && editor?.contains(current.startContainer) ? current.cloneRange() : null;
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

  const referenceLoaded = Boolean(apiKey) && referenceLoadedFor === apiKey;
  // 这个账号的浏览器缓存已经用过了(之后以内存里的为准,不再拿旧缓存覆盖刚改的名字、分组)
  const referenceCacheUsedRef = useRef<string>(undefined);
  const loadReferenceAssets = useCallback(async () => {
    const key = readApiKey();
    // 先把上次缓存的列表放上(打开就有内容),再向服务端取最新的
    if (referenceCacheUsedRef.current !== key) {
      referenceCacheUsedRef.current = key;
      const cached = readReferenceCache();
      if (cached) {
        setReferenceAssets(cached.assets);
        setReferenceFolders(cached.folders);
        setReferenceLoadedFor(key);
      }
    }
    setReferenceLoading(true);
    try {
      const [assets, folders] = await Promise.all([
        // 精简列表:不读对话、不带提示词,数据小
        request<Asset[]>("/api/assets?view=picker"),
        request<AssetFolder[]>("/api/asset-folders").catch(() => undefined),
      ]);
      // 聊天里的文档附件不能当生成素材
      setReferenceAssets(assets.filter((asset): asset is Asset & { kind: MediaKind } => !asset.trashed && asset.kind !== "file"));
      if (folders) setReferenceFolders(folders);
      setReferenceLoadedFor(key);
    } finally {
      setReferenceLoading(false);
    }
  }, []);

  // 列表有变化(取到最新的、改名、分组、删除)就存一份到浏览器,下次打开先显示它
  useEffect(() => {
    if (referenceLoaded) writeReferenceCache({ assets: referenceAssets, folders: referenceFolders });
  }, [referenceLoaded, referenceAssets, referenceFolders]);

  // 有 Key 后在后台先读一次素材库,第一次点 @ 也不用等
  useEffect(() => {
    if (!apiKey || referenceLoaded) return;
    const timer = window.setTimeout(() => { void loadReferenceAssets().catch(() => undefined); }, 1500);
    return () => window.clearTimeout(timer);
  }, [apiKey, loadReferenceAssets, referenceLoaded]);

  const referencePresence = usePresence(referencePickerOpen);
  const closeReferencePicker = useCallback(() => {
    referenceRangeRef.current = null;
    referenceAnchorRef.current = null;
    setReferencePickerOpen(false);
  }, []);
  // 点选择框以外的地方(打开别的弹框、点页面)就收起,不和别的弹框叠在一起;输入框和 @ 按钮除外
  useEffect(() => {
    if (!referencePickerOpen) return;
    const pointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // 选择框里打开的放大预览挂在 body 上,点它不算点外面
      if (!target || editorRef.current?.contains(target) || target.closest?.(".reference-picker, .reference-trigger, .media-preview")) return;
      closeReferencePicker();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeReferencePicker();
    };
    document.addEventListener("mousedown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [referencePickerOpen, closeReferencePicker]);

  const openReferencePicker = () => {
    if (!modeKinds.length) return;
    if (referencePickerOpen) {
      referenceRangeRef.current = null;
      referenceAnchorRef.current = null;
      setReferencePickerOpen(false);
      return;
    }
    // 先用手上的列表马上弹出,再在后台刷新(期间新上传、新生成的会补进来)
    setReferencePickerOpen(true);
    void loadReferenceAssets().catch((cause) => {
      if (!referenceLoaded) setError((cause as Error).message);
    });
  };

  // 当前对话的素材实时并入(选择框打开期间新上传的也会出现);只列出当前模型和模式能用的素材类型。
  const libraryAssets = referenceLoaded ? referenceAssets : [];
  const libraryByPath = new Map(libraryAssets.map((asset) => [asset.path, asset]));
  const pickerAssets: PickerAsset[] = [
    ...attachments.filter((item) => !item.uploading).map((item) => {
      // 素材库里也有的,按素材库的记录(能改名、分组、删除)
      const known = libraryByPath.get(item.path);
      return {
        id: `current:${item.path}`, kind: item.kind, path: item.path, name: known?.name || item.name,
        mimeType: item.mimeType || "image/jpeg", folder: known?.folder, source: known?.source || "upload", managed: Boolean(known),
      };
    }),
    ...libraryAssets.map((asset) => ({ ...asset, managed: true })),
  ]
    .filter((asset) => modeKinds.includes(asset.kind))
    .filter((asset, index, list) => list.findIndex((candidate) => candidate.path === asset.path) === index);

  // ---- 在 @ 选择框里整理素材库:改名、删除(移到回收站)、分组 ----
  const reportError = (cause: unknown) => { setError((cause as Error).message); throw cause; };
  const patchAssets = (body: Record<string, unknown>) => request<{ name?: string; paths?: string[] }>("/api/assets", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const renameReference = (path: string, name: string) => patchAssets({ action: "rename", path, name }).then((result) => {
    const next = result.name || name;
    setReferenceAssets((items) => items.map((asset) => asset.path === path ? { ...asset, name: next } : asset));
    setAttachments((items) => items.some((item) => item.path === path)
      ? items.map((item) => item.path === path ? { ...item, name: next } : item) : items);
  }, reportError);
  const trashReferences = (paths: string[]) => patchAssets({ action: "trash", paths }).then(() => {
    const removed = new Set(paths);
    setReferenceAssets((items) => items.filter((asset) => !removed.has(asset.path)));
  }, reportError);
  const moveReferences = (paths: string[], folder: string | null) => patchAssets({ action: "move", paths, folder }).then(() => {
    const moved = new Set(paths);
    setReferenceAssets((items) => items.map((asset) => moved.has(asset.path) ? { ...asset, folder: folder || undefined } : asset));
  }, reportError);
  const createReferenceFolder = (name: string, paths: string[]) => request<AssetFolder>("/api/asset-folders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...(paths.length ? { paths } : {}) }),
  }).then((folder) => {
    setReferenceFolders((items) => [...items, folder]);
    const moved = new Set(paths);
    if (paths.length) setReferenceAssets((items) => items.map((asset) => moved.has(asset.path) ? { ...asset, folder: folder.id } : asset));
    return folder;
  }, reportError);
  const renameReferenceFolder = (id: string, name: string) => request<{ name: string }>("/api/asset-folders", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name }),
  }).then((result) => {
    setReferenceFolders((items) => items.map((folder) => folder.id === id ? { ...folder, name: result.name } : folder));
  }, reportError);
  /** 拖动调整文件夹顺序:先在界面上换好,再告诉服务端 */
  const reorderReferenceFolders = (order: string[]) => {
    setReferenceFolders((items) => {
      const byId = new Map(items.map((folder) => [folder.id, folder]));
      const sorted = order.map((id) => byId.get(id)).filter((folder): folder is AssetFolder => Boolean(folder));
      return [...sorted, ...items.filter((folder) => !order.includes(folder.id))];
    });
    return request("/api/asset-folders", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order }),
    }).catch(reportError);
  };
  const deleteReferenceFolder = (id: string) => request(`/api/asset-folders?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    .then(() => {
      setReferenceFolders((items) => items.filter((folder) => folder.id !== id));
      setReferenceAssets((items) => items.map((asset) => asset.folder === id ? { ...asset, folder: undefined } : asset));
    }, reportError);

  /** 输入框里松手位置对应的插入点(不在输入框里、或落在素材小卡片上时,放到最后 / 卡片后面) */
  const rangeAtPoint = (point: DropPoint) => {
    const editor = editorRef.current;
    if (!editor) return null;
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let range: Range | null = null;
    if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(point.x, point.y);
    else if (doc.caretPositionFromPoint) {
      const position = doc.caretPositionFromPoint(point.x, point.y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }
    if (!range || !editor.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      return range;
    }
    const node = range.startContainer;
    const card = (node instanceof HTMLElement ? node : node.parentElement)?.closest(`.${REFERENCE_CARD_CLASS}`);
    if (card) {
      range.setStartAfter(card);
      range.collapse(true);
    }
    return range;
  };

  /** 「图N」小卡片放到新位置后弹一下、外圈亮一下,看得出它落在哪 */
  const flashLanded = (card: HTMLElement) => {
    card.classList.remove("is-landed");
    // 重新触发动画:先让浏览器算一次样式
    void card.offsetWidth;
    card.classList.add("is-landed");
    window.setTimeout(() => card.classList.remove("is-landed"), 700);
  };

  /** 在插入点放「图N」素材小卡片(all:插入后的全部素材,用来算编号) */
  const insertReferenceCards = (items: readonly MediaRef[], all: readonly MediaRef[], range: Range | null) => {
    const editor = editorRef.current;
    if (!editor || !range || !items.length) return;
    editor.focus({ preventScroll: true });
    const labels = referenceLabels(all);
    for (const item of items) {
      const position = all.findIndex((entry) => entry.path === item.path);
      if (position < 0) continue;
      const card = createReferenceCard(item.path, item.name, labels[position], item.kind);
      range.insertNode(card);
      const spacer = document.createTextNode(" ");
      card.after(spacer);
      range.setStartAfter(spacer);
      range.collapse(true);
      flashLanded(card);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setDraft(editor.innerText);
  };

  // 提示词里的「图N」小卡片:按住拖到别处,松手就移到那里(是移动,不是复制)
  const movingCardRef = useRef<HTMLElement | null>(null);
  const inlineCardDrag = useCardDrag((target, paths, point) => {
    const card = movingCardRef.current;
    movingCardRef.current = null;
    const editor = editorRef.current;
    if (target !== EDITOR_DROP || !card || !editor?.contains(card) || !paths.length) return;
    const range = rangeAtPoint(point);
    if (!range || card.contains(range.startContainer)) return;
    // 原位置后面跟着的空格一起带走,免得留下两个空格
    const spacer = card.nextSibling?.nodeType === Node.TEXT_NODE && card.nextSibling.textContent === " " ? card.nextSibling : null;
    range.insertNode(card);
    const after = spacer ?? document.createTextNode(" ");
    card.after(after);
    range.setStartAfter(after);
    range.collapse(true);
    flashLanded(card);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setDraft(editor.innerText);
  });

  // 输入框里已有的素材(上面那一叠)拖到写提示词的地方:在松手处插入「图N」引用
  const attachmentDrag = useCardDrag((target, paths, point) => {
    if (target !== EDITOR_DROP) return;
    insertReferenceCards(attachments.filter((item) => paths.includes(item.path)), attachments, rangeAtPoint(point));
  });

  /**
   * 从 @ 选择框拖到输入框上:作为参考素材加进来(超出当前模型上限的跳过并提示),选择框不关,可以接着拖;
   * 拖到写提示词的地方(带 point)还会在松手处插入「图N」引用
   */
  const attachReferenceAssets = (assets: PickerAsset[], point?: DropPoint) => {
    const next = [...attachments];
    const skipped: string[] = [];
    for (const asset of assets) {
      if (next.some((item) => item.path === asset.path)) continue;
      if (!modeKinds.includes(asset.kind) || remainingFor(asset.kind, next) <= 0) { skipped.push(asset.name); continue; }
      if (videoModel && mode !== "first_last" && next.length >= videoModel.limits.total) { skipped.push(asset.name); continue; }
      next.push({ kind: asset.kind, path: asset.path, name: asset.name, mimeType: asset.mimeType });
    }
    if (next.length !== attachments.length) setAttachments(next);
    setError(skipped.length ? `${skipped.length} 个素材没有加入：当前模型不支持这种素材，或已达到素材上限` : "");
    if (point) insertReferenceCards(next.filter((item) => assets.some((asset) => asset.path === item.path)), next, rangeAtPoint(point));
  };

  // 「刚上传」一栏:输入框里现在这些自己上传的素材(带本地预览的就是从这台电脑传上去的;从素材库选的没有),
  // 最新的在上面;在输入框里删掉、清空就跟着没了(素材库里还在),再上传的直接顶上
  const recentUploads: PickerAsset[] = attachments
    .filter((item) => item.previewUrl && !item.uploading && modeKinds.includes(item.kind))
    .reverse()
    .map((item) => {
      const known = libraryByPath.get(item.path);
      return {
        id: `recent:${item.path}`, kind: item.kind, path: item.path, name: known?.name || item.name,
        mimeType: item.mimeType || "image/jpeg", folder: known?.folder, source: "upload", managed: true,
      };
    });

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

  /** 清空提示词:用编辑命令删除,误点了可以 Ctrl / ⌘ + Z 撤销 */
  const clearPrompt = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (!document.execCommand("delete")) editor.innerHTML = "";
    if (!editor.textContent && !editor.querySelector(`.${REFERENCE_CARD_CLASS}`)) editor.innerHTML = "";
    setDraft("");
    setBeforeOptimize(undefined);
  };

  const create = async (groupId?: string) => {
    const conversation: Conversation = { ...freshConversation(selected), ...(groupId ? { groupId } : {}) };
    // 在收起的分组里新建:先展开,新对话才看得见
    if (groupId && groups.some((group) => group.id === groupId && group.collapsed)) {
      saveGroups(groups.map((group) => group.id === groupId ? { ...group, collapsed: false } : group));
    }
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
    rememberGroups(next);
    // 合并保存:服务端保留这台设备不知道的分组(别的设备刚建的),返回合并后的完整列表
    void request<ConversationGroup[]>("/api/groups", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups: next, known: [...knownGroupIdsRef.current] }),
    }).then((merged) => {
      rememberGroups(merged);
      setGroups(merged);
    }).catch((cause) => setError((cause as Error).message));
  };

  const createGroup = (name: string) => {
    const group: ConversationGroup = { id: createClientId(), name };
    saveGroups([group, ...groups]);
    return group;
  };

  /** 输入框里换项目分组:当前对话直接移过去;还没有对话时新建一个放进去(不清空正在写的提示词) */
  const changeGroup = (groupId: string | undefined) => {
    if (active) {
      void moveConversations([active.id], groupId);
      return;
    }
    startConversationIn(groupId);
  };

  /** 在某个分组里开一个新对话并切过去;输入框里写的提示词和素材都留着(从输入框的分组选择里新建) */
  const startConversationIn = (groupId: string | undefined) => {
    const conversation: Conversation = { ...freshConversation(selected), ...(groupId ? { groupId } : {}) };
    if (groupId && groups.some((group) => group.id === groupId && group.collapsed)) {
      saveGroups(groups.map((group) => group.id === groupId ? { ...group, collapsed: false } : group));
    }
    setConversations((items) => [conversation, ...items]);
    setActiveId(conversation.id);
    void persist(conversation).catch((cause) => setError(cause.message));
  };

  const rename = async (conversation: Conversation, title: string) => {
    await persist({ ...conversation, title, updatedAt: new Date().toISOString() });
  };

  const chooseModel = async (modelId: string) => {
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    try { window.localStorage.setItem(`${LAST_MODEL_KEY}.${model.type}`, model.id); } catch { /* 只影响下次默认选哪个 */ }
    if (!active) {
      const conversation = freshConversation(model);
      await persist(conversation);
      setActiveId(conversation.id);
      return;
    }
    // 先切换界面,再在后台保存:不用等服务器返回
    const updated = { ...withModel(active, model), updatedAt: new Date().toISOString() };
    setConversations((items) => items.map((item) => item.id === updated.id ? updated : item));
    void persist(updated).catch((cause) => setError(cause.message));
  };

  /** 切换「图片 / 视频」:回到这一类上次用的模型,没有就用这个对话里最近用过的,再没有就用默认的 */
  const switchKind = (kind: "image" | "video") => {
    if (selected?.type === kind) return;
    const pool: CatalogModel[] = kind === "image" ? imageModels : videoModels;
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(`${LAST_MODEL_KEY}.${kind}`); } catch { /* 用默认 */ }
    const recent = active && [...active.messages].reverse().find((message) => message.generation?.type === kind)?.generation?.modelId;
    const model = pool.find((item) => item.id === saved) || pool.find((item) => item.id === recent)
      || (kind === "video" ? videoModels.find((item) => item.ratios.length > 1) : undefined) || pool[0];
    if (!model) { setError(kind === "image" ? "中转站暂无可用的生图模型" : "中转站暂无可用的视频模型"); return; }
    void chooseModel(model.id);
  };

  const changeGenerationOptions = (options: { videoOptions?: VideoOptions; imageOptions?: ImageOptions }) => {
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
    // 每个文件单独上传(同时进行):优先直传对象存储,单次请求也不会超过站点的上传上限
    const pending = selection.accepted.map(({ file, kind }) => ({
      file,
      item: {
        kind, path: `pending:${createClientId()}`, name: file.name, mimeType: file.type,
        previewUrl: URL.createObjectURL(file), uploading: true,
      } as ComposerAttachment,
    }));
    setAttachments((items) => [...items, ...pending.map((entry) => entry.item)]);
    await Promise.all(pending.map(async ({ file, item: placeholder }) => {
      // 进度只在变化超过 2% 时更新,避免频繁重渲染
      let shown = 0;
      const progress = (fraction: number) => {
        if (fraction - shown < 0.02 && fraction < 1) return;
        shown = fraction;
        setAttachments((items) => items.map((item) => item.path === placeholder.path ? { ...item, progress: fraction } : item));
      };
      try {
        const uploaded = await uploadMedia(file, request, progress);
        setAttachments((items) => items.map((item) =>
          item.path === placeholder.path ? { ...uploaded, previewUrl: item.previewUrl } : item));
      } catch (cause) {
        setAttachments((items) => items.filter((item) => item.path !== placeholder.path));
        revokePreview(placeholder);
        setError((cause as Error).message);
      }
    }));
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    event.preventDefault();
    if (files.length) {
      void upload(files);
      return;
    }
    // 从网页、文档里复制的文字带着字号、粗体、「不换行」等样式,原样粘进来会撑出横向滚动条:一律按纯文本插入
    const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    if (text) document.execCommand("insertText", false, text);
  };

  const send = () => {
    if (!selected || (!draft.trim() && !attachments.length)) return;
    const typed = editorRef.current
      ? serializePrompt(editorRef.current, attachments)
      : draft.trim();
    const prompt = applyPromptPreset(typed, promptPreset);
    if (uploading) {
      setError("素材还在上传，请稍候再发送");
      return;
    }
    composerPanel.close();
    return submit(prompt, attachments.map(toMediaRef), { clearComposer: true });
  };

  // 同一对话可以连续提交多个生成任务,不必等上一个完成
  const submit = async (
    prompt: string, usedAttachments: MediaRef[],
    { clearComposer, videoOptions, imageOptions: recordImageOptions, model = selected }: {
      clearComposer: boolean; videoOptions?: VideoOptions; imageOptions?: ImageOptions; model?: CatalogModel;
    },
  ) => {
    if (!model) return;
    let generation: GenerationMeta;
    let invalid: string;
    if (model.type === "image") {
      const options = fitImageOptions(recordImageOptions || active?.imageOptions);
      invalid = imageRequestError(model, prompt, options, usedAttachments);
      generation = { type: "image", providerName: TANGZHI_PROVIDER_NAME, modelName: model.id, modelId: model.id, imageOptions: options };
    } else {
      const fitted = fitVideoOptions(model, videoOptions || active?.videoOptions || videoDefaults);
      // 快照记录实际生成方式:没有素材时就是文生视频
      const options: VideoOptions = {
        ...fitted, referenceMode: effectiveReferenceMode(fitted.referenceMode, usedAttachments.length),
      };
      // 「智能」比例:按第一张参考图或提示词换成具体比例,记录和请求里都是换算后的比例
      if (options.ratio === "adaptive") {
        const image = usedAttachments.find((item) => item.kind === "image");
        options.ratio = smartVideoRatio(model.ratios, prompt, image ? await imageDimensions(`/api/media/${image.path}`) : undefined);
      }
      invalid = videoRequestError(model, prompt, options, usedAttachments);
      generation = { type: "video", providerName: TANGZHI_PROVIDER_NAME, modelName: model.id, modelId: model.id, videoOptions: options };
    }
    if (!apiKey) {
      setError("请先在「设置」中填写中转站 API Key");
      return;
    }
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
      replyTo: user.id, generation,
    };
    inflightRef.current.add(user.id);
    inflightRef.current.add(pendingMessage.id);
    let conversationId = active?.id;
    try {
      if (!active) {
        const created = await persist(freshConversation(model));
        conversationId = created.id;
        setActiveId(created.id);
      }
      const id = conversationId as string;
      setConversations((items) => items.map((item) => item.id !== id ? item : {
        ...item,
        title: item.messages.length ? item.title : (prompt || (model.type === "image" ? "图片生成" : "视频生成")).slice(0, 28),
        providerId: TANGZHI_PROVIDER_ID, modelId: model.id, updatedAt: now,
        messages: [...item.messages, user, pendingMessage],
      }));
      const result = await request<{ conversation: Conversation; assistant: Message }>("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiKeyHeaders(apiKey) },
        body: JSON.stringify({
          conversationId: id, userMessageId: user.id, modelId: model.id,
          prompt, attachments: usedAttachments, videoOptions: generation.videoOptions, imageOptions: generation.imageOptions,
        }),
      });
      inflightRef.current.delete(user.id);
      inflightRef.current.delete(pendingMessage.id);
      setConversations((items) => items.map((item) => item.id !== id ? item :
        patchMessage({
          ...item, title: result.conversation.title, providerId: result.conversation.providerId,
          modelId: result.conversation.modelId, videoOptions: result.conversation.videoOptions,
          imageOptions: result.conversation.imageOptions,
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
  const deleteTurn = (messageId: string, userMessageId?: string) =>
    deleteMessages([messageId, userMessageId].filter((id): id is string => Boolean(id)));

  const deleteMessages = (removed: string[]) => {
    if (!active || !removed.length) return;
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

  /** 生成记录用的模型:当前选的模型类型不同时,换回记录里的模型(已下线就用同类第一个) */
  const modelForRecord = (generation?: GenerationMeta): CatalogModel | undefined => {
    if (!generation || generation.type === "chat" || selected?.type === generation.type) return selected;
    return models.find((item) => item.id === generation.modelId && item.type === generation.type) ||
      (generation.type === "image" ? imageModels[0] : videoModels[0]);
  };

  /** 记录里用的那个模型本身(已下线时为空) */
  const recordedModel = (generation?: GenerationMeta): CatalogModel | undefined =>
    generation && generation.type !== "chat"
      ? models.find((item) => item.id === generation.modelId && item.type === generation.type) : undefined;

  /**
   * 把记录的模型和参数放回输入框(一次保存,避免两次保存互相覆盖)。
   * exact:换回记录里的那个模型(重新编辑时);否则同类模型时保留当前选的(拿生成的图当参考图时)
   */
  const restoreSettings = (generation?: GenerationMeta, exact = false) => {
    const model = (exact ? recordedModel(generation) : undefined) || modelForRecord(generation);
    if (!active || !model || !generation) return;
    const updated = {
      ...withModel({
        ...active,
        ...(generation.videoOptions ? { videoOptions: generation.videoOptions } : {}),
        ...(generation.imageOptions ? { imageOptions: generation.imageOptions } : {}),
      }, model),
      updatedAt: new Date().toISOString(),
    };
    setConversations((items) => items.map((item) => item.id === updated.id ? updated : item));
    void persist(updated).catch((cause) => setError(cause.message));
  };

  const focusEditorEnd = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  /** 生成的图片带去做视频:切到最近用过的视频模型,把图片作为参考图(或首帧) */
  const makeVideoFrom = (image: MediaRef) => {
    if (!active) return;
    const recent = [...active.messages].reverse().find((message) => message.generation?.type === "video")?.generation?.modelId;
    const model = videoModels.find((item) => item.id === recent) || videoModels.find((item) => item.ratios.length > 1) || videoModels[0];
    if (!model) { setError("中转站暂无可用的视频模型"); return; }
    attachments.forEach(revokePreview);
    setAttachments([toMediaRef(image)]);
    const updated = { ...withModel(active, model), updatedAt: new Date().toISOString() };
    setConversations((items) => items.map((item) => item.id === updated.id ? updated : item));
    void persist(updated).catch((cause) => setError(cause.message));
    setError("");
    focusEditorEnd();
  };

  /** 生成的图片作为参考图继续改:保持生图模型 */
  const attachImageAsReference = (image: MediaRef, generation?: GenerationMeta) => {
    const model = selected?.type === "image" ? selected : modelForRecord(generation);
    if (selected?.type !== "image") restoreSettings(generation);
    const limit = model?.type === "image" ? model.maxReferences : 4;
    const kept = attachments.filter((item) => item.kind === "image" && item.path !== image.path);
    if (kept.length >= limit) { setError(`最多 ${limit} 张参考图`); return; }
    setAttachments([...kept, toMediaRef(image)]);
    setError("");
    focusEditorEnd();
  };

  const reedit = (prompt: string, references: MediaRef[], generation?: GenerationMeta) => {
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
    // 模型、比例、分辨率、时长、生成方式等全部换回这条记录当时用的
    restoreSettings(generation, true);
    focusEditorEnd();
  };

  /** 把提示词放进输入框;[图1] 这类标记还原成素材小卡片 */
  const fillEditor = (prompt: string, references: readonly MediaRef[]) => {
    const editor = editorRef.current;
    if (!editor) return;
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
    focusEditorEnd();
  };

  const optimizePrompt = async () => {
    const editor = editorRef.current;
    if (!editor || !selected || optimizing) return;
    const prompt = serializePrompt(editor, attachments).trim();
    if (!prompt) { setError("先写一点想法，再让 AI 帮你扩写"); return; }
    if (!effectiveAssistKey()) { setError("请先在「设置」中填写中转站 API Key"); return; }
    setOptimizing(true);
    setError("");
    try {
      // 用「提示词优化」的 Key(没单独填时先用聊天的,再用视频的 Key)
      const result = await request<{ prompt: string; model: string }>("/api/prompt-assist", {
        method: "POST", headers: { ...assistKeyHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, kind: selected.type, model: readAssistModel() || undefined }),
      });
      setBeforeOptimize({ html: editor.innerHTML, draft });
      fillEditor(result.prompt, attachments);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setOptimizing(false);
    }
  };

  const undoOptimize = () => {
    const editor = editorRef.current;
    if (!editor || !beforeOptimize) return;
    editor.innerHTML = beforeOptimize.html;
    setDraft(beforeOptimize.draft);
    setBeforeOptimize(undefined);
    focusEditorEnd();
  };

  // 从「对话」带来的生图提示词:新开一个对话,切到生图模型并填好(不会自动生成)
  useEffect(() => {
    const pending = composeRef.current;
    if (!pending || !models.length || apiKey === undefined) return;
    composeRef.current = null;
    const model = pending.kind === "video" ? videoModels.find((item) => item.ratios.length > 1) || videoModels[0] : imageModels[0];
    if (!model) { setError(pending.kind === "video" ? "中转站暂无可用的视频模型" : "中转站暂无可用的生图模型"); return; }
    const conversation = { ...freshConversation(model), title: pending.prompt.slice(0, 28) || "新对话" };
    setConversations((items) => [conversation, ...items]);
    setActiveId(conversation.id);
    if (apiKey) void persist(conversation).catch((cause) => setError(cause.message));
    window.setTimeout(() => fillEditor(pending.prompt, []), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, apiKey]);

  const closeLibrary = useCallback(() => setLibraryOpen(false), []);

  const saveCustomPrompt = async (input: CustomPromptInput) => {
    const saved = await request<PromptTemplate>("/api/prompts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    setCustomPrompts((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    return saved;
  };

  const deleteCustomPrompts = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await request(`/api/prompts?${ids.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`, { method: "DELETE" });
      setCustomPrompts((items) => items.filter((item) => !ids.includes(item.id)));
    } catch (cause) { setError((cause as Error).message); }
  };

  /** 分组、排序、隐藏等布局改动立即生效,停手 400ms 后再保存 */
  const changePromptLayout = (next: PromptLayout) => {
    setPromptLayout(next);
    window.clearTimeout(promptLayoutTimer.current);
    if (!apiKey) return;
    promptLayoutTimer.current = window.setTimeout(() => {
      void request("/api/prompt-library", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      }).catch((cause) => setError(`提示词库布局保存失败：${(cause as Error).message}`));
    }, 400);
  };

  const applyPromptTemplate = (template: PromptTemplate, mode: PromptUseMode, applyParams: boolean) => {
    setPromptLayout((layout) => recordUsage(layout, template.id));
    if (apiKey) {
      void request("/api/prompt-library", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ use: template.id }),
      }).catch(() => undefined);
    }
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
    if (applyParams && imageModel && template.ratio && parseRatio(template.ratio)) {
      changeGenerationOptions({ imageOptions: { ...imageOptions, ratio: template.ratio } });
    }
    if (applyParams && videoModel) {
      const selected = videoModel;
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
        setConversations((items) => items.map((item) => patches
          .filter((patch) => patch.conversationId === item.id)
          .reduce((conversation, patch) => patchMessage(conversation, patch.message), item)));
      }
      if (failure) {
        setError(`查询任务状态失败，稍后自动重试：${(failure as Error).message}`);
        setPollFailures((count) => count + 1);
      } else {
        setPollFailures(0);
      }
    }, Math.min(5000 * 2 ** pollFailures, 30_000));
    return () => clearTimeout(timer);
  }, [pendingKey, pollFailures, conversations]);

  const turns = active ? buildTurns(active.messages, isGenerationTurn) : [];
  const taskTurns = turns.filter((turn) => turn.kind !== "message");
  const managing = Boolean(active) && turnSelection.conversationId === active?.id;
  const pickedTurns = managing ? taskTurns.filter((turn) => turnSelection.ids.has(turn.message.id)) : [];
  const allPicked = taskTurns.length > 0 && pickedTurns.length === taskTurns.length;
  const pickedProcessing = pickedTurns.some((turn) => turn.message.status === "processing");

  const startManaging = () => {
    lastPickedRef.current = null;
    setTurnSelection({ conversationId: active?.id, ids: new Set(), confirming: false });
  };
  /** 退出:先播放收起动画再真正退出 */
  const stopManaging = () => {
    lastPickedRef.current = null;
    setTurnSelection((current) => ({ ...current, closing: true }));
    window.setTimeout(() => setTurnSelection((current) => current.closing ? { ids: new Set(), confirming: false } : current), 180);
  };
  /** 点选;按住 Shift 从上次点的那张连选到这张 */
  const togglePick = (id: string, range: boolean) => {
    const order = taskTurns.map((turn) => turn.message.id);
    const anchorId = lastPickedRef.current;
    lastPickedRef.current = id;
    setTurnSelection((current) => {
      const ids = new Set(current.ids);
      const anchor = anchorId ? order.indexOf(anchorId) : -1;
      const target = order.indexOf(id);
      if (range && anchor >= 0 && target >= 0) {
        const on = !current.ids.has(id);
        const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
        for (const item of order.slice(from, to + 1)) {
          if (on) ids.add(item);
          else ids.delete(item);
        }
      } else if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { ...current, ids, confirming: false };
    });
  };
  const pickAll = (on: boolean) => setTurnSelection((current) => ({
    ...current, confirming: false, ids: on ? new Set(taskTurns.map((turn) => turn.message.id)) : new Set(),
  }));
  const downloadPicked = () => {
    const files = pickedTurns.flatMap((turn) => (turn.message.media || [])
      .filter((item) => item.kind === (isImageRecord(turn.message) ? "image" : "video")));
    if (!files.length) { setError("选中的记录里还没有生成好的图片或视频"); return; }
    setError("");
    void downloadFiles(files);
  };
  const deletePicked = () => {
    deleteMessages(pickedTurns.flatMap((turn) => [turn.message.id, turn.user?.id].filter((id): id is string => Boolean(id))));
    setTurnSelection((current) => ({ ...current, ids: new Set(), confirming: false }));
  };

  return (
    <main className="app-frame">
      <div className={`side-panels ${sidebarOpen ? "is-open" : ""}`}>
      <nav className="app-rail" aria-label="主导航">
        <button type="button" className="rail-logo" onClick={() => void create()} aria-label="新建对话" title="新建对话">
          <LogoMark size={30} />
        </button>
        <div className="rail-items">
          <Link className="rail-item is-active" href="/" aria-current="page"><CreateIcon /><span>创作</span></Link>
          <Link className="rail-item" href="/assets"><AssetsIcon /><span>资产</span></Link>
          {/* 聊天是同域名下的另一个程序,整页跳转 */}
          <a className="rail-item" href="/chat"><ChatIcon /><span>聊天</span></a>
        </div>
        <div className="rail-items rail-bottom">
          <Link className="rail-item" href="/docs"><DocsIcon /><span>文档</span></Link>
          <Link className="rail-item" href="/settings"><SettingsIcon /><span>设置</span></Link>
        </div>
      </nav>
      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="wordmark" onClick={() => void create()} aria-label="新建对话" title="新建对话">TZ生成工作台</button>
          <div className="sidebar-head-actions">
            <button className="icon-button" onClick={() => setSearchOpen(true)}
              aria-label="搜索对话" title="搜索对话 · ⌘ K">
              <SearchIcon size={17} />
            </button>
            <button className="icon-button desktop-only" onClick={() => setSidebarOpen(false)} aria-label="收起侧栏" title="收起侧栏">
              <PanelLeftClose size={17} />
            </button>
          </div>
        </div>
        <button className="new-chat" onClick={() => void create()}><Plus size={16} /> 新对话</button>
        <ConversationList conversations={conversations} groups={groups} activeId={activeId}
          onOpen={(id) => { setActiveId(id); closeSidebarOnMobile(); }}
          onRename={(conversation, title) => void rename(conversation, title)}
          onDelete={removeConversations} onMove={moveConversations}
          onGroupsChange={saveGroups} onCreateGroup={createGroup}
          onCreateInGroup={(groupId) => void create(groupId)} />
      </aside>
      </div>

      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" />}

      <section className="workspace">
        <header className="topbar">
          {!sidebarOpen && <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏" title="打开侧栏">
            <Menu size={18} />
          </button>}
          {videoModel && <span className="model-spec" title={videoModel.description}>
            <b>{videoModel.id}</b>
            <span>{videoModel.resolutions.map((item) => item.toUpperCase()).join(" / ")}</span>
            <span>{durationSummary(videoModel.durations)}</span>
            <span>{videoModel.limits.images}图 · {videoModel.limits.videos}视频 · {videoModel.limits.audios}音频 · 合计≤{videoModel.limits.total}</span>
            <span>{formatPrice(videoModel, videoOptions.resolution)}</span>
          </span>}
          {imageModel && <span className="model-spec" title={imageModel.description}>
            <b>{imageModel.id}</b>
            <span>生图</span>
            {imageModel.resolutions.length < 3 && <span>{imageModel.resolutions.map((item) => item.toUpperCase()).join(" / ")}</span>}
            <span>{imageModel.maxReferences ? `最多 ${imageModel.maxReferences} 张参考图` : "仅文生图"}</span>
            <span title="价格与中转站后台同步">{imageModel.priceDetail}</span>
          </span>}
          {!apiKey && <Link className="key-missing" href="/settings"><KeyRound size={13} />填写 API Key</Link>}
          {/* 顶栏右侧,和左边的模型规格条同一行 */}
          {(managing || taskTurns.length > 0) && <button type="button" className={`topbar-manage ${managing && !turnSelection.closing ? "active" : ""}`}
            onClick={managing ? stopManaging : startManaging} title={managing ? "退出批量管理（Esc）" : "批量选择、下载、删除生成记录"}>
            <ListChecks size={14} />{managing ? "完成" : "批量管理"}
          </button>}
          <BackToTop scrollRootRef={conversationRef} resetKey={active?.id} />
          <ThemeQuickPicker />
        </header>

        <div className="conversation" ref={conversationRef}>
          {!active?.messages.length ? (
            <div className="empty-state" key={active?.id || "new"}>
              <LogoMark size={44} className="empty-mark" />
              <h1>今天，想创造什么？</h1>
              {apiKey
                ? <EmptyStatePrompt type={selected?.type || "video"} />
                : <p>先到设置里填写 {TANGZHI_PROVIDER_NAME} 中转站的 API Key，然后开始。</p>}
              {!apiKey && <Link className="text-link" href="/settings">前往设置 <span>↗</span></Link>}
              {selected && (
                <button type="button" className="empty-library-link" data-prompt-library-trigger
                  onClick={() => setLibraryOpen(true)}><BookMarked size={14} />从提示词库开始</button>
              )}
            </div>
          ) : (
            // 换对话时整列重新挂载,带一次淡入
            <div className="message-list" key={active.id}>
              {(() => {
                let lastDate = "";
                return turns.map((turn) => {
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
                  const image = isImageRecord(message);
                  const mediaPaths = (message.media || []).filter((item) => item.kind === (image ? "image" : "video")).map((item) => item.path);
                  const favorite = mediaPaths.length > 0 && mediaPaths.every((path) => favorites.has(path));
                  const date = localDate(message.createdAt);
                  const showDate = date !== lastDate;
                  lastDate = date;
                  const generation = message.generation;
                  const shared = {
                    prompt, references, message, favorite,
                    onReedit: () => reedit(prompt, references, generation),
                    onRegenerate: () => void submit(prompt, references, {
                      clearComposer: false, videoOptions: generation?.videoOptions, imageOptions: generation?.imageOptions,
                      // 用这条记录当时的模型重新生成(已下线才退回同类模型),不跟着输入框当前选的模型走
                      model: recordedModel(generation) || modelForRecord(generation),
                    }),
                    onToggleFavorite: () => void toggleFavorite(mediaPaths, !favorite),
                    onDelete: () => deleteTurn(message.id, userMessage?.id),
                    sizes: assetSizes,
                  };
                  const picked = managing && turnSelection.ids.has(message.id);
                  return (
                    <div key={message.id}>
                      {showDate && <div className="task-date">{date}</div>}
                      <div className={`task-pick ${managing ? "is-managing" : ""} ${picked ? "is-picked" : ""} ${turnSelection.closing ? "is-closing" : ""}`} data-turn-id={message.id}>
                        {managing && <button type="button" className={`task-check ${picked ? "is-on" : ""}`}
                          aria-pressed={picked} aria-label={picked ? "取消选择这条记录" : "选择这条记录"}
                          onClick={(event) => togglePick(message.id, event.shiftKey)}>
                          <Check size={13} strokeWidth={3} />
                        </button>}
                        {image
                          ? <ImageTaskCard {...shared} fallbackModelName={imageModel?.id}
                            onMakeVideo={makeVideoFrom}
                            onUseAsReference={(media) => attachImageAsReference(media, generation)} />
                          : <VideoTaskCard {...shared} fallbackModelName={videoModel?.id} />}
                        {/* 管理时点卡片任意位置都是选择,不会误点到播放、编辑等按钮 */}
                        {managing && <button type="button" className="task-pick-overlay" tabIndex={-1} aria-hidden="true"
                          onClick={(event) => togglePick(message.id, event.shiftKey)} />}
                      </div>
                    </div>
                  );
                });
              })()}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        <ConversationNavigator messages={active?.messages || []} scrollRootRef={conversationRef} />

        <div className={`composer-region ${draggingImages ? "drag-active" : ""} ${managing && !turnSelection.closing ? "is-managing" : ""} ${turnSelection.closing ? "is-returning" : ""}`}
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
            onSaveCustom={saveCustomPrompt} onDeleteCustom={deleteCustomPrompts}
            layout={promptLayout} onLayoutChange={changePromptLayout} />
          {error && <div className="inline-error">{readableError(error)}<button onClick={() => setError("")}><X size={13} /></button></div>}
          {composerPanel.floating && (
            <div className={`composer-backdrop ${composerPanel.closing ? "is-closing" : ""}`} onClick={composerPanel.close}
              aria-hidden="true" />
          )}
          <div className="composer-holder" ref={composerHolderRef} style={composerPanel.holderStyle}>
          <div className={`composer ${composerPanel.floating ? "is-floating" : ""} ${composerPanel.expanded ? "is-expanded" : ""}`}
            ref={composerRef} style={composerPanel.panelStyle}
            // @ 选择框里的素材可以拖到输入框上作为参考素材(见 card-drag.tsx)
            data-drop-target={COMPOSER_DROP} data-drop-external
            role={composerPanel.expanded ? "dialog" : undefined} aria-label={composerPanel.expanded ? "放大编辑提示词" : undefined}>
            {composerPanel.expanded && <>
              <div className="composer-expand-head" onPointerDown={composerPanel.startMove}>
                <strong>编辑提示词</strong>
                <span>{[...draft.trim()].length} 字 · Enter 换行 · Ctrl / ⌘ + Enter 发送 · Esc 收起</span>
                {draft.trim() && <button type="button" className="composer-expand-clear" onClick={clearPrompt}
                  title="清空提示词（Ctrl / ⌘ + Z 可撤销）"><X size={13} />清空</button>}
                <button type="button" className="icon-button" onClick={composerPanel.close} aria-label="收起" title="收起（Esc）">
                  <Minimize2 size={15} />
                </button>
              </div>
              {PANEL_EDGES.map((edge) => (
                <span key={edge} className="panel-resize" data-edge={edge} onPointerDown={composerPanel.startResize(edge)} aria-hidden="true" />
              ))}
            </>}
            {/* 输入框上方:预设的前缀、后缀,发送时自动补上 */}
            {selected && <PromptPresetBar preset={promptPreset} onChange={savePromptPreset} />}
            <div className="composer-body">
              {attachments.length > 0 && (
                <div className="attachment-stack" aria-label={`${attachments.length} 个参考素材`}
                  style={{ "--count": attachments.length + 1 } as React.CSSProperties}>
                  {attachments.map((item, index) => (
                    <div className={`stack-card kind-${item.kind} ${item.uploading ? "is-uploading" : ""}`} key={item.path}
                      title={item.uploading ? `正在上传 · ${item.name}` : `点击放大 · ${labels[index]} · ${item.name}`}
                      role="button" tabIndex={0} aria-label={`放大查看 ${labels[index]}`}
                      // 点卡片放大查看;右上角的 × 是删除,不触发放大
                      onClick={(event) => { if (!(event.target as HTMLElement).closest(".stack-card-remove")) setAttachmentPreview(index); }}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setAttachmentPreview(index); } }}
                      // 按住拖到写提示词的地方,插入「图N」引用
                      onPointerDown={(event) => { if (!item.uploading) attachmentDrag.begin(event, item, [item.path]); }}
                      style={{ "--i": index, "--r": `${stackTilt(index)}deg` } as React.CSSProperties}>
                      <MediaThumb media={item} src={item.previewUrl} alt={item.name} />
                      {item.uploading && <span className="stack-card-spinner" aria-label="上传中" />}
                      {item.uploading && item.progress !== undefined && (
                        <span className="stack-card-progress" aria-label={`已上传 ${Math.round(item.progress * 100)}%`}>
                          <i style={{ width: `${Math.round(item.progress * 100)}%` }} />
                        </span>
                      )}
                      <span className="stack-card-index">{labels[index]}</span>
                      <button type="button" className="stack-card-remove" data-no-drag onClick={() => {
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
              {attachmentDrag.overlay}
              {inlineCardDrag.overlay}
              {attachmentPreview !== null && attachments[attachmentPreview] && (
                <MediaPreview
                  items={attachments.map((item, index) => ({
                    kind: item.kind, name: item.name, src: attachmentSrc(item), caption: `${labels[index]} · ${item.name}`,
                    preview: item.kind === "image" && !item.previewUrl ? thumbUrl(item.path, 480) : undefined,
                    original: item.kind === "image" && !item.previewUrl ? `/api/media/${item.path}` : undefined,
                  }))}
                  index={attachmentPreview} onIndex={setAttachmentPreview} onClose={() => setAttachmentPreview(null)} />
              )}
              {attachments.length === 0 && modeKinds.length > 0 && (
                <button type="button" className="reference-tile" onClick={() => fileRef.current?.click()}
                  title={`上传${modeKinds.map((kind) => MEDIA_KIND_LABEL[kind]).join(" / ")}，也可以直接拖进来或粘贴`}
                  aria-label={`添加${referenceTileLabel(mode, modeKinds)}`}>
                  <Plus size={18} strokeWidth={1.8} />
                  <span>{referenceTileLabel(mode, modeKinds)}</span>
                  <small>{modeKinds.map((kind) => MEDIA_KIND_SHORT[kind]).join("/")}</small>
                </button>
              )}
              <div ref={editorRef} className="composer-editor" contentEditable suppressContentEditableWarning role="textbox" aria-label="提示词"
                data-drop-target={EDITOR_DROP} data-drop-external
                onPointerDown={(event) => {
                  const card = (event.target as HTMLElement).closest<HTMLElement>(`.${REFERENCE_CARD_CLASS}`);
                  if (!card || event.button !== 0) return;
                  // 不让浏览器开始选文字 / 自带的拖动
                  event.preventDefault();
                  const kind = (card.dataset.kind as MediaRef["kind"] | undefined) || "image";
                  const path = card.dataset.path || "";
                  movingCardRef.current = card;
                  inlineCardDrag.begin(event, { kind, path, name: card.title || card.dataset.label || "" }, path ? [path] : [], card);
                }}
                onDragStart={(event) => {
                  if ((event.target as HTMLElement).closest?.(`.${REFERENCE_CARD_CLASS}`)) event.preventDefault();
                }}
                data-placeholder={imageModel
                  ? attachments.length ? "描述想怎样修改或组合这些图片，输入 @ 引用参考图…" : "描述你想要的画面、风格和构图；添加参考图可按图修改"
                  : attachments.length ? "描述画面、运动和镜头，输入 @ 引用素材…" :
                    "描述画面、运动、镜头和氛围；添加素材可按参考图或首尾帧生成"}
                onPaste={handlePaste}
                onKeyDown={(event) => {
                  if (event.key === "@" && !event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    captureReferenceAnchor();
                    openReferencePicker();
                    return;
                  }
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  // 放大编辑时 Enter 换行、Ctrl / ⌘ + Enter 发送;平时 Enter 发送、Shift + Enter 换行
                  if (composerPanel.expanded && !event.ctrlKey && !event.metaKey) {
                    if (!event.shiftKey) { event.preventDefault(); document.execCommand("insertLineBreak"); }
                    return;
                  }
                  if (!event.shiftKey) { event.preventDefault(); send(); }
                }}
                onInput={(event) => {
                  const editor = event.currentTarget;
                  // 删光文字后浏览器常留下一个 <br>,:empty 不再成立,占位提示就不显示了
                  if (!editor.textContent && !editor.querySelector(`.${REFERENCE_CARD_CLASS}`)) editor.innerHTML = "";
                  setDraft(editor.innerText);
                  setBeforeOptimize(undefined);
                }} />
              <div className="composer-corner">
                {draft.trim() && <button type="button" className="composer-clear" onClick={clearPrompt}
                  aria-label="清空提示词" title="清空提示词（Ctrl / ⌘ + Z 可撤销）"><X size={15} /></button>}
                {!composerPanel.expanded && <button type="button" className="composer-clear composer-expand"
                  onClick={composerPanel.open} aria-label="放大编辑提示词" title="放大编辑"><Maximize2 size={14} /></button>}
              </div>
            </div>
            <div className="composer-tools">
              <input ref={fileRef} type="file" accept={acceptAttribute(allowedKinds)} multiple hidden
                onChange={(event) => {
                  void upload(event.target.files ? [...event.target.files] : []);
                  event.target.value = "";
                }} />
              <button className={`icon-button reference-trigger ${referencePickerOpen ? "active" : ""}`} onClick={() => {
                captureReferenceAnchor();
                openReferencePicker();
              }}
                disabled={!modeKinds.length} aria-label="选择参考内容" title="选择本地参考内容">
                <AtSign size={18} />
              </button>
              {selected && (
                <button type="button" className={`icon-button prompt-library-trigger ${libraryOpen ? "active" : ""}`}
                  data-prompt-library-trigger onClick={() => {
                    // 提示词库贴在原输入框上方:放大编辑时先收起
                    if (composerPanel.expanded) composerPanel.close();
                    setLibraryOpen((open) => !open);
                  }}
                  aria-label="提示词库" aria-expanded={libraryOpen} title="提示词库">
                  <BookMarked size={18} />
                </button>
              )}
              {selected && (
                <button type="button" className={`icon-button prompt-optimize ${optimizing ? "active" : ""}`}
                  onClick={() => void optimizePrompt()} disabled={optimizing || !draft.trim()}
                  aria-label="优化提示词" title={draft.trim() ? "用 AI 把提示词扩写得更完整" : "先写一点想法，再让 AI 扩写"}>
                  {optimizing ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
                </button>
              )}
              {beforeOptimize && !optimizing && (
                <button type="button" className="optimize-undo" onClick={undoOptimize} title="恢复优化前的提示词">
                  <Undo2 size={13} />撤销优化
                </button>
              )}
              {models.length > 0 && <div className="kind-switch has-slider" role="radiogroup" aria-label="生成类型"
                ref={kindSliderRef}>
                {kindIndicator}
                {([["image", "图片", ImageIcon], ["video", "视频", Clapperboard]] as const).map(([kind, label, Icon]) => (
                  <button type="button" key={kind} role="radio" aria-checked={selected?.type === kind}
                    className={selected?.type === kind ? "selected" : ""}
                    disabled={!(kind === "image" ? imageModels : videoModels).length}
                    title={kind === "video" && imageOnly ? "还没有填写视频的 Key：到「设置」填写后才能生成视频" : undefined}
                    onClick={() => switchKind(kind)}><Icon size={13} />{label}</button>
                ))}
              </div>}
              <ModelPicker
                models={selected?.type === "image" ? imageModels : selected?.type === "video" ? videoModels : models}
                value={selected?.id || ""} imageResolution={imageOptions.resolution}
                onChange={(value) => void chooseModel(value)} />
              {videoModel && <VideoControls key={videoModel.id} value={videoOptions} model={videoModel}
                attachmentCount={attachments.length}
                onChange={(next) => changeGenerationOptions({ videoOptions: next })} />}
              {imageModel && <ImageControls key={imageModel.id} value={imageOptions} model={imageModel}
                onChange={(next) => changeGenerationOptions({ imageOptions: next })} />}
              <GroupPicker groups={groups} conversations={conversations} activeId={active?.id}
                onOpen={setActiveId} onCreateIn={startConversationIn} onMoveCurrent={changeGroup} onCreateGroup={createGroup} />
              <span className="composer-spacer">{attachmentSummary(mode, attachments)}</span>
              <button className="send-button" onClick={send}
                disabled={!selected || uploading || (!draft.trim() && !attachments.length)}
                aria-label="发送" title="发送（生成中也可以继续提交）">
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            </div>
            {referencePresence.mounted && <ReferencePicker style={referencePickerPosition} closing={referencePresence.closing} assets={pickerAssets}
              folders={referenceFolders} loading={referenceLoading && !referenceLoaded}
              isAttached={(path) => attachments.some((item) => item.path === path)}
              recent={recentUploads} onUpload={() => fileRef.current?.click()}
              onPick={selectReferenceAsset} onAttach={attachReferenceAssets} onClose={closeReferencePicker}
              onRename={renameReference} onTrash={trashReferences} onMove={moveReferences}
              onCreateFolder={createReferenceFolder} onRenameFolder={renameReferenceFolder} onDeleteFolder={deleteReferenceFolder}
              onReorderFolders={reorderReferenceFolders} />}
          </div>
          </div>
          <p className="composer-note">由 {relayHost || `${TANGZHI_PROVIDER_NAME} `}中转站生成 · Enter 发送，Shift + Enter 换行</p>
        </div>
        {/* 批量管理时暂时代替输入框(输入框里写了一半的内容保留着) */}
        {managing && <div className={`task-selection-bar ${turnSelection.closing ? "is-closing" : ""}`} role="toolbar" aria-label="批量管理生成记录">
          <span className="task-selection-count">
            {pickedTurns.length ? <>已选 <b>{pickedTurns.length}</b> 条</> : "点卡片选择 · Shift 连选"}
          </span>
          <button type="button" onClick={() => pickAll(!allPicked)}>{allPicked ? "取消全选" : `全选 ${taskTurns.length}`}</button>
          <span className="task-selection-sep" />
          {turnSelection.confirming ? <>
            <span className="task-selection-warn">
              删除 {pickedTurns.length} 条记录？{pickedProcessing ? "生成中的任务仍会继续计费" : "生成的文件仍保留在资产里"}
            </span>
            <button type="button" onClick={() => setTurnSelection((current) => ({ ...current, confirming: false }))}>取消</button>
            <button type="button" className="danger" onClick={deletePicked}><Trash2 size={14} /> 确认删除</button>
          </> : <>
            <button type="button" disabled={!pickedTurns.length} onClick={downloadPicked}
              title="多个文件会逐个下载；浏览器询问「下载多个文件」时请选择允许">
              <Download size={14} /> 下载
            </button>
            <button type="button" className="danger-text" disabled={!pickedTurns.length}
              onClick={() => setTurnSelection((current) => ({ ...current, confirming: true }))}>
              <Trash2 size={14} /> 删除记录
            </button>
          </>}
          <button type="button" className="task-selection-close" aria-label="退出批量管理" onClick={stopManaging}><X size={15} /></button>
        </div>}
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

const MEDIA_KIND_SHORT: Record<MediaKind, string> = { image: "图片", video: "视频", audio: "音频" };

/** 输入框左边上传卡片的名字:首尾帧、参考图(只收图片)或参考内容(还收视频 / 音频) */
function referenceTileLabel(mode: string, kinds: readonly MediaKind[]) {
  if (mode === "first_last") return "首尾帧";
  return kinds.some((kind) => kind !== "image") ? "参考内容" : "参考图";
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
      <div className="message-meta">{message.role === "user" ? "你" : "TZ"}</div>
      <div className="message-body">
        {(onReedit || onDelete) && <div className="message-actions">
          {onReedit && <button type="button" onClick={onReedit} title="放回输入框重新编辑"><Pencil size={13} />重新编辑</button>}
          {onDelete && <button type="button" className={confirmDelete ? "danger" : ""} title="删除这条提示词"
            onClick={() => { if (confirmDelete) onDelete(); else setConfirmDelete(true); }}>
            <Trash2 size={13} />{confirmDelete ? "再点一次删除" : "删除"}</button>}
        </div>}
        {message.attachments?.length ? <div className="media-grid">
          {message.attachments.map((media) => <MediaThumb key={media.path} media={media} alt={media.name} width={480} />)}
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
          <PosterVideo key={media.path} controls path={media.path} />
        ) : (
          <ThumbImage className="generated-image" key={media.path} path={media.path} width={1080} alt={media.name} />
        ))}
      </div>
    </article>
  );
}
