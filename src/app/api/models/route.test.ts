import { describe, expect, it, vi } from "vitest";

const catalogModels = vi.hoisted(() => vi.fn(async () => [
  { type: "video", id: "sd2.5" },
  { type: "image", id: "gpt-image-2" },
]));
vi.mock("@/lib/tangzhi-server", () => ({ catalogModels }));

import { GET } from "./route";

describe("GET /api/models", () => {
  it("lists only image models when only the image key is set", async () => {
    const response = await GET(new Request("http://x/api/models", {
      headers: { "x-tangzhi-key": "sk-image", "x-tangzhi-image-only": "1" },
    }));
    expect((await response.json()).map((model: { id: string }) => model.id)).toEqual(["gpt-image-2"]);
  });

  it("lists both kinds otherwise, passing the image key along", async () => {
    const response = await GET(new Request("http://x/api/models", {
      headers: { "x-tangzhi-key": "sk-video", "x-tangzhi-image-key": "sk-image" },
    }));
    expect((await response.json())).toHaveLength(2);
    expect(catalogModels).toHaveBeenLastCalledWith(expect.anything(), "sk-video", "sk-image");
  });
});
