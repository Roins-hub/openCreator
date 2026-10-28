import { describe, expect, it } from "vitest";
import { applyAdjust, straightenScale } from "./image-editor";

describe("image editor maths", () => {
  it("leaves pixels alone when nothing is adjusted", () => {
    const data = new Uint8ClampedArray([10, 120, 240, 255]);
    applyAdjust(data, { brightness: 0, contrast: 0, saturation: 0, warmth: 0 });
    expect([...data]).toEqual([10, 120, 240, 255]);
  });

  it("brightens, desaturates and warms", () => {
    const bright = new Uint8ClampedArray([100, 100, 100, 255]);
    applyAdjust(bright, { brightness: 50, contrast: 0, saturation: 0, warmth: 0 });
    expect(bright[0]).toBe(164);

    const gray = new Uint8ClampedArray([200, 100, 50, 255]);
    applyAdjust(gray, { brightness: 0, contrast: 0, saturation: -100, warmth: 0 });
    expect(gray[0]).toBe(gray[1]);
    expect(gray[1]).toBe(gray[2]);

    const warm = new Uint8ClampedArray([100, 100, 100, 255]);
    applyAdjust(warm, { brightness: 0, contrast: 0, saturation: 0, warmth: 40 });
    expect(warm[0]).toBeGreaterThan(100);
    expect(warm[2]).toBeLessThan(100);
    expect(warm[3]).toBe(255);
  });

  it("zooms in just enough to hide the corners when straightening", () => {
    expect(straightenScale(1000, 500, 0)).toBe(1);
    const scale = straightenScale(1000, 500, 10);
    const angle = 10 * Math.PI / 180;
    // 放大后的矩形转回去,四个角都还在原图里
    expect(1000 * scale * Math.cos(angle) + 500 * scale * Math.sin(angle)).toBeLessThanOrEqual(1000 + 1e-9);
    expect(1000 * scale * Math.sin(angle) + 500 * scale * Math.cos(angle)).toBeLessThanOrEqual(500 + 1e-9);
    expect(straightenScale(1000, 500, -10)).toBe(scale);
  });
});
