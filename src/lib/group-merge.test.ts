import { describe, expect, it } from "vitest";
import { mergeGroups } from "./group-store";

const group = (id: string, name = id) => ({ id, name });

describe("saving groups from several devices", () => {
  it("keeps a group another device created that this device never saw", () => {
    // 设备 B 打开页面时只有 a、b;设备 A 之后新建了 cat
    const server = [group("cat", "买猫猫"), group("a"), group("b")];
    const fromB = [group("a"), { ...group("b"), collapsed: true }];
    expect(mergeGroups(server, fromB, ["a", "b"])).toEqual([group("cat", "买猫猫"), group("a"), { ...group("b"), collapsed: true }]);
  });

  it("still deletes and renames the groups this device knows", () => {
    const server = [group("a"), group("b")];
    expect(mergeGroups(server, [group("b", "新名字")], ["a", "b"])).toEqual([group("b", "新名字")]);
  });
});
