"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  CUSTOM_PROVIDER_ID,
  customApiBase,
  DEFAULT_PROVIDER_ID,
  isProviderChoice,
  type ProviderChoice,
} from "@/lib/providers";
import {
  clampReasoningEffort,
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
  reasoningEffortsForModel,
  type ReasoningEffort,
} from "@/lib/reasoning";
import { MOTE_MODE, moteChatKey, moteRelayBase, onMoteSettingsChange, withBasePath } from "@/lib/mote";

type LoadState = "idle" | "loading" | "success" | "error";

type ChatSettingsValue = {
  provider: ProviderChoice;
  setProvider: (provider: ProviderChoice) => void;
  customUrl: string;
  setCustomUrl: (url: string) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  rememberKey: boolean;
  setRememberKey: (remember: boolean) => void;
  model: string;
  setModel: (model: string) => void;
  models: string[];
  loadModels: () => Promise<void>;
  loadState: LoadState;
  loadError: string;
  webSearch: boolean;
  setWebSearch: (enabled: boolean) => void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (effort: ReasoningEffort) => void;
};

const ChatSettingsContext = createContext<ChatSettingsValue | null>(null);

const keyName = (provider: ProviderChoice) => `sub2chat:key:${provider}`;
const rememberName = (provider: ProviderChoice) => `sub2chat:remember:${provider}`;
const modelName = (provider: ProviderChoice) => `sub2chat:model:${provider}`;
const CUSTOM_URL_NAME = "sub2chat:custom-url";

