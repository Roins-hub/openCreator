// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { apiKeyHeaders, isImageOnly, readApiKey, writeApiKey, writeImageKey } from "./api-key";

describe("account key", () => {
  beforeEach(() => window.localStorage.clear());

  it("falls back to the image key and marks image-only requests", () => {
    writeImageKey("sk-image");
    expect(readApiKey()).toBe("sk-image");
    expect(isImageOnly()).toBe(true);
    expect(apiKeyHeaders()).toEqual({ "x-tangzhi-key": "sk-image", "x-tangzhi-image-only": "1" });
  });

  it("uses the video key as the account and sends the image key separately", () => {
    writeApiKey("sk-video");
    writeImageKey("sk-image");
    expect(readApiKey()).toBe("sk-video");
    expect(isImageOnly()).toBe(false);
    expect(apiKeyHeaders()).toEqual({ "x-tangzhi-key": "sk-video", "x-tangzhi-image-key": "sk-image" });
  });
});
