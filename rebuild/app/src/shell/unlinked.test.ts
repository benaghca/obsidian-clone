import { describe, expect, it } from "vitest";
import { unlinkedMentions } from "./unlinked";

const notes = [
  { name: "Ideas", path: "Ideas.md" },
  { name: "Project roadmap", path: "Projects/Project roadmap.md" },
  { name: "Project", path: "Project.md" },
  { name: "2026-10-19", path: "Daily/2026-10-19.md" },
  { name: "Welcome", path: "Welcome.md" },
  { name: "C++", path: "C++.md" },
];
const found = (text: string) => unlinkedMentions(text, notes, "Welcome.md").map((m) => `${m.line}:${m.text.slice(m.from, m.to)}>${m.name}`);

describe("unlinkedMentions", () => {
  it("finds other notes' names as whole words, any case, longest name first", () => {
    expect(found("Some ideas about the project ROADMAP and the Project.")).toEqual([
      "1:ideas>Ideas",
      "1:project ROADMAP>Project roadmap",
      "1:Project>Project",
    ]);
    expect(found("Ideasx and xIdeas and Idea")).toEqual([]);
    expect(found("See 2026-10-19 and 2026-10-20")).toEqual(["1:2026-10-19>2026-10-19"]);
  });

  it("skips the note itself, links, tags, code, URLs and frontmatter", () => {
    expect(found("Welcome to [[Ideas]] and [Ideas](Ideas.md), #Ideas `Ideas` https://x.org/Ideas")).toEqual([]);
    expect(found("---\ntags: [Ideas]\n---\nIdeas")).toEqual(["4:Ideas>Ideas"]);
    // A YAML "..." line closes no frontmatter (as in Obsidian), so those lines are text.
    expect(found("---\nIdeas\n...\nIdeas")).toEqual(["2:Ideas>Ideas", "4:Ideas>Ideas"]);
    expect(found("```\nIdeas\n```\n~~~~\nIdeas\n~~~~\nIdeas")).toEqual(["7:Ideas>Ideas"]);
  });

  it("allows any whitespace between the words of a name", () => {
    expect(found("Project   roadmap")).toEqual(["1:Project   roadmap>Project roadmap"]);
  });

  it("is quick on a long note", () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ name: `Note number ${i}`, path: `n${i}.md` }));
    const text = Array.from({ length: 5000 }, (_, i) => `Line ${i} mentions note number ${i % 1500} and Ideas, then some more words to read`).join("\n");
    const t0 = performance.now();
    const hits = unlinkedMentions(text, [...notes, ...many], null);
    const ms = performance.now() - t0;
    expect(hits.length).toBeGreaterThan(5000);
    expect(ms).toBeLessThan(300); // a guard against going quadratic; the view also runs it in slices
  });
});