export function ChatSettingsProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProviderState] = useState<ProviderChoice>(DEFAULT_PROVIDER_ID);
  const [customUrl, setCustomUrlState] = useState("");
  const [apiKey, setApiKeyState] = useState("");
  const [rememberKey, setRememberKeyState] = useState(false);
  const [model, setModelState] = useState("");
  const [modelsByProvider, setModelsByProvider] = useState<
    Partial<Record<ProviderChoice, string[]>>
  >({});
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState("");
  const [webSearch, setWebSearchState] = useState(false);
  const [reasoningEffort, setReasoningEffortState] =
    useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);

  const hydrateProvider = useCallback((next: ProviderChoice) => {
    const remembered = localStorage.getItem(rememberName(next)) === "true";
    const storedKey = remembered
      ? localStorage.getItem(keyName(next))
      : sessionStorage.getItem(keyName(next));
    setApiKeyState(storedKey ?? "");
    setRememberKeyState(remembered);
    setModelState(localStorage.getItem(modelName(next)) ?? "");
    setLoadState("idle");
    setLoadError("");
  }, []);

  // 工作台模式:Key 和中转站地址都来自工作台设置(同一域名下的 localStorage)
  const hydrateFromMote = useCallback(() => {
    const base = moteRelayBase();
    const next: ProviderChoice = base ? CUSTOM_PROVIDER_ID : DEFAULT_PROVIDER_ID;
    setProviderState(next);
    setCustomUrlState(base);
    setApiKeyState(moteChatKey());
    setRememberKeyState(true);
    setModelState(localStorage.getItem(modelName(next)) ?? "");
    setModelsByProvider({});
    setLoadState("idle");
    setLoadError("");
  }, []);

  useEffect(() => {
    if (!MOTE_MODE) return;
    hydrateFromMote();
    return onMoteSettingsChange(hydrateFromMote);
  }, [hydrateFromMote]);

  useEffect(() => {
    if (MOTE_MODE) return;
    const storedProvider = localStorage.getItem("sub2chat:provider");
    const next = isProviderChoice(storedProvider) ? storedProvider : DEFAULT_PROVIDER_ID;
    setProviderState(next);
    setCustomUrlState(localStorage.getItem(CUSTOM_URL_NAME) ?? "");
    hydrateProvider(next);
    setWebSearchState(localStorage.getItem("sub2chat:web-search") === "true");
    const storedReasoningEffort = localStorage.getItem("sub2chat:reasoning-effort");
    setReasoningEffortState(
      normalizeReasoningEffort(storedReasoningEffort) ?? DEFAULT_REASONING_EFFORT,
    );
  }, [hydrateProvider]);

  useEffect(() => {
    if (!MOTE_MODE) return;
    setWebSearchState(localStorage.getItem("sub2chat:web-search") === "true");
    setReasoningEffortState(
      normalizeReasoningEffort(localStorage.getItem("sub2chat:reasoning-effort")) ??
        DEFAULT_REASONING_EFFORT,
    );
  }, []);

  useEffect(() => {
    const available = reasoningEffortsForModel(model);
    if (available.length === 0 || available.includes(reasoningEffort)) return;

    const next = available.at(-1) ?? DEFAULT_REASONING_EFFORT;
    setReasoningEffortState(next);
    localStorage.setItem("sub2chat:reasoning-effort", next);
  }, [model, reasoningEffort]);

  const setProvider = (next: ProviderChoice) => {
    if (MOTE_MODE) return;
    setProviderState(next);
    localStorage.setItem("sub2chat:provider", next);
    hydrateProvider(next);
  };

  const setCustomUrl = (url: string) => {
    if (MOTE_MODE) return;
    setCustomUrlState(url);
    localStorage.setItem(CUSTOM_URL_NAME, url);
    // 换了地址,之前拉到的模型列表不再可信
    setModelsByProvider(({ [CUSTOM_PROVIDER_ID]: _stale, ...rest }) => rest);
    setLoadState("idle");
    setLoadError("");
  };

  const setApiKey = (key: string) => {
    if (MOTE_MODE) return;
    setApiKeyState(key);
    if (rememberKey) localStorage.setItem(keyName(provider), key);
    else sessionStorage.setItem(keyName(provider), key);
  };

  const setRememberKey = (remember: boolean) => {
    if (MOTE_MODE) return;
    setRememberKeyState(remember);
    localStorage.setItem(rememberName(provider), String(remember));
    if (remember) {
      localStorage.setItem(keyName(provider), apiKey);
      sessionStorage.removeItem(keyName(provider));
    } else {
      sessionStorage.setItem(keyName(provider), apiKey);
      localStorage.removeItem(keyName(provider));
    }
  };

  const setModel = (next: string) => {
    setModelState(next);
    localStorage.setItem(modelName(provider), next);
  };

  const setWebSearch = (enabled: boolean) => {
    setWebSearchState(enabled);
    localStorage.setItem("sub2chat:web-search", String(enabled));
  };

  const setReasoningEffort = (effort: ReasoningEffort) => {
    const next = clampReasoningEffort(model, effort) ?? effort;
    setReasoningEffortState(next);
    localStorage.setItem("sub2chat:reasoning-effort", next);
  };

  const loadModels = async () => {
    if (provider === CUSTOM_PROVIDER_ID && !customApiBase(customUrl)) {
      setLoadState("error");
      setLoadError("请先填写有效的中转站地址");
      return;
    }
    if (!apiKey.trim()) {
      setLoadState("error");
      setLoadError(MOTE_MODE ? "请先在工作台「设置」里填写 API Key" : "请先填写 API Key");
      return;
    }
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch(withBasePath("/api/models"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, customUrl, key: apiKey }),
      });
      const data = (await response.json()) as { models?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "获取模型失败");
      const nextModels = data.models ?? [];
      setModelsByProvider((current) => ({ ...current, [provider]: nextModels }));
      if (nextModels.length > 0 && !nextModels.includes(model)) {
        setModel(nextModels[0]!);
      }
      setLoadState("success");
    } catch (error) {
      setLoadState("error");
      setLoadError(error instanceof Error ? error.message : "获取模型失败");
    }
  };

  // 工作台模式下 Key 已经有了,打开就拉模型列表,不用手动点「获取模型」
  useEffect(() => {
    if (MOTE_MODE && apiKey && loadState === "idle" && !modelsByProvider[provider]) void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, provider, loadState]);

  const value = useMemo<ChatSettingsValue>(
    () => ({
      provider,
      setProvider,
      customUrl,
      setCustomUrl,
      apiKey,
      setApiKey,
      rememberKey,
      setRememberKey,
      model,
      setModel,
      models: modelsByProvider[provider] ?? [],
      loadModels,
      loadState,
      loadError,
      webSearch,
      setWebSearch,
      reasoningEffort,
      setReasoningEffort,
    }),
    [
      provider,
      customUrl,
      apiKey,
      rememberKey,
      model,
      modelsByProvider,
      loadState,
      loadError,
      webSearch,
      reasoningEffort,
    ],
  );

  return <ChatSettingsContext.Provider value={value}>{children}</ChatSettingsContext.Provider>;
}

export function useChatSettings() {
  const value = useContext(ChatSettingsContext);
  if (!value) throw new Error("useChatSettings must be used inside provider");
  return value;
}
