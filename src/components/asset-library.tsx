"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Image as ImageIcon, Images, Star, Trash2, Video } from "lucide-react";
import type { Asset } from "@/lib/asset-store";
import { AssetMenu } from "@/components/asset-menu";

type Filter = "all" | Asset["kind"] | "favorite" | "trash";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AssetLibrary() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const loadAssets = async () => {
    const response = await fetch("/api/assets");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "无法读取资产");
    setAssets(data);
  };
  useEffect(() => {
    fetch("/api/assets").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取资产");
      setAssets(data);
    }).catch((cause) => setError(cause.message));
  }, []);
  const visible = useMemo(() => filter === "trash"
    ? assets.filter((asset) => asset.trashed)
    : filter === "favorite"
      ? assets.filter((asset) => !asset.trashed && asset.favorite)
      : assets.filter((asset) => !asset.trashed && (filter === "all" || asset.kind === filter)),
  [assets, filter]);
  const activeAssets = assets.filter((asset) => !asset.trashed);
  const toggleFavorite = async (asset: Asset) => {
    setError("");
    const favorite = !asset.favorite;
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, favorite } : item));
    try {
      const response = await fetch("/api/favorites", {
        method: "PUT", headers: { "Content-Type": "application/json" },
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
        action === "delete" ? { method: "DELETE" } : {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
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
        <span className="eyebrow">LOCAL LIBRARY</span>
        <h1>资产</h1>
        <p>所有生成结果都保存在本机项目的 <code>out</code> 目录中。</p>
      </div>
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
      {error && <div className="settings-error">{error}</div>}
      {!error && visible.length === 0 ? <div className="asset-empty">
        {filter === "favorite" ? <>
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
          <div className="asset-preview">
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
              <span>{formatSize(asset.size)} · {new Date(asset.createdAt || asset.modifiedAt).toLocaleString("zh-CN")}</span>
            </div>
            <a className="asset-download" href={`/api/media/${asset.path}`} download={asset.name}
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
