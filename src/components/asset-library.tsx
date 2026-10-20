"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import Link from "next/link";
import {
  ArrowDownWideNarrow, ArrowLeft, ArrowUpNarrowWide, Check, CheckSquare, Download, Image as ImageIcon, Images, Music,
  RotateCcw, Search, Sparkles, Star, Trash2, Upload, Video, X, XCircle,
} from "lucide-react";
import type { Asset } from "@/lib/asset-store";
import { AssetMenu } from "@/components/asset-menu";
import { apiKeyHeaders, openSession, readApiKey } from "@/lib/api-key";
import { uploadMedia } from "@/lib/direct-upload";
import { acceptAttribute, MEDIA_KIND_LABEL, pickMediaFiles } from "@/lib/media-files";
import { readableError } from "@/lib/network-error";
import type { MediaRef } from "@/lib/types";

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

const downloadUrl = (asset: Asset) => `/api/media/${asset.path}?download=${encodeURIComponent(asset.name)}`;

/** 逐个触发下载(间隔一点,浏览器才不会把后面的吞掉);第一次批量下载时浏览器会问是否允许下载多个文件 */
async function downloadAll(assets: readonly Asset[]) {
  for (const [index, asset] of assets.entries()) {
    if (index) await new Promise((resolve) => setTimeout(resolve, 450));
    const link = document.createElement("a");
    link.href = downloadUrl(asset);
    link.download = asset.name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }
}

