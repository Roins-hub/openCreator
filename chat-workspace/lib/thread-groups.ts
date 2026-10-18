import { chatStorage } from "@/lib/chat-storage";

/**
 * 侧栏的聊天分组:分组列表 + 每个聊天属于哪个分组,作为一条记录存在聊天记录同一个存储里
 * (工作台模式在服务器、独立部署在浏览器 IndexedDB),换设备也在。
 */
export type ThreadGroup = { id: string; name: string; collapsed?: boolean };
export type ThreadGroups = { groups: ThreadGroup[]; assign: Record<string, string> };

const STORAGE_KEY = "sub2chat:groups";
export const MAX_THREAD_GROUPS = 50;

export const emptyThreadGroups = (): ThreadGroups => ({ groups: [], assign: {} });

function parse(raw: string | null): ThreadGroups {
  if (!raw) return emptyThreadGroups();
  try {
    const value = JSON.parse(raw) as Partial<ThreadGroups>;
    const groups = Array.isArray(value.groups)
      ? value.groups
          .filter((group): group is ThreadGroup =>
            Boolean(group) && typeof group.id === "string" && typeof group.name === "string")
          .slice(0, MAX_THREAD_GROUPS)
      : [];
    const ids = new Set(groups.map((group) => group.id));
    const assign = Object.fromEntries(
      Object.entries(value.assign && typeof value.assign === "object" ? value.assign : {})
        .filter(([, groupId]) => typeof groupId === "string" && ids.has(groupId)),
    );
    return { groups, assign };
  } catch {
    return emptyThreadGroups();
  }
}

export async function loadThreadGroups() {
  return parse(await chatStorage.getItem(STORAGE_KEY));
}

export async function saveThreadGroups(value: ThreadGroups) {
  await chatStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

/** 把一批聊天移到某个分组;groupId 为空表示移出分组 */
export function moveThreads(value: ThreadGroups, threadIds: string[], groupId: string | undefined): ThreadGroups {
  const assign = { ...value.assign };
  for (const id of threadIds) {
    if (groupId) assign[id] = groupId;
    else delete assign[id];
  }
  return { ...value, assign };
}

/** 解散分组:分组删掉,里面的聊天回到未分组 */
export function dissolveGroup(value: ThreadGroups, groupId: string): ThreadGroups {
  return {
    groups: value.groups.filter((group) => group.id !== groupId),
    assign: Object.fromEntries(Object.entries(value.assign).filter(([, id]) => id !== groupId)),
  };
}

export const newGroupId = () => `g-${crypto.randomUUID().slice(0, 8)}`;
