export const IMAGE_WORKSPACE_PLUGIN_ID = "image-workspace";

export const WORKSPACE_PLUGINS = [
  {
    id: IMAGE_WORKSPACE_PLUGIN_ID,
    name: "生图工作台",
    command: "/生图",
    description: "把画面需求整理成生图提示词，并带到 Zenith 工作台。",
    usage: "/生图 一只猫坐在窗边，写实摄影风格",
  },
] as const;

export type WorkspacePluginId = (typeof WORKSPACE_PLUGINS)[number]["id"];
