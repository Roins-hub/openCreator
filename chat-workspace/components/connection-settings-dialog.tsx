"use client";

import { useState, type ReactElement } from "react";
import { Check, Eye, EyeOff, KeyRound, Link2, RefreshCw, Wifi } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useChatSettings } from "@/components/chat-settings";
import { ModelSelect } from "@/components/model-select";
import {
  CUSTOM_PROVIDER_ID,
  customApiBase,
  customShortUrl,
  PROVIDERS,
  type ProviderChoice,
  type ProviderId,
} from "@/lib/providers";
import { cn } from "@/lib/utils";
import { MOTE_MODE, MOTE_SETTINGS } from "@/lib/mote";

export function ConnectionSettingsDialog({ trigger }: { trigger: ReactElement }) {
  const settings = useChatSettings();
  const [showKey, setShowKey] = useState(false);
  const isCustom = settings.provider === CUSTOM_PROVIDER_ID;
  const customShort = customShortUrl(settings.customUrl);
  const customUrlInvalid = settings.customUrl.trim() !== "" && !customShort;
  const providerChoices: { id: ProviderChoice; name: string; shortUrl: string }[] = [
    ...(Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({
      id,
      name: PROVIDERS[id].name,
      shortUrl: PROVIDERS[id].shortUrl,
    })),
    { id: CUSTOM_PROVIDER_ID, name: "自定义中转站", shortUrl: customShort || "填写任意兼容地址" },
  ];
  const activeShortUrl = isCustom ? customShort : PROVIDERS[settings.provider as ProviderId].shortUrl;

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="settings-dialog max-h-[min(760px,calc(100dvh-2rem))] w-full overflow-y-auto p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-lg font-semibold">连接设置</DialogTitle>
          <DialogDescription>
            {MOTE_MODE
              ? "与视频、图片工作台共用同一个 API Key 和中转站。"
              : "Key 只用于转发请求，可选择仅在本次浏览器会话中保存。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-6 py-5">
          {MOTE_MODE && (
            <section className="space-y-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <KeyRound className="size-4" />
                {settings.apiKey ? "已使用工作台的 API Key" : "还没有填写 API Key"}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                中转站：{activeShortUrl || "new.tangzhi.org"}。Key 和中转站地址在工作台设置里修改，聊天会自动同步。
              </p>
              <a className="inline-block text-xs font-medium underline underline-offset-4" href={MOTE_SETTINGS}>
                打开工作台设置
              </a>
            </section>
          )}
          {!MOTE_MODE && <>
          <section className="space-y-2.5">
            <div className="text-sm font-medium">中转站</div>
            <div className="grid grid-cols-2 gap-2">
              {providerChoices.map(({ id, name, shortUrl }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => settings.setProvider(id)}
                  className={cn(
                    "provider-choice relative flex min-w-0 items-center gap-2 px-3 py-3 text-left text-sm",
                    settings.provider === id && "provider-choice-active",
                  )}
                >
                  <span className="flex size-5 items-center justify-center">
                    {settings.provider === id && <Check className="size-4" />}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate font-medium">{name}</strong>
                    <small className="block truncate text-muted-foreground">{shortUrl}</small>
                  </span>
                </button>
              ))}
            </div>
            {isCustom && (
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-sm font-medium" htmlFor="custom-url">
                  <Link2 className="size-4" /> 中转站地址
                </label>
                <div className="settings-input">
                  <input
                    id="custom-url"
                    value={settings.customUrl}
                    onChange={(event) => settings.setCustomUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-transparent px-3.5 py-3 text-sm outline-none"
                  />
                </div>
                {customUrlInvalid ? (
                  <p className="text-xs text-destructive">地址格式不正确，请填写 http(s):// 开头的网址</p>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    填写兼容 OpenAI 接口的地址，未带 /v1 时自动补全。请求由本站服务器转发
                    {customApiBase(settings.customUrl)?.startsWith("http://") &&
                      "；当前为 http，Key 会以明文传输"}
                    。
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="space-y-2.5">
            <label className="flex items-center gap-2 text-sm font-medium" htmlFor="api-key">
              <KeyRound className="size-4" /> API Key
            </label>
            <div className="settings-input flex items-center">
              <input
                id="api-key"
                value={settings.apiKey}
                onChange={(event) => settings.setApiKey(event.target.value)}
                type={showKey ? "text" : "password"}
                placeholder="sk-..."
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((current) => !current)}
                className="mr-1.5 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={showKey ? "隐藏 Key" : "显示 Key"}
                title={showKey ? "隐藏 Key" : "显示 Key"}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-4 py-1 text-sm">
              <span>
                <span className="block">记住 Key</span>
                <span className="text-xs text-muted-foreground">
                  关闭后将写入此浏览器的本地存储
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.rememberKey}
                onChange={(event) => settings.setRememberKey(event.target.checked)}
                className="switch-control"
              />
            </label>
          </section>
          </>}

          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">聊天模型</span>
              <button
                type="button"
                onClick={() => void settings.loadModels()}
                disabled={settings.loadState === "loading"}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
              >
                <RefreshCw
                  className={cn("size-3.5", settings.loadState === "loading" && "animate-spin")}
                />
                {settings.loadState === "loading" ? "获取中" : "获取模型"}
              </button>
            </div>
            <div className="relative">
              {settings.models.length > 0 ? (
                <ModelSelect
                  models={settings.models}
                  value={settings.model}
                  onValueChange={settings.setModel}
                />
              ) : (
                <div className="settings-input">
                  <input
                    value={settings.model}
                    onChange={(event) => settings.setModel(event.target.value)}
                    placeholder="获取模型，或手动填写模型名称"
                    className="w-full bg-transparent px-3.5 py-3 text-sm outline-none"
                  />
                </div>
              )}
            </div>
            {settings.loadError && (
              <p className="text-xs leading-relaxed text-destructive">{settings.loadError}</p>
            )}
            {settings.loadState === "success" && (
              <p className="text-xs text-muted-foreground">
                已从 {activeShortUrl} 获取 {settings.models.length} 个模型
              </p>
            )}
          </section>

          <section className="space-y-3 border-t pt-5">
            <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
              <span className="flex items-center gap-2">
                <Wifi className="size-4" />
                <span>
                  <span className="block">联网搜索</span>
                  <span className="text-xs text-muted-foreground">
                    使用当前中转站提供的原生网页搜索，搜索费用按中转站规则计算
                  </span>
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.webSearch}
                onChange={(event) => settings.setWebSearch(event.target.checked)}
                className="switch-control"
              />
            </label>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
