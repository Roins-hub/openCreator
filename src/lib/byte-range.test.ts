import { describe, expect, it } from "vitest";
import { parseByteRange } from "./byte-range";

describe("parseByteRange", () => {
  it("parses closed, open and suffix ranges", () => {
    expect(parseByteRange("bytes=0-1023", 5000)).toEqual({ start: 0, end: 1023 });
    expect(parseByteRange("bytes=4000-", 5000)).toEqual({ start: 4000, end: 4999 });
    expect(parseByteRange("bytes=-500", 5000)).toEqual({ start: 4500, end: 4999 });
  });

  it("clamps the end to the file size", () => {
    expect(parseByteRange("bytes=100-999999", 5000)).toEqual({ start: 100, end: 4999 });
  });

  it("rejects malformed or unsatisfiable ranges", () => {
    expect(parseByteRange("bytes=5000-", 5000)).toBeNull();
    expect(parseByteRange("bytes=10-5", 5000)).toBeNull();
    expect(parseByteRange("bytes=-", 5000)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-9", 5000)).toBeNull();
    expect(parseByteRange("items=0-1", 5000)).toBeNull();
  });
});
