"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import Link from "next/link";
import {
  ArrowDownWideNarrow, ArrowLeft, ArrowUpNarrowWide, Check, CheckSquare, Download, Image as ImageIcon, Images, Music,
  FileText, Paperclip, RotateCcw, Search, Sparkles, Star, Trash2, Upload, Video, X, XCircle,
} from "lucide-react";
import type { Asset, AssetFolder } from "@/lib/asset-store";
import { AssetMenu } from "@/components/asset-menu";
import { useSlidingIndicator } from "@/components/sliding-indicator";
import { apiKeyHeaders, openSession, readApiKey } from "@/lib/api-key";
import { uploadMedia } from "@/lib/direct-upload";
import { downloadFiles, mediaDownloadUrl } from "@/lib/download-files";
import { acceptAttribute, MEDIA_KIND_LABEL, pickMediaFiles } from "@/lib/media-files";
import { readableError } from "@/lib/network-error";
import type { MediaRef } from "@/lib/types";
import { PosterVideo, ThumbImage } from "@/components/media-thumb";
import { useCardDrag } from "@/components/card-drag";
import { ALL_FOLDERS, FolderBar, NEW_FOLDER, UNGROUPED } from "@/components/folder-bar";
import { Dropdown } from "@/components/dropdown";
import { BackToTop } from "@/components/back-to-top";

type Filter = "all" | Asset["kind"] | "favorite" | "trash";
type Source = "all" | "generated" | "upload";
type Sort = "newest" | "oldest";
type UploadItem = { id: string; name: string; kind: MediaRef["kind"]; progress: number; error?: string; file: File };

/** 按提示词、对话标题、文件名搜索(多个关键词用空格分开,需全部命中) */
export function matchAsset(asset: Pick<Asset, "prompt" | "conversationTitle" | "name">, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = [asset.prompt, asset.conversationTitle, asset.name].filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

const retentionDays = Number(process.env.NEXT_PUBLIC_RETENTION_DAYS) || 0;
const retentionNote = retentionDays ? `文件保留 ${retentionDays} 天，请及时下载需要长期保存的内容。` : "";
const UNLIMITED = { image: Infinity, video: Infinity, audio: Infinity };
const ACCEPT = acceptAttribute(["image", "video", "audio"]);
/** 同时上传的文件数 */
const UPLOAD_WORKERS = 3;

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...apiKeyHeaders(), ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "请求失败");
  return data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const downloadUrl = (asset: Asset) => mediaDownloadUrl(asset);

/**
 * 资产页(scope="assets":生成结果和资产页上传的素材)和聊天的附件页(scope="chat":聊天里上传的图片)共用这一套:
 * 筛选、搜索、收藏、批量选择 / 下载 / 删除、回收站都一样;附件页不能上传,也不分来源。
 */
