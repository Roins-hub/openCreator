"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Clapperboard, Image as ImageIcon, ListChecks, Search, Star, Trash2, X } from "lucide-react";
import { durationSummary, formatPrice, type VideoModel } from "@/lib/tangzhi";
import { tierPrice, yuan, type ImageModel, type ImageResolution } from "@/lib/image-models";
import { channelOf, groupModels, matchesQuery } from "@/lib/model-catalog";
import { useSlidingIndicator } from "@/components/sliding-indicator";
import { cachedModelPrefs, changeModelPrefs, syncModelPrefs } from "@/lib/model-prefs-client";
import type { ModelPrefs, ModelPrefsOp } from "@/lib/model-prefs";

type PickerModel = VideoModel | ImageModel;

// 关闭动画的时长(和 CSS 里 model-panel-out 一致)
const CLOSE_MS = 160;
const FAVORITE_VIEW = "\u0000favorites";
const seriesKey = (model: Pick<PickerModel, "vendor" | "series">) => `${model.vendor}\u0000${model.series}`;

/** 排序用的价格:视频按秒的在前;价格未知的放最后 */
function sortValue(model: PickerModel, resolution: ImageResolution) {
  if (model.generic) return [2, 0] as const;
  if (model.type === "video") return [model.billing === "per_second" ? 0 : 1, model.price] as const;
  return [0, tierPrice(model.price, resolution) ?? Number.MAX_SAFE_INTEGER] as const;
}

const sortModels = (list: PickerModel[], resolution: ImageResolution) => [...list].sort((a, b) => {
  const [x1, x2] = sortValue(a, resolution);
  const [y1, y2] = sortValue(b, resolution);
  return x1 - y1 || x2 - y2 || a.id.localeCompare(b.id, "en", { numeric: true });
});

function priceText(model: PickerModel, resolution: ImageResolution) {
  if (model.type === "video") return formatPrice(model);
  if (model.generic) return "价格未知";
  const price = tierPrice(model.price, resolution);
  return price === undefined ? model.priceLabel : `${resolution.toUpperCase()} ${yuan(price)}/张`;
}

/** 每行的关键信息:渠道、分辨率、人脸策略、素材上限、时长 */
function rowChips(model: PickerModel) {
  const chips: string[] = [];
  const channel = channelOf(model.id, model.tag);
  if (channel) chips.push(channel);
  if (model.generic) return [...chips, "参数未知"];
  if (model.type === "video") {
    chips.push(model.resolutions.map((item) => item.toUpperCase()).join("/"));
    if (model.face) chips.push(model.face);
    const { images, audios, videos } = model.limits;
    const limits = [images && `${images}图`, audios && `${audios}音`, videos && `${videos}视`].filter(Boolean).join("");
    if (limits) chips.push(limits);
    chips.push(durationSummary(model.durations));
    if (model.billing === "per_request") chips.push("按次");
  } else {
    if (/-cf$/i.test(model.id)) chips.push("超分 4K");
    if (model.resolutions.length < 3) chips.push(model.resolutions.map((item) => item.toUpperCase()).join("/"));
    if (model.ratios?.length && model.ratios.length <= 4) chips.push(model.ratios.join(" "));
    if (!model.maxReferences) chips.push("仅文生图");
  }
  return chips;
}

/** 模型名:放得下就正常显示,太长时自动来回滚动显示完整名字 */
function ScrollingName({ text }: { text: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const box = boxRef.current;
    const inner = box?.firstElementChild as HTMLElement | null;
    if (!box || !inner) return;
    // ResizeObserver 开始观察时会先回调一次,不用在这里同步量
    const observer = new ResizeObserver(() => setShift(Math.max(0, Math.ceil(inner.scrollWidth - box.clientWidth))));
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);
  const style = shift > 0
    ? { "--shift": `-${shift}px`, "--scroll-duration": `${Math.min(14, 3 + shift / 30).toFixed(1)}s` } as CSSProperties
    : undefined;
  return (
    <span ref={boxRef} className={`pick-row-name ${shift > 0 ? "is-scrolling" : ""}`} style={style} title={text}>
      <span>{text}</span>
    </span>
  );
}