export function AssetLibrary() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [source, setSource] = useState<Source>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const lastClicked = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAssets = async () => {
    setAssets(await request<Asset[]>("/api/assets"));
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!readApiKey()) {
        setError("请先在设置中填写中转站 API Key，才能查看你的资产");
        return;
      }
      openSession().then(loadAssets).catch((cause) => setError(cause.message));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const visible = useMemo(() => {
    const filtered = filter === "trash"
      ? assets.filter((asset) => asset.trashed)
      : filter === "favorite"
        ? assets.filter((asset) => !asset.trashed && asset.favorite)
        : assets.filter((asset) => !asset.trashed && (filter === "all" || asset.kind === filter));
    const direction = sort === "newest" ? -1 : 1;
    return filtered
      .filter((asset) => source === "all" || (source === "upload") === (asset.source === "upload"))
      .filter((asset) => matchAsset(asset, query))
      .sort((a, b) => direction * a.createdAt.localeCompare(b.createdAt));
  }, [assets, filter, source, query, sort]);
  const activeAssets = assets.filter((asset) => !asset.trashed);
  const hasAudio = activeAssets.some((asset) => asset.kind === "audio");
  // 批量操作只作用于当前筛选下看得到的已选项
  const chosen = visible.filter((asset) => selected.has(asset.path));
  const allChosen = visible.length > 0 && chosen.length === visible.length;
  const inTrash = filter === "trash";

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
    setConfirmingDelete(false);
    lastClicked.current = null;
  };

  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable=true]");
      if (event.key === "Escape" && !event.defaultPrevented) {
        setSelecting(false);
        setSelected(new Set());
        setConfirmingDelete(false);
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

  const downloadChosen = async () => {
    if (!chosen.length) return;
    setNotice(chosen.length > 1 ? `正在下载 ${chosen.length} 个文件；浏览器询问「下载多个文件」时请选择允许` : "");
    await downloadAll(chosen);
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

  const kindLabel = (kind: Asset["kind"]) => MEDIA_KIND_LABEL[kind];
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
  </> : source === "upload" ? <>
    <Upload size={24} />
    <h2>还没有上传素材</h2>
    <p>点击「上传素材」或把文件拖进来；上传后在输入框里按 @ 就能引用。</p>
  </> : <>
    <Images size={24} />
    <h2>还没有资产</h2>
    <p>完成一次图片或视频生成后结果会自动出现在这里，也可以直接上传素材。</p>
  </>;

  return <main className={`utility-page asset-page ${dragging ? "is-dragging" : ""}`} {...dropHandlers}>
    <header className="utility-topbar">
      <Link href="/" className="back-link"><ArrowLeft size={17} /> 返回对话</Link>
      <span>TZ Assets</span>
    </header>
    <div className="asset-content">
      <div className="asset-heading">
        <span className="eyebrow">MY LIBRARY</span>
        <h1>资产</h1>
        <p>你的账号生成的图片、视频，以及你上传的素材都在这里，其他用户看不到；上传的素材在输入框里按 @ 就能引用。{retentionNote}</p>
      </div>
      <div className="asset-toolbar-row">
        <div className="asset-toolbar" aria-label="资产筛选">
          {([
            ["all", "全部", Images],
            ["image", "图片", ImageIcon],
            ["video", "视频", Video],
            ...(hasAudio || filter === "audio" ? [["audio", "音频", Music] as const] : []),
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
              placeholder="搜索提示词、对话标题、文件名" aria-label="搜索资产" />
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
        <div className="asset-source-filter" role="group" aria-label="按来源筛选">
          {([["all", "全部来源"], ["generated", "AI 生成"], ["upload", "我上传的"]] as const).map(([value, label]) =>
            <button key={value} type="button" className={source === value ? "active" : ""} aria-pressed={source === value}
              onClick={() => setSource(value)}>
              {value === "generated" && <Sparkles size={12} />}
              {value === "upload" && <Upload size={12} />}
              {label}
              <span>{value === "all" ? activeAssets.length
                : activeAssets.filter((asset) => (asset.source === "upload") === (value === "upload")).length}</span>
            </button>)}
        </div>
        <div className="asset-subbar-actions">
          <button type="button" className={`asset-select-toggle ${selecting ? "active" : ""}`} disabled={!visible.length && !selecting}
            onClick={() => (selecting ? exitSelecting() : setSelecting(true))}>
            <CheckSquare size={14} /> {selecting ? "完成" : "选择"}
          </button>
          <button type="button" className="asset-upload-button" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> 上传素材
          </button>
          <input ref={fileInputRef} type="file" multiple accept={ACCEPT} hidden
            onChange={(event) => { startUploads(Array.from(event.target.files || [])); event.target.value = ""; }} />
        </div>
      </div>
      {query && !error && <p className="asset-result-count">找到 {visible.length} 个匹配「{query.trim()}」的资产</p>}
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
        {source === "upload" || (!query && filter === "all")
          ? <button type="button" onClick={() => fileInputRef.current?.click()}>上传素材</button>
          : <Link href="/">开始创作</Link>}
      </div> : <div className={`asset-grid ${selecting ? "is-selecting" : ""}`}>
        {visible.map((asset) => {
          const isSelected = selected.has(asset.path);
          const uploaded = asset.source === "upload";
          return <article className={`asset-card ${isSelected ? "is-selected" : ""}`} key={asset.id}>
            <div className={`asset-preview ${asset.kind === "audio" ? "is-audio" : ""}`} title={asset.prompt || asset.name}>
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
              {asset.kind === "video"
                ? <video controls={!selecting} preload="metadata" src={`/api/media/${asset.path}`} />
                : asset.kind === "audio"
                  ? <><Music size={30} /><audio controls={!selecting} preload="none" src={`/api/media/${asset.path}`} /></>
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img loading="lazy" src={`/api/media/${asset.path}`} alt={asset.name} />}
              {selecting && <button type="button" className="asset-select-overlay" tabIndex={-1} aria-hidden="true"
                onClick={(event) => toggleSelect(asset, event)} />}
            </div>
            <div className="asset-details">
              <div>
                <strong>
                  {kindLabel(asset.kind)}
                  <em className={`asset-origin ${uploaded ? "is-upload" : ""}`}>{uploaded ? "上传" : "AI 生成"}</em>
                </strong>
                <span>{formatSize(asset.size)} · {new Date(asset.createdAt).toLocaleString("zh-CN")}</span>
              </div>
              <a className="asset-download" href={downloadUrl(asset)} download={asset.name}
                aria-label={`下载 ${asset.name}`}><Download size={15} /></a>
              <AssetMenu name={asset.name} trashed={Boolean(asset.trashed)}
                onTrash={() => void mutate([asset], "trash")}
                onRestore={() => void mutate([asset], "restore")}
                onPermanentDelete={() => void mutate([asset], "delete")} />
            </div>
            {uploaded
              ? <span className="asset-source muted" title={asset.name}>手动上传 · {asset.name}</span>
              : asset.conversationId
                ? <Link className="asset-source" href={`/?conversation=${asset.conversationId}`}>
                  来自对话 · {asset.conversationTitle}
                </Link>
                : <span className="asset-source muted">来源对话已删除</span>}
          </article>;
        })}
      </div>}
    </div>
    {selecting && <div className="asset-selection-bar" role="toolbar" aria-label="批量操作">
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
    {dragging && <div className="asset-drop-hint" aria-hidden="true">
      <Upload size={26} />
      <strong>松开即可上传到资产</strong>
      <span>支持 JPG / PNG / WebP 图片、MP4 / MOV 视频、MP3 / WAV 音频</span>
    </div>}
  </main>;
}