export function AssetLibrary({ scope = "assets" }: { scope?: "assets" | "chat" }) {
  const chat = scope === "chat";
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [source, setSource] = useState<Source>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectionClosing, setSelectionClosing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  // 文件夹(和输入框 @ 选择素材里的是同一份)
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [folder, setFolder] = useState(ALL_FOLDERS);
  const [renaming, setRenaming] = useState<{ path: string; text: string }>();
  const lastClicked = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 筛选按钮的选中底色滑到新选项,而不是瞬间跳过去
  const { containerRef: filterSliderRef, indicator: filterIndicator } = useSlidingIndicator<HTMLDivElement>(":scope > .active");
  const { containerRef: sourceSliderRef, indicator: sourceIndicator } = useSlidingIndicator<HTMLDivElement>(":scope > .active");

  const loadAssets = useCallback(async () => {
    const [all, folderList] = await Promise.all([
      request<Asset[]>(chat ? "/api/assets?scope=chat" : "/api/assets"),
      request<AssetFolder[]>(chat ? "/api/asset-folders?scope=chat" : "/api/asset-folders").catch(() => undefined),
    ]);
    setAssets(all.filter((asset) => chat ? asset.source === "chat" : asset.source !== "chat"));
    if (folderList) setFolders(folderList);
  }, [chat]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!readApiKey()) {
        setError("请先在设置中填写中转站 API Key，才能查看你的资产");
        return;
      }
      openSession().then(loadAssets).catch((cause) => setError(cause.message));
    }, 0);
    return () => clearTimeout(timer);
  }, [loadAssets]);

  const folderIds = useMemo(() => new Set(folders.map((item) => item.id)), [folders]);
  // 正在看的文件夹被删掉了就回到「全部」;回收站里不按文件夹分
  const currentFolder = filter === "trash" || !(folder === ALL_FOLDERS || folder === UNGROUPED || folderIds.has(folder))
    ? ALL_FOLDERS : folder;
  const inFolder = useCallback((asset: Asset, id: string) => {
    if (id === ALL_FOLDERS) return true;
    const own = asset.folder && folderIds.has(asset.folder) ? asset.folder : undefined;
    return id === UNGROUPED ? !own : own === id;
  }, [folderIds]);

  const visible = useMemo(() => {
    const filtered = filter === "trash"
      ? assets.filter((asset) => asset.trashed)
      : filter === "favorite"
        ? assets.filter((asset) => !asset.trashed && asset.favorite)
        : assets.filter((asset) => !asset.trashed && (filter === "all" || asset.kind === filter));
    const direction = sort === "newest" ? -1 : 1;
    return filtered
      .filter((asset) => source === "all" || (source === "upload") === (asset.source === "upload"))
      .filter((asset) => inFolder(asset, currentFolder))
      .filter((asset) => matchAsset(asset, query))
      .sort((a, b) => direction * a.createdAt.localeCompare(b.createdAt));
  }, [assets, filter, source, query, sort, inFolder, currentFolder]);
  const activeAssets = assets.filter((asset) => !asset.trashed);
  const hasAudio = activeAssets.some((asset) => asset.kind === "audio");
  // 批量操作只作用于当前筛选下看得到的已选项
  const chosen = visible.filter((asset) => selected.has(asset.path));
  const allChosen = visible.length > 0 && chosen.length === visible.length;
  const inTrash = filter === "trash";

  /** 退出选择:操作栏先播放收起动画 */
  const exitSelecting = () => {
    setSelectionClosing(true);
    setConfirmingDelete(false);
    lastClicked.current = null;
    window.setTimeout(() => {
      setSelecting(false);
      setSelected(new Set());
      setSelectionClosing(false);
    }, 180);
  };

  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable=true]");
      if (event.key === "Escape" && !event.defaultPrevented) {
        setSelectionClosing(true);
        setConfirmingDelete(false);
        window.setTimeout(() => {
          setSelecting(false);
          setSelected(new Set());
          setSelectionClosing(false);
        }, 180);
      } else if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(new Set(visible.map((asset) => asset.path)));
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selecting, visible]);

  /** 点选;按住 Shift 从上次点的那个连选到这个 */
  const toggleSelect = (asset: Asset, event?: MouseEvent) => {
    setSelecting(true);
    setConfirmingDelete(false);
    setSelected((current) => {
      const next = new Set(current);
      const anchor = lastClicked.current ? visible.findIndex((item) => item.path === lastClicked.current) : -1;
      const target = visible.findIndex((item) => item.path === asset.path);
      if (event?.shiftKey && anchor >= 0 && target >= 0) {
        const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
        const on = !current.has(asset.path);
        for (const item of visible.slice(from, to + 1)) {
          if (on) next.add(item.path);
          else next.delete(item.path);
        }
      } else if (next.has(asset.path)) next.delete(asset.path);
      else next.add(asset.path);
      return next;
    });
    lastClicked.current = asset.path;
  };

  const toggleFavorite = async (asset: Asset) => {
    setError("");
    const favorite = !asset.favorite;
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, favorite } : item));
    try {
      await request("/api/favorites", jsonInit("PUT", { paths: [asset.path], favorite }));
    } catch (cause) {
      setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, favorite: !favorite } : item));
      setError((cause as Error).message);
    }
  };

  /** 移入回收站 / 恢复 / 永久删除,单个和批量共用 */
  const mutate = async (targets: readonly Asset[], action: "trash" | "restore" | "delete") => {
    if (!targets.length) return;
    setError("");
    setNotice("");
    setBusy(true);
    const paths = targets.map((asset) => asset.path);
    try {
      if (action === "delete") {
        const result = await request<{ paths: string[]; failed: { path: string; error: string }[] }>(
          "/api/assets", jsonInit("DELETE", { paths }));
        if (result.failed.length) setError(`有 ${result.failed.length} 个文件没删掉：${result.failed[0].error}`);
        else if (paths.length > 1) setNotice(`已永久删除 ${result.paths.length} 个资产`);
      } else {
        await request("/api/assets", jsonInit("PATCH", { action, paths }));
        if (paths.length > 1) setNotice(action === "trash" ? `已把 ${paths.length} 个资产移入回收站` : `已恢复 ${paths.length} 个资产`);
      }
      setSelected((current) => {
        const next = new Set(current);
        paths.forEach((path) => next.delete(path));
        return next;
      });
      setConfirmingDelete(false);
      await loadAssets();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---------- 文件夹 ----------
  const moveTo = async (paths: string[], target: string | null) => {
    if (!paths.length) return;
    setError("");
    const previous = assets;
    const moved = new Set(paths);
    setAssets((items) => items.map((item) => moved.has(item.path) ? { ...item, folder: target || undefined } : item));
    try {
      await request("/api/assets", jsonInit("PATCH", { action: "move", paths, folder: target }));
      const name = target ? folders.find((item) => item.id === target)?.name : "未分组";
      setNotice(`已把 ${paths.length} 个资产移到「${name || "文件夹"}」`);
    } catch (cause) {
      setAssets(previous);
      setError((cause as Error).message);
    }
  };
  const createFolder = async (name: string, paths: string[] = []) => {
    setError("");
    try {
      const created = await request<AssetFolder>("/api/asset-folders", jsonInit("POST", {
        name, ...(paths.length ? { paths } : {}), ...(chat ? { scope: "chat" } : {}),
      }));
      setFolders((items) => [...items, created]);
      if (paths.length) {
        const moved = new Set(paths);
        setAssets((items) => items.map((item) => moved.has(item.path) ? { ...item, folder: created.id } : item));
        setNotice(`已新建文件夹「${created.name}」，放进 ${paths.length} 个资产`);
      }
      setFolder(created.id);
    } catch (cause) { setError((cause as Error).message); }
  };
  const renameFolder = async (id: string, name: string) => {
    setError("");
    try {
      const result = await request<{ name: string }>("/api/asset-folders", jsonInit("PATCH", { id, name }));
      setFolders((items) => items.map((item) => item.id === id ? { ...item, name: result.name } : item));
    } catch (cause) { setError((cause as Error).message); }
  };
  const deleteFolders = async (ids: string[]) => {
    setError("");
    try {
      for (const id of ids) await request(`/api/asset-folders?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const gone = new Set(ids);
      setFolders((items) => items.filter((item) => !gone.has(item.id)));
      setAssets((items) => items.map((item) => item.folder && gone.has(item.folder) ? { ...item, folder: undefined } : item));
      if (gone.has(folder)) setFolder(ALL_FOLDERS);
      setNotice(`已删除 ${ids.length} 个文件夹，里面的资产回到「未分组」`);
    } catch (cause) { setError((cause as Error).message); }
  };

  // 卡片式拖动:拖到文件夹上就移进去(选择模式下拖已选中的一张,带着全部选中的一起走)
  const cardDrag = useCardDrag((target, paths) => {
    if (target === NEW_FOLDER) void createFolder(`新文件夹 ${folders.length + 1}`, paths);
    else void moveTo(paths, target === UNGROUPED ? null : target);
  });

  // ---------- 改名 ----------
  const saveRename = async () => {
    const edit = renaming;
    if (!edit) return;
    setRenaming(undefined);
    const asset = assets.find((item) => item.path === edit.path);
    const text = edit.text.trim();
    if (!asset || !text || text === asset.name || text === asset.name.replace(/\.[a-z0-9]{1,6}$/i, "")) return;
    try {
      const result = await request<{ name: string }>("/api/assets", jsonInit("PATCH", { action: "rename", path: edit.path, name: text }));
      setAssets((items) => items.map((item) => item.path === edit.path ? { ...item, name: result.name } : item));
    } catch (cause) { setError((cause as Error).message); }
  };

  const downloadChosen = async () => {
    if (!chosen.length) return;
    setNotice(chosen.length > 1 ? `正在下载 ${chosen.length} 个文件；浏览器询问「下载多个文件」时请选择允许` : "");
    await downloadFiles(chosen);
  };

  // ---------- 上传 ----------
  const patchUpload = (id: string, patch: Partial<UploadItem>) =>
    setUploads((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));

  const runUpload = async (item: UploadItem) => {
    patchUpload(item.id, { progress: 0, error: undefined });
    try {
      const ref = await uploadMedia(item.file, request, (fraction) => patchUpload(item.id, { progress: fraction }));
      const asset = await request<Asset>("/api/assets", jsonInit("POST", {
        path: ref.path, name: ref.name || item.name, mimeType: ref.mimeType || item.file.type,
      }));
      setAssets((current) => [asset, ...current.filter((existing) => existing.path !== asset.path)]);
      setUploads((items) => items.filter((entry) => entry.id !== item.id));
    } catch (cause) {
      patchUpload(item.id, { error: readableError((cause as Error).message) });
    }
  };

  const startUploads = (files: readonly File[]) => {
    if (!files.length) return;
    if (!readApiKey()) {
      setError("请先在设置中填写中转站 API Key，才能上传素材");
      return;
    }
    const { accepted, error: rejected } = pickMediaFiles(files, UNLIMITED);
    setError(rejected ? `${rejected}，这些文件已跳过` : "");
    setNotice("");
    if (!accepted.length) return;
    const items: UploadItem[] = accepted.map(({ file, kind }) => ({
      id: crypto.randomUUID(), name: file.name || "upload", kind, progress: 0, file,
    }));
    setUploads((current) => [...current, ...items]);
    // 回到能看到新素材的视图
    if (filter === "trash" || filter === "favorite") setFilter("all");
    if (source === "generated") setSource("all");
    const queue = [...items];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await runUpload(item);
    };
    void Promise.all(Array.from({ length: Math.min(UPLOAD_WORKERS, queue.length) }, worker));
  };

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      startUploads(Array.from(event.dataTransfer.files));
    },
  };

  const kindLabel = (kind: Asset["kind"]) => (kind === "file" ? "文档" : MEDIA_KIND_LABEL[kind]);
  const emptyState = query ? <>
    <Search size={24} />
    <h2>没有找到匹配的资产</h2>
    <p>换个关键词试试，可以搜提示词里的词、对话标题或文件名。</p>
  </> : filter === "favorite" ? <>
    <Star size={24} />
    <h2>还没有收藏</h2>
    <p>在对话的任务卡片或资产卡片上点击星标，收藏的作品会集中出现在这里。</p>
  </> : filter === "trash" ? <>
    <Trash2 size={24} />
    <h2>回收站是空的</h2>
    <p>移入回收站的资产会暂存在这里，可以恢复或永久删除。</p>
  </> : chat ? <>
    <Paperclip size={24} />
    <h2>还没有附件</h2>
    <p>在聊天里上传的图片、PDF、Word、Excel、PPT 和文本文件会自动保存到这里。</p>
  </> : source === "upload" ? <>
    <Upload size={24} />
    <h2>还没有上传素材</h2>
    <p>点击「上传素材」或把文件拖进来；上传后在输入框里按 @ 就能引用。</p>
  </> : <>
    <Images size={24} />
    <h2>还没有资产</h2>
    <p>完成一次图片或视频生成后结果会自动出现在这里，也可以直接上传素材。</p>
  </>;

  return <main className={`utility-page asset-page ${dragging ? "is-dragging" : ""}`} {...(chat ? {} : dropHandlers)}>
    <header className="utility-topbar">
      {/* 聊天是同域名下的另一个程序,整页跳回去 */}
      {chat
        ? <a href="/chat" className="back-link"><ArrowLeft size={17} /> 返回聊天</a>
        : <Link href="/" className="back-link"><ArrowLeft size={17} /> 返回对话</Link>}
      <span>{chat ? "TZ Chat Files" : "TZ Assets"}</span>
    </header>
    <div className="asset-content">
      <div className="asset-heading">
        <span className="eyebrow">{chat ? "CHAT FILES" : "MY LIBRARY"}</span>
        <h1>{chat ? "附件" : "资产"}</h1>
        <p>{chat
          ? "你在聊天里上传的图片和文档都保存在这里，其他用户看不到；永久删除后，聊天记录里的这张图片也会无法显示。"
          : "你的账号生成的图片、视频，以及你上传的素材都在这里，其他用户看不到；上传的素材在输入框里按 @ 就能引用。"}{retentionNote}</p>
      </div>
      <div className="asset-toolbar-row">
        <div className="asset-toolbar has-slider" aria-label="资产筛选" ref={filterSliderRef}>
          {filterIndicator}
          {([
            ["all", "全部", Images],
            ["image", "图片", ImageIcon],
            // 聊天附件是图片和文档,没有视频 / 音频
            ...(chat ? [["file", "文档", FileText] as const] : [["video", "视频", Video] as const]),
            ...(!chat && (hasAudio || filter === "audio") ? [["audio", "音频", Music] as const] : []),
            ["favorite", "收藏", Star],
            ["trash", "回收站", Trash2],
          ] as const).map(([value, label, Icon]) =>
            <button key={value} className={filter === value ? "active" : ""}
              onClick={() => { setFilter(value); setConfirmingDelete(false); }}>
              <Icon size={14} /> {label}
              <span>{value === "all" ? activeAssets.length :
                value === "trash" ? assets.filter((asset) => asset.trashed).length :
                  value === "favorite" ? activeAssets.filter((asset) => asset.favorite).length :
                    activeAssets.filter((asset) => asset.kind === value).length}</span>
            </button>)}
        </div>
        <div className="asset-tools">
          <label className="asset-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={chat ? "搜索文件名" : "搜索提示词、对话标题、文件名"} aria-label={chat ? "搜索附件" : "搜索资产"} />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={13} /></button>}
          </label>
          <button type="button" className="asset-sort" onClick={() => setSort((value) => value === "newest" ? "oldest" : "newest")}
            title="切换排序" aria-label={`按时间排序：${sort === "newest" ? "最新在前" : "最早在前"}`}>
            {sort === "newest" ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}
            {sort === "newest" ? "最新在前" : "最早在前"}
          </button>
        </div>
      </div>
      <div className="asset-subbar">
        {chat ? <span /> : <div className="asset-source-filter has-slider" role="group" aria-label="按来源筛选" ref={sourceSliderRef}>
          {sourceIndicator}
          {([["all", "全部来源"], ["generated", "AI 生成"], ["upload", "我上传的"]] as const).map(([value, label]) =>
            <button key={value} type="button" className={source === value ? "active" : ""} aria-pressed={source === value}
              onClick={() => setSource(value)}>
              {value === "generated" && <Sparkles size={12} />}
              {value === "upload" && <Upload size={12} />}
              {label}
              <span>{value === "all" ? activeAssets.length
                : activeAssets.filter((asset) => (asset.source === "upload") === (value === "upload")).length}</span>
            </button>)}
        </div>}
        <div className="asset-subbar-actions">
          <button type="button" className={`asset-select-toggle ${selecting ? "active" : ""}`} disabled={!visible.length && !selecting}
            onClick={() => (selecting ? exitSelecting() : setSelecting(true))}>
            <CheckSquare size={14} /> {selecting ? "完成" : "选择"}
          </button>
          {!chat && <button type="button" className="asset-upload-button" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> 上传素材
          </button>}
          <input ref={fileInputRef} type="file" multiple accept={ACCEPT} hidden
            onChange={(event) => { startUploads(Array.from(event.target.files || [])); event.target.value = ""; }} />
        </div>
      </div>
      {filter !== "trash" && <FolderBar className="asset-folder-bar" folders={folders} active={currentFolder} onSelect={setFolder}
        countOf={(id) => assets.filter((asset) => !asset.trashed && inFolder(asset, id)).length}
        dragging={Boolean(cardDrag.drag)} dropTarget={cardDrag.dropTarget} landed={cardDrag.landed}
        onCreate={(name) => void createFolder(name)} onRename={(id, name) => void renameFolder(id, name)}
        onDelete={(ids) => void deleteFolders(ids)} />}
      {query && !error && <p className="asset-result-count">找到 {visible.length} 个匹配「{query.trim()}」的{chat ? "附件" : "资产"}</p>}
      {error && <div className="settings-error">{readableError(error)}</div>}
      {notice && <p className="asset-notice">{notice}</p>}
      {uploads.length > 0 && <ul className="asset-uploads" aria-label="上传进度">
        {uploads.map((item) => <li key={item.id} className={item.error ? "is-error" : ""}>
          <span className="asset-upload-kind">{kindLabel(item.kind)}</span>
          <span className="asset-upload-name" title={item.name}>{item.name}</span>
          {item.error
            ? <>
              <span className="asset-upload-error" title={item.error}>{item.error}</span>
              <button type="button" onClick={() => void runUpload(item)}>重试</button>
              <button type="button" aria-label="移除" onClick={() => setUploads((items) => items.filter((entry) => entry.id !== item.id))}>
                <X size={13} />
              </button>
            </>
            : <>
              <span className="asset-upload-bar"><i style={{ transform: `scaleX(${Math.max(0.02, item.progress)})` }} /></span>
              <span className="asset-upload-percent">{Math.round(item.progress * 100)}%</span>
            </>}
        </li>)}
      </ul>}
      {!error && visible.length === 0 && !uploads.length ? <div className="asset-empty">
        {emptyState}
        {chat
          ? <a href="/chat">去聊天</a>
          : source === "upload" || (!query && filter === "all")
            ? <button type="button" onClick={() => fileInputRef.current?.click()}>上传素材</button>
            : <Link href="/">开始创作</Link>}
      </div> : <div className={`asset-grid ${selecting && !selectionClosing ? "is-selecting" : ""}`}>
        {visible.map((asset) => {
          const isSelected = selected.has(asset.path);
          const uploaded = asset.source === "upload";
          const fromChat = asset.source === "chat";
          const lifted = cardDrag.drag?.phase === "drag" && cardDrag.drag.paths.includes(asset.path);
          return <article className={`asset-card ${isSelected ? "is-selected" : ""} ${lifted ? "is-lifted" : ""}`} key={asset.id}
            onPointerDown={(event) => {
              if (asset.trashed || renaming?.path === asset.path) return;
              const paths = selecting && selected.has(asset.path) ? chosen.map((item) => item.path) : [asset.path];
              cardDrag.begin(event, asset, paths);
            }}>
            <div className={`asset-preview ${asset.kind === "audio" ? "is-audio" : ""} ${asset.kind === "file" ? "is-file" : ""}`}
              title={asset.prompt || asset.name}>
              <button type="button" className={`asset-check ${isSelected ? "is-on" : ""}`} aria-pressed={isSelected}
                aria-label={isSelected ? `取消选择 ${asset.name}` : `选择 ${asset.name}`}
                onClick={(event) => toggleSelect(asset, event)}>
                <Check size={13} strokeWidth={3} />
              </button>
              {!asset.trashed && !selecting && <button type="button" className={`asset-star ${asset.favorite ? "is-on" : ""}`}
                onClick={() => void toggleFavorite(asset)} aria-pressed={Boolean(asset.favorite)}
                aria-label={asset.favorite ? "取消收藏" : "收藏"} title={asset.favorite ? "取消收藏" : "收藏"}>
                <Star size={15} fill={asset.favorite ? "currentColor" : "none"} />
              </button>}
              {asset.kind === "file"
                // 文档:大号扩展名 + 文件名,点开在新标签页预览(PDF、文本浏览器能直接看)
                ? <a className="asset-file" href={`/api/media/${asset.path}`} target="_blank" rel="noreferrer">
                  <FileText size={30} />
                  <b>{(asset.name.split(".").pop() || "文件").toUpperCase()}</b>
                  <span>{asset.name}</span>
                </a>
                : asset.kind === "video"
                ? <PosterVideo controls={!selecting} path={asset.path} />
                : asset.kind === "audio"
                  ? <><Music size={30} /><audio controls={!selecting} preload="none" src={`/api/media/${asset.path}`} /></>
                  : <ThumbImage path={asset.path} width={480} alt={asset.name} />}
              {selecting && <button type="button" className="asset-select-overlay" tabIndex={-1} aria-hidden="true"
                onClick={(event) => { if (!cardDrag.justDropped()) toggleSelect(asset, event); }} />}
            </div>
            <div className="asset-details">
              <div>
                <strong>
                  {kindLabel(asset.kind)}
                  <em className={`asset-origin ${uploaded || fromChat ? "is-upload" : ""}`}>{fromChat ? "聊天附件" : uploaded ? "上传" : "AI 生成"}</em>
                </strong>
                <span>{formatSize(asset.size)} · {new Date(asset.createdAt).toLocaleString("zh-CN")}</span>
              </div>
              <a className="asset-download" href={downloadUrl(asset)} download={asset.name}
                aria-label={`下载 ${asset.name}`}><Download size={15} /></a>
              <AssetMenu name={asset.name} trashed={Boolean(asset.trashed)}
                onRename={() => setRenaming({ path: asset.path, text: asset.name.replace(/\.[a-z0-9]{1,6}$/i, "") })}
                onTrash={() => void mutate([asset], "trash")}
                onRestore={() => void mutate([asset], "restore")}
                onPermanentDelete={() => void mutate([asset], "delete")} />
            </div>
            {renaming?.path === asset.path
              ? <input className="asset-rename" autoFocus value={renaming.text} maxLength={300} aria-label="资产名称"
                onChange={(event) => setRenaming({ path: asset.path, text: event.target.value })}
                onBlur={() => void saveRename()}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter") { event.preventDefault(); void saveRename(); }
                  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRenaming(undefined); }
                }} />
              : uploaded || fromChat
              ? <span className="asset-source muted" title={asset.name}>{fromChat ? "聊天上传" : "手动上传"} · {asset.name}</span>
              : asset.conversationId
                ? <Link className="asset-source" href={`/?conversation=${asset.conversationId}`}>
                  来自对话 · {asset.conversationTitle}
                </Link>
                : <span className="asset-source muted">来源对话已删除</span>}
            {/* 生成结果原来不显示文件名:改过名的显示出来 */}
            {!uploaded && !fromChat && renaming?.path !== asset.path && !/^tz-\d{4}-/.test(asset.name) &&
              <span className="asset-source muted asset-name" title={asset.name}>{asset.name}</span>}
          </article>;
        })}
      </div>}
    </div>
    {selecting && <div className={`asset-selection-bar ${selectionClosing ? "is-closing" : ""}`} role="toolbar" aria-label="批量操作">
      <span className="asset-selection-count">
        {chosen.length ? <>已选 <b>{chosen.length}</b> 项</> : "点击卡片选择 · Shift 连选"}
      </span>
      <button type="button" onClick={() => setSelected(allChosen ? new Set() : new Set(visible.map((asset) => asset.path)))}
        disabled={!visible.length}>
        {allChosen ? "取消全选" : `全选 ${visible.length}`}
      </button>
      <span className="asset-selection-sep" />
      {confirmingDelete ? <>
        <span className="asset-selection-warn">永久删除 {chosen.length} 项？无法恢复</span>
        <button type="button" onClick={() => setConfirmingDelete(false)}>取消</button>
        <button type="button" className="danger" disabled={busy} onClick={() => void mutate(chosen, "delete")}>
          <XCircle size={14} /> 确认删除
        </button>
      </> : <>
        {!inTrash && <button type="button" disabled={!chosen.length} onClick={() => void downloadChosen()}>
          <Download size={14} /> 下载
        </button>}
        {!inTrash && <Dropdown className="asset-move" value="" placeholder="移到文件夹" ariaLabel="移到文件夹"
          disabled={!chosen.length}
          options={[
            ...folders.map((item) => ({ value: item.id, label: item.name })),
            { value: UNGROUPED, label: "移出文件夹（未分组）" },
            { value: NEW_FOLDER, label: "＋ 新建文件夹并移入" },
          ]}
          onChange={(target) => {
            const paths = chosen.map((item) => item.path);
            if (target === NEW_FOLDER) void createFolder(`新文件夹 ${folders.length + 1}`, paths);
            else void moveTo(paths, target === UNGROUPED ? null : target);
          }} />}
        {inTrash
          ? <button type="button" disabled={!chosen.length || busy} onClick={() => void mutate(chosen, "restore")}>
            <RotateCcw size={14} /> 恢复
          </button>
          : <button type="button" disabled={!chosen.length || busy} onClick={() => void mutate(chosen, "trash")}>
            <Trash2 size={14} /> 移入回收站
          </button>}
        <button type="button" className="danger-text" disabled={!chosen.length || busy} onClick={() => setConfirmingDelete(true)}>
          <XCircle size={14} /> 永久删除
        </button>
      </>}
      <button type="button" className="asset-selection-close" aria-label="退出选择" onClick={exitSelecting}><X size={15} /></button>
    </div>}
    {cardDrag.overlay}
    <BackToTop floating />
    {dragging && <div className="asset-drop-hint" aria-hidden="true">
      <Upload size={26} />
      <strong>松开即可上传到资产</strong>
      <span>支持 JPG / PNG / WebP 图片、MP4 / MOV 视频、MP3 / WAV 音频</span>
    </div>}
  </main>;
}