/**
 * 模型选择面板:左栏按厂商 → 系列分组(最上面是「常用」:加星的和最近用过的),右栏列出该系列的模型,
 * 同系列按价格从低到高。顶部可以搜索(模型名、系列、渠道号、描述)和筛选(分辨率、可真人、计费方式)。
 */
export function ModelPicker({
  models, value, onChange, imageResolution, placeholder = "正在加载模型",
}: {
  models: PickerModel[];
  value: string;
  onChange: (id: string) => void;
  imageResolution: ImageResolution;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<string>();
  const [resolutionFilter, setResolutionFilter] = useState<string>();
  const [faceOnly, setFaceOnly] = useState(false);
  const [billingFilter, setBillingFilter] = useState<VideoModel["billing"]>();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  // 「常用」的批量管理:勾选后清除,或一键清空(加星的和最近用过的都会移出)
  const [managingCommon, setManagingCommon] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [active, setActive] = useState(0);
  const keyboardMove = useRef(false);
  const [position, setPosition] = useState<CSSProperties>();
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 左栏选中的系列、右栏当前行:各有一块底色滑过去,而不是瞬间跳
  const { containerRef: navRef, indicator: navIndicator } = useSlidingIndicator<HTMLElement>(".model-nav-item.active");
  const { containerRef: listRef, indicator: rowIndicator } = useSlidingIndicator<HTMLDivElement>(".pick-row.is-active");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = models.find((model) => model.id === value);
  const hasVideo = models.some((model) => model.type === "video");

  // 先按筛选条件过滤,再分组
  const filtered = useMemo(() => models.filter((model) => {
    if (model.type !== "video") return !resolutionFilter && !faceOnly && !billingFilter;
    if (resolutionFilter && (model.generic || !model.resolutions.includes(resolutionFilter as never))) return false;
    if (faceOnly && model.face !== "可真人") return false;
    if (billingFilter && (model.generic || model.billing !== billingFilter)) return false;
    return true;
  }), [billingFilter, faceOnly, models, resolutionFilter]);
  const groups = useMemo(() => groupModels(filtered), [filtered]);
  const resolutions = useMemo(() => [...new Set(models.flatMap((model) =>
    model.type === "video" && !model.generic ? model.resolutions : []))]
    .sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)), [models]);
  const common = useMemo(() => {
    const ids = [...favorites, ...recents.filter((id) => !favorites.includes(id))];
    return ids.map((id) => filtered.find((model) => model.id === id)).filter((model): model is PickerModel => Boolean(model));
  }, [favorites, filtered, recents]);

  // 没有选中系列(或筛选后系列没了)时,落到第一个有模型的系列
  const viewKeys = groups.flatMap((group) => group.series.map((series) => seriesKey({ vendor: group.vendor, series: series.name })));
  const currentView = view === FAVORITE_VIEW && common.length ? FAVORITE_VIEW
    : view && viewKeys.includes(view) ? view : viewKeys[0];

  // 右栏:搜索时列出所有匹配(按系列分段),否则是当前选中的系列或「常用」
  const searching = query.trim().length > 0;
  const sections = (() => {
    if (searching) {
      return groups.flatMap((group) => group.series.flatMap((series) => {
        const hits = series.models.filter((model) => matchesQuery(model, query));
        return hits.length ? [{ title: `${group.vendor} · ${series.name}`, models: sortModels(hits, imageResolution) }] : [];
      }));
    }
    if (currentView === FAVORITE_VIEW) return [{ title: "常用", models: common }];
    for (const group of groups) {
      const series = group.series.find((item) => seriesKey({ vendor: group.vendor, series: item.name }) === currentView);
      if (series) return [{ title: `${group.vendor} · ${series.name}`, models: sortModels(series.models, imageResolution) }];
    }
    return [];
  })();
  const rows = sections.flatMap((section) => section.models);
  const inCommon = !searching && currentView === FAVORITE_VIEW;
  const managing = managingCommon && inCommon;
  const allPicked = managing && common.length > 0 && common.every((model) => picked.has(model.id));

  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const width = Math.min(780, window.innerWidth - 24);
    const left = Math.min(Math.max(12, trigger.left), window.innerWidth - width - 12);
    const above = trigger.top - 20;
    const below = window.innerHeight - trigger.bottom - 20;
    const up = above >= 360 || above >= below;
    // 从触发按钮的位置长出来
    const origin = { "--origin-x": `${Math.round(trigger.left + trigger.width / 2 - left)}px` } as CSSProperties;
    setPlacement(up ? "above" : "below");
    setPosition(up
      ? { ...origin, left, width, bottom: window.innerHeight - trigger.top + 8, maxHeight: Math.min(560, above) }
      : { ...origin, left, width, top: trigger.bottom + 8, maxHeight: Math.min(560, below) });
  }, []);

  /** 先播放收起动画,再卸载 */
  const closePanel = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setOpen(false); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => { setOpen(false); setClosing(false); }, CLOSE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (open) searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  const openPanel = () => {
    if (!models.length) return;
    // 「常用」按中转站账号保存在服务端:先显示本地缓存,再同步最新的(别的设备可能改过)
    const cached = cachedModelPrefs();
    const favs = cached.favorites;
    const recent = cached.recents;
    setFavorites(favs);
    setRecents(recent);
    void syncModelPrefs().then((prefs) => { if (prefs) adoptPrefs(prefs); });
    setManagingCommon(false);
    setPicked(new Set());
    setConfirmClear(false);
    setQuery("");
    // 打开时停在当前模型所在的系列
    setView(selected ? seriesKey(selected) : favs.length || recent.length ? FAVORITE_VIEW : undefined);
    setActive(0);
    place();
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) closePanel(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); closePanel(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", place);
    };
  }, [closePanel, open, place]);

  useEffect(() => {
    // 只在键盘上下选择时把这一行滚进右栏可见范围;只滚右栏自己,不用 scrollIntoView(它会连外面的页面一起滚,
    // 打开面板时页面会跳一下)。鼠标移动不滚。
    if (!open || !keyboardMove.current) return;
    keyboardMove.current = false;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    if (!list || !row) return;
    const header = list.querySelector<HTMLElement>("h4")?.offsetHeight ?? 0;
    if (row.offsetTop - header < list.scrollTop) list.scrollTop = row.offsetTop - header;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [active, listRef, open]);

  const adoptPrefs = (prefs: ModelPrefs) => {
    setFavorites(prefs.favorites);
    setRecents(prefs.recents);
  };
  /** 改一次「常用」:界面立刻变,服务端合并后的结果回来再对齐 */
  const changePrefs = (op: ModelPrefsOp) => {
    const next = changeModelPrefs({ favorites, recents }, op, adoptPrefs);
    adoptPrefs(next);
    return next;
  };

  const choose = (id: string) => {
    // 只是点选不进常用:提交生成时服务端记次数,连续用同一个模型 3 次才加进来
    closePanel();
    if (id !== value) onChange(id);
    triggerRef.current?.focus();
  };
  const toggleFavorite = (id: string) => { changePrefs({ type: "favorite", id, on: !favorites.includes(id) }); };
  /** 从「常用」里移出:加星的取消星标,最近用过的从记录里删掉 */
  const removeCommon = (ids: readonly string[]) => {
    const drop = new Set(ids);
    const { favorites: nextFavorites, recents: nextRecents } = changePrefs({ type: "remove", ids: [...ids] });
    setPicked((current) => new Set([...current].filter((id) => !drop.has(id))));
    setConfirmClear(false);
    setActive(0);
    if (!nextFavorites.length && !nextRecents.length) setManagingCommon(false);
  };
  const togglePicked = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const stopManagingCommon = () => {
    setManagingCommon(false);
    setPicked(new Set());
    setConfirmClear(false);
  };

  const chip = (label: string, on: boolean, toggle: () => void) => (
    <button type="button" className={`model-filter ${on ? "is-on" : ""}`} aria-pressed={on} onClick={toggle}>{label}</button>
  );
  const seriesCount = (count: number) => <span className="model-nav-count">{count}</span>;

  return (
    <div className={`model-picker dropdown composer-model ${open ? "is-open" : ""}`} ref={rootRef}>
      <button type="button" ref={triggerRef} className="dropdown-trigger" aria-haspopup="dialog" aria-expanded={open}
        aria-label="选择模型" disabled={!models.length} onClick={() => (open && !closing ? closePanel() : openPanel())}
        onKeyDown={(event) => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); openPanel(); } }}>
        <span className="dropdown-value">
          {selected
            ? <>{selected.type === "image" ? <ImageIcon size={14} /> : <Clapperboard size={14} />}<span className="composer-model-name">{selected.id}</span></>
            : <span className="dropdown-placeholder">{placeholder}</span>}
        </span>
        <ChevronDown size={14} className="dropdown-chevron" />
      </button>
      {open && (
        <div className={`model-panel is-${placement} ${closing ? "is-closing" : ""}`} role="dialog" aria-label="选择模型"
          style={position}>
          <div className="model-panel-top">
            <label className="model-search">
              <Search size={14} />
              <input ref={searchRef} value={query} placeholder="搜索模型、系列、渠道号或描述"
                aria-label="搜索模型"
                onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    keyboardMove.current = true;
                    setActive((index) => Math.min(rows.length - 1, index + 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    keyboardMove.current = true;
                    setActive((index) => Math.max(0, index - 1));
                  }
                  else if (event.key === "Enter" && rows[active]) {
                    event.preventDefault();
                    if (managing) togglePicked(rows[active].id); else choose(rows[active].id);
                  }
                }} />
              {query && <button type="button" className="model-search-clear" aria-label="清空搜索"
                onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={13} /></button>}
            </label>
            {hasVideo && (
              <div className="model-filters" role="group" aria-label="筛选">
                {resolutions.map((resolution) => chip(resolution.toUpperCase(), resolutionFilter === resolution,
                  () => setResolutionFilter((current) => current === resolution ? undefined : resolution)))}
                {chip("可真人", faceOnly, () => setFaceOnly((on) => !on))}
                {chip("按秒", billingFilter === "per_second", () => setBillingFilter((current) => current === "per_second" ? undefined : "per_second"))}
                {chip("按次", billingFilter === "per_request", () => setBillingFilter((current) => current === "per_request" ? undefined : "per_request"))}
              </div>
            )}
          </div>
          <div className="model-panel-body">
            <nav className="model-nav" aria-label="模型分类" ref={navRef}>
              {navIndicator}
              {common.length > 0 && (
                <button type="button" className={`model-nav-item is-common ${!searching && currentView === FAVORITE_VIEW ? "active" : ""}`}
                  onClick={() => { setView(FAVORITE_VIEW); setQuery(""); setActive(0); }}>
                  <Star size={13} /><span>常用</span>{seriesCount(common.length)}
                </button>
              )}
              {groups.map((group) => (
                <div className="model-nav-vendor" key={group.vendor}>
                  <p>{group.vendor}</p>
                  {group.series.map((series) => {
                    const key = seriesKey({ vendor: group.vendor, series: series.name });
                    const current = selected && seriesKey(selected) === key;
                    return (
                      <button type="button" key={key} title={series.name}
                        className={`model-nav-item ${!searching && currentView === key ? "active" : ""} ${current ? "has-current" : ""}`}
                        onClick={() => { setView(key); setQuery(""); setActive(0); }}>
                        <span>{series.name}</span>{seriesCount(series.models.length)}
                      </button>
                    );
                  })}
                </div>
              ))}
              {!groups.length && <p className="model-nav-empty">没有符合筛选条件的模型</p>}
            </nav>
            <div className="model-list" ref={listRef} role="listbox" aria-label="模型">
              {rowIndicator}
              {/* 换系列时整块换掉,行依次淡入;搜索时不换(否则每打一个字都闪) */}
              <div className="model-list-body" key={searching ? "search" : currentView}>
              {sections.map((section) => (
                <section key={section.title}>
                  <h4>{section.title}<span>{section.models.length} 个</span>
                    {inCommon && (
                      <span className={`common-tools ${managing ? "is-managing" : ""}`}>
                        {managing ? <>
                          <label className="common-pick-all">
                            <input type="checkbox" checked={allPicked}
                              onChange={() => setPicked(allPicked ? new Set() : new Set(common.map((model) => model.id)))} />
                            全选
                          </label>
                          <button type="button" disabled={!picked.size} onClick={() => removeCommon([...picked])}>
                            <X size={12} />清除所选{picked.size ? ` ${picked.size}` : ""}
                          </button>
                          <button type="button" className={`is-danger ${confirmClear ? "confirm" : ""}`}
                            onClick={() => (confirmClear ? removeCommon(common.map((model) => model.id)) : setConfirmClear(true))}
                            title="把加星的和最近用过的都移出常用">
                            <Trash2 size={12} />{confirmClear ? "确认清空" : "一键清空"}
                          </button>
                          <button type="button" onClick={stopManagingCommon}>完成</button>
                        </> : (
                          <button type="button" onClick={() => { setManagingCommon(true); setPicked(new Set()); }}
                            title="批量移出常用">
                            <ListChecks size={12} />管理
                          </button>
                        )}
                      </span>
                    )}
                  </h4>
                  {section.models.map((model) => {
                    const index = rows.indexOf(model);
                    const starred = favorites.includes(model.id);
                    return (
                      <div key={`${section.title}-${model.id}`} data-row={index} role="option" aria-selected={model.id === value}
                        style={{ "--i": Math.min(index, 10) } as CSSProperties}
                        className={`pick-row ${index === active ? "is-active" : ""} ${model.id === value ? "is-selected" : ""} ${managing && picked.has(model.id) ? "is-picked" : ""}`}
                        onMouseEnter={() => setActive(index)}>
                        {managing && (
                          <input type="checkbox" className="pick-row-pick" checked={picked.has(model.id)}
                            aria-label={`选择 ${model.id}`} onChange={() => togglePicked(model.id)} />
                        )}
                        <button type="button" className="pick-row-main"
                          onClick={() => (managing ? togglePicked(model.id) : choose(model.id))}
                          title={managing ? "点击选择" : model.description || model.id}>
                          <ScrollingName text={model.id} />
                          <span className="pick-row-chips">{rowChips(model).map((label) => (
                            <em key={label} className={label === channelOf(model.id, model.tag) ? "is-channel" : undefined}>{label}</em>
                          ))}</span>
                        </button>
                        <span className="pick-row-price">{priceText(model, imageResolution)}</span>
                        {model.id === value && <Check size={14} className="pick-row-check" aria-label="当前模型" />}
                        <button type="button" className={`pick-row-star ${starred ? "is-on" : ""}`} aria-pressed={starred}
                          aria-label={starred ? `取消星标 ${model.id}` : `加星 ${model.id}`}
                          title={starred ? "取消星标" : "加星（固定在常用里）"} onClick={() => toggleFavorite(model.id)}>
                          <Star size={14} />
                        </button>
                        {/* 常用里每一行都能直接移出(最近用过的也能删掉) */}
                        {inCommon && !managing && (
                          <button type="button" className="pick-row-remove" aria-label={`移出常用 ${model.id}`}
                            title="移出常用" onClick={() => removeCommon([model.id])}>
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
              {!sections.length && (
                <p className="model-list-empty">{searching ? "没有找到匹配的模型" : "没有符合筛选条件的模型"}</p>
              )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
