import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity", () => ({ requireUser: vi.fn(async () => ({ userId: "0123456789abcdef0123456789abcdef" })) }));

afterEach(() => vi.restoreAllMocks());

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/client-log", { method: "POST", body: JSON.stringify(body) }));
};

describe("POST /api/client-log", () => {
  it("writes a short, sanitized line to the service log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await post({ event: "image-progress-fallback", reason: "network", origin: "https://other.example", online: true, attempts: 2 });
    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("原图进度降级为直接加载");
    expect(line).toContain("reason=network origin=https://other.example online=true attempts=2 user=01234567");
    expect(line).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("rejects unknown events", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await post({ event: "anything", reason: "x", origin: "y" });
    expect(response.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });
});
