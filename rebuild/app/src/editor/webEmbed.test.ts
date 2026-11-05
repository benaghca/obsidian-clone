import { expect, test, vi } from "vitest";
vi.mock("../api", () => ({ api: { allowFrameOrigin: async () => {} } }));
import { webEmbedMode, webFrameTarget } from "./webEmbed";

test("embedded pages default to always, and Cinder's auto means the same", () => {
  expect(webEmbedMode(undefined)).toBe("always");
  expect(webEmbedMode("auto")).toBe("always");
  expect(webEmbedMode("click")).toBe("click");
  expect(webEmbedMode("off")).toBe("off");
  expect(webEmbedMode("sometimes")).toBe("always");
});

test("a frame target is an http(s) origin with no userinfo", () => {
  expect(webFrameTarget("http://127.0.0.1:9/page")).toEqual({ href: "http://127.0.0.1:9/page", origin: "http://127.0.0.1:9" });
  expect(webFrameTarget("https://Example.COM:443/a")).toEqual({ href: "https://example.com/a", origin: "https://example.com" });
  expect(webFrameTarget("http://docs.local/")).toEqual({ href: "http://docs.local/", origin: "http://docs.local" });
  expect(webFrameTarget("javascript:alert(1)")).toBeNull();
  expect(webFrameTarget("file:///tmp/x.html")).toBeNull();
  expect(webFrameTarget("https://user:secret@docs.local/a")).toBeNull();
  expect(webFrameTarget("not a url")).toBeNull();
  expect(webFrameTarget("")).toBeNull();
});
