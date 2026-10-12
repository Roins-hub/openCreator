import { describe, expect, it } from "vitest";
import { friendlyMessage, upstreamMessage } from "./tangzhi-server";

describe("relay error messages", () => {
  it("explains a failed quota pre-deduction", () => {
    expect(friendlyMessage("预扣费额度失败, 用户剩余额度: ✦8.054192, 需要预扣费额度: ✦9.200000"))
      .toBe("中转站余额不足：本次需预扣 9.20，当前剩余 8.05。请到 1xxai.com 充值，或改用更短时长、更便宜的模型。");
    expect(friendlyMessage("prompt 太短")).toBe("prompt 太短");
  });

  it("unwraps nested error JSON", () => {
    expect(upstreamMessage({
      code: "fail_to_fetch_task",
      message: JSON.stringify({ error: { code: "invalid_params", message: "mode 为必填项" } }),
    }, 400)).toBe("mode 为必填项");
  });
});
