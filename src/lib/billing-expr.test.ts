import { describe, expect, it } from "vitest";
import { evaluateExpr, parseExpr } from "./billing-expr";

describe("billing expressions", () => {
  it("evaluates token pricing in micro-dollars (matches the relay's charge)", () => {
    // 2026-10-15 实际一次扣费:95 输入 + 915 输出 token,额度 13963 = $0.0279
    const result = evaluateExpr('tier("standard", p * 5 + cr * 1.25 + img * 8 + c * 30)', { vars: { p: 95, c: 915 } });
    expect(result).toEqual({ micros: 27925, tier: "standard" });
  });

  it("follows size conditions and fixed prices", () => {
    const expr = '(!(has(param("size"), "2048") || has(param("size"), "4096")) ? tier("1K", fixed(0.12)) : !has(param("size"), "4096") ? tier("2K", fixed(0.24)) : tier("4K", fixed(0.36))) * image_count';
    expect(evaluateExpr(expr, { vars: { image_count: 1 }, params: { size: "1280x720" } })).toEqual({ micros: 120000, tier: "1K" });
    expect(evaluateExpr(expr, { vars: { image_count: 2 }, params: { size: "2048x1152" } })).toEqual({ micros: 480000, tier: "2K" });
    expect(evaluateExpr(expr, { vars: { image_count: 1 }, params: { size: "4096x2304" } }).tier).toBe("4K");
  });

  it("handles precedence, comparisons and min / max", () => {
    expect(evaluateExpr("1 + 2 * 3").micros).toBe(7);
    expect(evaluateExpr("len <= 272000 ? tier(\"a\", p * 2) : tier(\"b\", p * 4)", { vars: { len: 300000, p: 1 } }))
      .toEqual({ micros: 4, tier: "b" });
    expect(evaluateExpr("max(1, 3) - min(2, 5)").micros).toBe(1);
  });

  it("rejects what it cannot parse", () => {
    expect(() => parseExpr("tier(\"x\", p * )")).toThrow();
    expect(() => evaluateExpr("unknown_fn(1)")).toThrow();
  });
});
