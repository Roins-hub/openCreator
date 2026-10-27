// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { preconnectMedia } from "./api-key";

afterEach(() => { document.head.innerHTML = ""; });

describe("preconnectMedia", () => {
  it("adds a plain and a CORS preconnect once", () => {
    preconnectMedia("https://media.example.com");
    preconnectMedia("https://media.example.com");
    const links = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"]')];
    expect(links).toHaveLength(2);
    expect(links.map((link) => [link.href, link.crossOrigin])).toEqual([
      ["https://media.example.com/", null], ["https://media.example.com/", "anonymous"],
    ]);
  });

  it("ignores anything that is not an http(s) origin", () => {
    preconnectMedia("javascript:alert(1)");
    expect(document.head.querySelectorAll("link")).toHaveLength(0);
  });
});
