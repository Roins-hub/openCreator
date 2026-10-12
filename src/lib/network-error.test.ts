import { describe, expect, it } from "vitest";
import { NETWORK_ERROR, readableError } from "./network-error";

describe("readableError", () => {
  it("translates browser network failures", () => {
    for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      expect(readableError(message)).toBe(NETWORK_ERROR);
    }
  });

  it("keeps other messages", () => {
    expect(readableError("API Key 无效")).toBe("API Key 无效");
  });
});
