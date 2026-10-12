"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownWideNarrow, ArrowLeft, ArrowUpNarrowWide, Download, Image as ImageIcon, Images, Search, Star, Trash2, Video, X,
} from "lucide-react";
import type { Asset } from "@/lib/asset-store";
import { AssetMenu } from "@/components/asset-menu";
import { apiKeyHeaders, openSession, readApiKey, readRelayBase } from "@/lib/api-key";
import { openAuthDialog, useAccount } from "@/lib/account-client";

type Filter = "all" | Asset["kind"] | "favorite" | "trash";
type Sort = "newest" | "oldest";

/** 按提示词、对话标题、文件名搜索(多个关键词用空格分开,需全部命中) */
export function matchAsset(asset: Pick<Asset, "prompt" | "conversationTitle" | "name">, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = [asset.prompt, asset.conversationTitle, asset.name].filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

const retentionDays = Number(process.env.NEXT_PUBLIC_RETENTION_DAYS) || 0;
const retentionNote = retentionDays ? `生成结果保留 ${retentionDays} 天，请及时下载需要长期保存的视频。` : "";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AssetLibrary() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [error, setError] = useState("");
  const loadAssets = async () => {
    const response = await fetch("/api/assets", { headers: apiKeyHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "无法读取资产");
    setAssets(data);
  };
  const account = useAccount();
  const loggedIn = account?.loggedIn;
  useEffect(() => {
    if (loggedIn === undefined) return;
    const timer = window.setTimeout(() => {
      setError("");
      // 默认中转站只认登录账号(看媒体的 Cookie 登录时已写好);自定义中转站沿用 API Key
      if (!readRelayBase()) {
        if (loggedIn) loadAssets().catch((cause) => setError(cause.message));
        else { setAssets([]); setError("请先登录，才能查看你的资产"); }
        return;
      }
      if (!readApiKey()) {
        setAssets([]);
        setError("请先在设置中填写中转站 API Key，才能查看你的资产");
        return;
      }
      openSession().then(loadAssets).catch((cause) => setError(cause.message));
    }, 0);
    return () => clearTimeout(timer);
  }, [loggedIn]);
  const visible = useMemo(() => {
    const filtered = filter === "trash"
      ? assets.filter((asset) => asset.trashed)
      : filter === "favorite"
        ? assets.filter((asset) => !asset.trashed && asset.favorite)
        : assets.filter((asset) => !asset.trashed && (filter === "all" || asset.kind === filter));
    const direction = sort === "newest" ? -1 : 1;
    return filtered
      .filter((asset) => matchAsset(asset, query))
      .sort((a, b) => direction * a.createdAt.localeCompare(b.createdAt));
  }, [assets, filter, query, sort]);
  const activeAssets = assets.filter((asset) => !asset.trashed);
  const toggleFavorite = async (asset: Asset) => {
    setError("");
    const favorite = !asset.favorite;
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, favorite } : item));
    try {
      const response = await fetch("/api/favorites", {
        method: "PUT", headers: { "Content-Type": "application/json", ...apiKeyHeaders() },
        body: JSON.stringify({ paths: [asset.path], favorite }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "收藏失败");
    } catch (cause) {
      setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, favorite: !favorite } : item));
      setError((cause as Error).message);
    }
  };
  const mutate = async (asset: Asset, action: "trash" | "restore" | "delete") => {
    setError("");
    try {
      const response = await fetch(
        action === "delete" ? `/api/assets?path=${encodeURIComponent(asset.path)}` : "/api/assets",
        action === "delete" ? { method: "DELETE", headers: apiKeyHeaders() } : {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...apiKeyHeaders() },
          body: JSON.stringify({ action, path: asset.path }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "资产操作失败");
      await loadAssets();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return <main className="utility-page">
    <header className="utility-topbar">
      <Link href="/" className="back-link"><ArrowLeft size={17} /> 返回对话</Link>
      <span>Mote Assets</span>
    </header>
    <div className="asset-content">
      <div className="asset-heading">
        <span className="eyebrow">MY LIBRARY</span>
        <h1>资产</h1>
        <p>这里只显示你的账号生成的视频，其他用户看不到。{retentionNote}</p>
      </div>
      <div className="asset-toolbar-row">
      <div className="asset-toolbar" aria-label="资产筛选">
        {([
          ["all", "全部", Images],
          ["image", "图片", ImageIcon],
          ["video", "视频", Video],
          ["favorite", "收藏", Star],
          ["trash", "回收站", Trash2],
        ] as const).map(([value, label, Icon]) =>
          <button key={value} className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}>
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
            placeholder="搜索提示词、对话标题" aria-label="搜索资产" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={13} /></button>}
        </label>
        <button type="button" className="asset-sort" onClick={() => setSort((value) => value === "newest" ? "oldest" : "newest")}
          title="切换排序" aria-label={`按时间排序：${sort === "newest" ? "最新在前" : "最早在前"}`}>
          {sort === "newest" ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}
          {sort === "newest" ? "最新在前" : "最早在前"}
        </button>
      </div>
      </div>
      {query && !error && <p className="asset-result-count">找到 {visible.length} 个匹配「{query.trim()}」的资产</p>}
      {error && <div className="settings-error">{error}
        {account && !account.loggedIn && <button type="button" className="key-link" onClick={() => openAuthDialog("login")}>登录 / 注册</button>}
      </div>}
      {!error && visible.length === 0 ? <div className="asset-empty">
        {query ? <>
          <Search size={24} />
          <h2>没有找到匹配的资产</h2>
          <p>换个关键词试试，可以搜提示词里的词，或者对话标题。</p>
        </> : filter === "favorite" ? <>
          <Star size={24} />
          <h2>还没有收藏</h2>
          <p>在对话的任务卡片或资产卡片上点击星标，收藏的作品会集中出现在这里。</p>
        </> : filter === "trash" ? <>
          <Trash2 size={24} />
          <h2>回收站是空的</h2>
          <p>移入回收站的资产会暂存在这里，可以恢复或永久删除。</p>
        </> : <>
          <Images size={24} />
          <h2>还没有生成资产</h2>
          <p>完成一次图片或视频生成后，结果会自动出现在这里。</p>
        </>}
        <Link href="/">开始创作</Link>
      </div> : <div className="asset-grid">
        {visible.map((asset) => <article className="asset-card" key={asset.id}>
          <div className="asset-preview" title={asset.prompt}>
            {!asset.trashed && <button type="button" className={`asset-star ${asset.favorite ? "is-on" : ""}`}
              onClick={() => void toggleFavorite(asset)} aria-pressed={Boolean(asset.favorite)}
              aria-label={asset.favorite ? "取消收藏" : "收藏"} title={asset.favorite ? "取消收藏" : "收藏"}>
              <Star size={15} fill={asset.favorite ? "currentColor" : "none"} />
            </button>}
            {asset.kind === "video"
              ? <video controls preload="metadata" src={`/api/media/${asset.path}`} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img loading="lazy" src={`/api/media/${asset.path}`} alt={asset.name} />}
          </div>
          <div className="asset-details">
            <div>
              <strong>{asset.kind === "image" ? "图片" : "视频"}</strong>
              <span>{formatSize(asset.size)} · {new Date(asset.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            <a className="asset-download" href={`/api/media/${asset.path}?download=${encodeURIComponent(asset.name)}`} download={asset.name}
              aria-label={`下载 ${asset.name}`}><Download size={15} /></a>
            <AssetMenu name={asset.name} trashed={Boolean(asset.trashed)}
              onTrash={() => void mutate(asset, "trash")}
              onRestore={() => void mutate(asset, "restore")}
              onPermanentDelete={() => void mutate(asset, "delete")} />
          </div>
          {asset.conversationId
            ? <Link className="asset-source" href={`/?conversation=${asset.conversationId}`}>
              来自对话 · {asset.conversationTitle}
            </Link>
            : <span className="asset-source muted">来源对话已删除</span>}
        </article>)}
      </div>}
    </div>
  </main>;
}
