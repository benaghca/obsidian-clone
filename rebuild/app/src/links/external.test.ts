import { expect, test } from "vitest";
import { isExternalUrl, isRemoteUrl } from "./external";

test("only http, https and mailto links open externally", () => {
  for (const url of ["https://obsidian.md", "http://example.com/a?b", "HTTPS://EXAMPLE.COM", "mailto:me@example.com", " https://x.y "]) {
    expect(isExternalUrl(url)).toBe(true);
  }
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "tauri://localhost", "ftp://x", "https://", "mailto:", "Welcome", "//cdn.example.com/x"]) {
    expect(isExternalUrl(url)).toBe(false);
  }
});

test("remote means http(s) only", () => {
  expect(isRemoteUrl("https://example.com/a.png")).toBe(true);
  expect(isRemoteUrl("images/a.png")).toBe(false);
  expect(isRemoteUrl("mailto:a@b.c")).toBe(false);
});
