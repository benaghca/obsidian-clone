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

const roadmap = `---
status: active
due: 2026-11-01
tags: [planning]
---
Planning notes for the rebuild. See [[Welcome]] for the feature tour.

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

const ideas = `---
status: draft
rating: 3
---
Loose ideas, most of them for #ideas/later.

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

/**
 * A synthetic vault for measuring the graph view (dev only, `?synthetic=1000`
 * on the dev page): `n` notes in a few folders with about `links` links
 * between them, chosen with preferential attachment so a few notes are hubs,
 * as in a real vault. Every fifth link is a markdown link, every tenth note
 * links to a note that doesn't exist, and every 97th note is an orphan. The
 * same arguments always give the same vault.
 */
export function syntheticVault(n: number, links = n * 3): Record<string, string> {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const words = "alpha beta gamma delta river stone garden forest cloud signal lantern harbor meadow copper ember willow cedar maple orbit prism quartz echo".split(" ");
  const folders = ["", "Projects", "Areas", "Resources", "Journal", "Archive/Old"];
  const notes = Array.from({ length: n }, (_, i) => {
    const name = `${words[i % words.length]} ${words[(i * 7 + 3) % words.length]} ${i}`;
    return { path: `${folders[i % folders.length] ? folders[i % folders.length] + "/" : ""}${name}.md`, name, links: new Set<number>() };
  });
  const degree = new Array(n).fill(1);
  let total = n;
  const pick = () => {
    let r = rnd() * total;
    for (let i = 0; i < n; i++) if ((r -= degree[i]) <= 0) return i;
    return n - 1;
  };
  for (let made = 0, tries = 0; made < links && tries < links * 20; tries++) {
    const a = Math.floor(rnd() * n);
    const b = pick();
    if (a % 97 === 5 || b % 97 === 5 || b === a || notes[a].links.has(b)) continue;
    notes[a].links.add(b);
    degree[a]++;
    degree[b]++;
    total += 2;
    made++;
  }
  const out: Record<string, string> = {};
  notes.forEach((note, i) => {
    const lines = [`# ${note.name}`, "", `Some text about ${note.name}.`, ""];
    // Every fourth note has properties (for the properties index and [property] search).
    if (i % 4 === 0) lines.unshift("---", `status: ${["draft", "active", "done"][i % 3]}`, `rating: ${i % 5}`, "---");
    let k = 0;
    for (const b of note.links) {
      const to = notes[b];
      lines.push(k++ % 5 === 4 ? `See [${to.name}](${to.path.replace(/ /g, "%20")}).` : `Related: [[${to.name}]]`);
    }
    if (i % 10 === 0) lines.push(`Missing: [[Unwritten ${i % 50}]]`);
    lines.push("", `#topic/${words[i % 5]} #${words[(i * 3) % 8]}`);
    out[note.path] = lines.join("\n") + "\n";
  });
  return out;
}
