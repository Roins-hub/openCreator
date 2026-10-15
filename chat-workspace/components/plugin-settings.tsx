"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { IMAGE_WORKSPACE_PLUGIN_ID, type WorkspacePluginId } from "@/lib/plugins";

const STORAGE_KEY = "sub2-chat-plugin-settings";

type StoredPluginSettings = Partial<Record<WorkspacePluginId, boolean>>;

type PluginSettingsContextValue = {
  isEnabled: (pluginId: WorkspacePluginId) => boolean;
  setEnabled: (pluginId: WorkspacePluginId, enabled: boolean) => void;
};

const PluginSettingsContext = createContext<PluginSettingsContextValue | null>(null);

const DEFAULT_SETTINGS: Record<WorkspacePluginId, boolean> = {
  [IMAGE_WORKSPACE_PLUGIN_ID]: true,
};

const readStoredSettings = (): StoredPluginSettings => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as StoredPluginSettings;
  } catch {
    return {};
  }
};

export function PluginSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings((current) => ({ ...current, ...readStoredSettings() }));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [hydrated, settings]);

  const value = useMemo<PluginSettingsContextValue>(
    () => ({
      isEnabled: (pluginId) => settings[pluginId] !== false,
      setEnabled: (pluginId, enabled) =>
        setSettings((current) => ({ ...current, [pluginId]: enabled })),
    }),
    [settings],
  );

  return <PluginSettingsContext.Provider value={value}>{children}</PluginSettingsContext.Provider>;
}

export function usePluginSettings() {
  const value = useContext(PluginSettingsContext);
  if (!value) throw new Error("usePluginSettings must be used inside PluginSettingsProvider");
  return value;
}
