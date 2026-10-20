// Sample notes for the mock backend. "Big note" is generated to match the
// spec's stress case: 5,000 lines of mixed markdown, about 330k characters.

const welcome = `This is a sample vault served by the in-browser mock backend. Everything here lives in memory, so reloading the page resets it.

## Live Preview

Markdown syntax hides until your cursor touches it. Try moving through **bold text**, *italic text*, ~~struck text~~ and \`inline code\`.

Links work the same way: [[Project roadmap]] is a wikilink, [[Reading list|this one]] has display text, and [Obsidian](https://obsidian.md) is a markdown link. Click a link to follow it, then use the back arrow above.

Remote images are never fetched. This one shows as a link you can click to open it in your browser: ![A remote picture](https://example.com/picture.png)

Type [[ to link another note. Tags like #getting-started and #ideas/later stay rendered.

### Lists and tasks

- Bullets render as dots
- Even when the cursor is on the line
  - Nested bullets too
- [ ] An open task
- [x] A finished task

1. Numbered lists
2. Keep their numbers

> Blockquotes get an accent bar.

---

Open [[Big note]] to try a 5,000-line note.
`;

const roadmap = `Planning notes for the rebuild. See [[Welcome]] for the feature tour.

## Milestones

- [x] Feel spec written #planning
- [x] Contract between front end and backend
- [ ] Editor with Live Preview
- [ ] File watcher and search
- [ ] Graph view

## Open questions

- How should **renames** update links? Probably after [[Ideas]] settles.
- Keep \`write_note\` atomic.
`;

const ideas = `Loose ideas, most of them for #ideas/later.

- Daily notes template, see [[2026-10-19]]
- A reading queue in [[Reading list]]
- Faster search ranking
`;

const reading = `---
tags:
  - books
  - "#queue/later"
---
Books and papers to read. #reading

- [ ] *Designing Data-Intensive Applications*
- [ ] *The Pragmatic Programmer*
- [x] *A Philosophy of Software Design*

Linked from [[Welcome]].
`;

const daily = `## Today

- [ ] Review [[Project roadmap]]
- [ ] Sketch the graph view #planning
- Talked about \`CodeMirror\` decorations
- Went over the project roadmap with the team

## Notes

Nothing else yet.
`;

function bigNote(): string {
  const words = (
    "the vault keeps every note as a plain markdown file so other tools can read it while " +
    "this editor renders headings links and lists in place without a separate preview pane " +
    "typing should stay smooth even when the document holds thousands of lines"
  ).split(" ");
  // Small deterministic generator so the note is the same on every load.
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const sentence = (len: number) => {
    const out: string[] = [];
    for (let i = 0; i < len; i++) out.push(words[rand(words.length)]);
    const s = out.join(" ");
    return s[0].toUpperCase() + s.slice(1) + ".";
  };

  const lines: string[] = [];
  let section = 0;
  while (lines.length < 5000) {
    const n = lines.length;
    if (n % 100 === 0) {
      section++;
      lines.push(`## Section ${section}`);
      continue;
    }
    switch (rand(10)) {
      case 0:
        lines.push(`- ${sentence(8)} See [[Welcome]] and #topic-${section % 7}.`);
        break;
      case 1:
        lines.push(`- [${rand(2) ? "x" : " "}] Task ${n}: ${sentence(6)}`);
        break;
      case 2:
        lines.push(`${sentence(6)} **${sentence(3)}** then \`code_${n}\` and *${sentence(2)}*`);
        break;
      case 3:
        lines.push("");
        break;
      case 4:
        lines.push(`> ${sentence(10)}`);
        break;
      default:
        lines.push(`${sentence(10)} ${sentence(4)}`);
    }
  }
  return lines.slice(0, 5000).join("\n");
}

export function sampleVault(): Record<string, string> {
  return {
    "Welcome.md": welcome,
    "Big note.md": bigNote(),
    "Ideas.md": ideas,
    "Reading list.md": reading,
    "Projects/Project roadmap.md": roadmap,
    "Daily/2026-10-19.md": daily,
  };
}
