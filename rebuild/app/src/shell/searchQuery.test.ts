import { describe, expect, it } from "vitest";
import { matchesPath, parseSearchQuery, pathQuery } from "./searchQuery";

describe("search query", () => {
  it("splits off a path filter, quoted or not, anywhere in the query", () => {
    expect(parseSearchQuery("roadmap")).toEqual({ text: "roadmap", path: "" });
    expect(parseSearchQuery('path:"Projects/Big ideas" roadmap')).toEqual({ text: "roadmap", path: "projects/big ideas" });
    expect(parseSearchQuery("roadmap path:Daily")).toEqual({ text: "roadmap", path: "daily" });
    expect(parseSearchQuery(pathQuery("Projects"))).toEqual({ text: "", path: "projects" });
  });

  it("matches the folder anywhere in the path, ignoring case", () => {
    expect(matchesPath("Projects/Roadmap.md", "projects")).toBe(true);
    expect(matchesPath("Ideas.md", "projects")).toBe(false);
    expect(matchesPath("Ideas.md", "")).toBe(true);
  });
});
