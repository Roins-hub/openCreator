import { beforeEach, describe, expect, it, vi } from "vitest";

const recordAsset = vi.hoisted(() => vi.fn(async () => undefined));
const userId = "c".repeat(32);

vi.mock("@/lib/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/identity")>()),
  requireUser: async () => ({ apiKey: "k", userId, relay: {} }),
}));
vi.mock("@/lib/object-store", () => ({
  objectSize: async () => 1234, deleteObject: async () => undefined, signedUploadUrl: async () => "https://upload.example",
}));
vi.mock("@/lib/asset-store", () => ({ recordAsset }));

const { POST } = await import("./route");
const { mediaPrefix } = await import("@/lib/identity");

const complete = (purpose?: "chat") => POST(new Request("http://x/api/uploads/direct", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ step: "complete", name: "猫.png", type: "image/png", path: `${mediaPrefix(userId)}uploads/1-abc-猫.png`, purpose }),
}));

describe("direct upload complete", () => {
  beforeEach(() => recordAsset.mockClear());

  it("records composer uploads in the asset library", async () => {
    const response = await complete();
    expect(response.ok).toBe(true);
    expect(recordAsset).toHaveBeenCalledWith(userId, expect.objectContaining({
      kind: "image", name: "猫.png", size: 1234, source: "upload",
    }));
  });

  it("leaves chat attachments to the chat page", async () => {
    await complete("chat");
    expect(recordAsset).not.toHaveBeenCalled();
  });
});
