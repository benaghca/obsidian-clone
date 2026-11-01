// LINKS-EMBEDS-EDGE-TESTS: edge cases and a fixed-seed fuzz for wikilinks,
// link targets, renames, embeds, callouts, tables, tags, and daily-note dates.
// Pure functions, loaded the way bench-feel.mjs loads them. No vault directory,
// no browser, no screenshots. Not wired into package.json.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});
const load = (name) => server.ssrLoadModule(fileURLToPath(new URL(`../src/${name}`, import.meta.url)));

let pass = 0;
const bugs = [];
const check = (value, message) => {
  assert.ok(value, message);
  pass++;
  console.log("PASS", message);
};
const bug = (id, detail) => {
  bugs.push({ id, detail });
  console.log("BUG", id, detail);
};

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261031);
const pick = (list) => list[Math.floor(rand() * list.length)];
const integer = (n) => Math.floor(rand() * n);

function time(fn, runs = 5) {
  const samples = [];
  let out;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    out = fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return { median: +samples[samples.length >> 1].toFixed(2), max: +samples[samples.length - 1].toFixed(2), out };
}

/** Simple fences for the fuzz, which only emits unindented ``` and ~~~ blocks. */
function scanLines(text, onCode) {
  const lines = text.split("\n");
  let fence = null;
  const bodies = [];
  let buf = [];
  const codes = [];
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) {
        fence = marker[1][0];
        buf = [];
      } else if (marker[1][0] === fence) {
        bodies.push(buf.join("\n"));
        fence = null;
      }
      continue;
    }
    if (fence) buf.push(line);
    else if (onCode) codes.push(...onCode(line));
  }
  return { bodies, codes };
}

try {
  const { EditorState, ensureSyntaxTree } = await server.ssrLoadModule(fileURLToPath(new URL("./links-embeds-edge-cm.ts", import.meta.url)));
  const internal = await load("links/internal.ts");
  const headings = await load("editor/headings.ts");
  const embeds = await load("editor/embeds.ts");
  const callouts = await load("editor/callouts.ts");
  const tables = await load("editor/tables.ts");
  const tags = await load("shell/linksTags.ts");
  const dates = await load("settings/dateFormat.ts");
  const syntax = await load("editor/syntax.ts");
  const {
    formatLink, linkResolver, linkSpellings, linkTargets, relativePath, resolveLink, rewriteLinks, encodeDest,
  } = internal;
  const { headingLabel, headingPos, headingTarget } = headings;
  const { embedPart, embedSection, embedSize, embedStopped, resetSize, resizedSize, splitSubpath } = embeds;
  const { calloutBody, calloutHeader, calloutKind } = callouts;
  const { alignments, cellTransaction, formatTable, nextCell, parseTable, previousCell, splitRow, tableAt, tableOps } = tables;
  const { frontmatterTags, tagsInLine, tagsInText, tagTree, wikilinkTargets } = tags;
  const { dateNamePattern, fillTemplate, formatDate } = dates;

  const wiki = (format) => ({ format, wikilinks: true });
  const md = (format) => ({ format, wikilinks: false });
  const notes = [
    { name: "Ideas", path: "Ideas.md" },
    { name: "Plan", path: "Projects/Plan.md" },
    { name: "Plan", path: "Archive/Plan.md" },
    { name: "Café", path: "Notes/Café.md" },
    { name: "a(b)", path: "Projects/a(b).md" },
  ];

  // --- wikilinks: aliases, headings, block refs, same-note targets ---
  check(formatLink("Ideas.md", "Projects/Plan.md", notes, wiki("shortest"), "the idea") === "[[Ideas|the idea]]", "an alias is kept when it differs from the link text");
  check(formatLink("Ideas.md", "Projects/Plan.md", notes, wiki("shortest"), "Ideas") === "[[Ideas]]", "a display equal to the link text adds no alias");
  check(formatLink("Ideas.md", "Projects/Plan.md", notes, wiki("shortest"), "") === "[[Ideas]]", "an empty display adds no alias");
  check(formatLink("Notes/Café.md", "Ideas.md", notes, wiki("shortest"), undefined, "#Morning notes") === "[[Café#Morning notes]]", "a heading subpath keeps its spaces in a wikilink");
  check(formatLink("Notes/Café.md", "Ideas.md", notes, wiki("shortest"), "cup", "#^ab12") === "[[Café#^ab12|cup]]", "a block ref keeps #^id and the alias");
  check(formatLink("", "Ideas.md", notes, wiki("shortest"), undefined, "#Local") === "[[#Local]]", "a same-note heading link has an empty file path");
  check(formatLink("Notes/Café.md", "Ideas.md", notes, md("shortest"), undefined, "#Morning notes") === "[Café](Café.md#Morning%20notes)", "a markdown heading link encodes spaces and leaves other characters as written");
  check(formatLink("", "Ideas.md", notes, md("relative"), "Local", "#Local") === "[Local](#Local)", "a markdown same-note heading omits the file");
  check(formatLink("Projects/Plan.md", "Archive/Other.md", notes, wiki("shortest")) === "[[Projects/Plan]]", "a clashing name is written as a path");
  check(formatLink("Projects/a(b).md", "Ideas.md", notes, md("absolute")) === "[a(b)](Projects/a%28b%29.md)", "parentheses in a markdown destination are percent-encoded");
  check(relativePath("Projects/Sub", "Notes/Café.md") === "../../Notes/Café.md", "relative paths climb out of the source folder");

  check(resolveLink("Café#Morning notes", "Ideas.md", notes) === "Notes/Café.md", "a heading does not change which note resolves");
  check(resolveLink("Café#^ab12", "Ideas.md", notes) === "Notes/Café.md", "a #^ block ref resolves the note");
  check(resolveLink("Notes/Caf%C3%A9.md", null, notes) === "Notes/Café.md", "a percent-encoded path decodes");
  check(resolveLink("%ZZ", null, notes) === null, "a broken percent escape does not throw");
  check(resolveLink("../../../../etc/passwd", "Notes/Café.md", notes) === null, "a path that climbs out of the vault resolves to nothing");
  check(resolveLink("", null, notes) === null && resolveLink("#Only a heading", "Ideas.md", notes) === null, "an empty target and a same-note heading resolve to nothing");
  check(resolveLink("Plan^ab12", "Ideas.md", notes) === null, "a ^ block ref without a hash is not a link to Plan");
  check(resolveLink("./Café", "Notes/Other.md", notes) === "Notes/Café.md", "a ./ path resolves from the linking note");
  check(resolveLink("Projects/a\\(b\\).md", "Ideas.md", notes) === "Projects/a(b).md", "backslash-escaped parentheses resolve");
  const spellings = linkSpellings("a(b) c");
  check(new Set(spellings).size === spellings.length, "link spellings are unique");
  check(spellings.includes("a(b) c") && spellings.includes("a(b)%20c") && spellings.includes("a\\(b\\) c"), "link spellings cover spaces and parentheses");
  const growing = [{ name: "A", path: "A.md" }];
  const resolve = linkResolver(growing);
  check(resolve("A", null) === "A.md", "a resolver uses the snapshot it was given");
  growing[0] = { name: "Zed", path: "Zed.md" };
  check(resolve("A", null) === "A.md" && resolve("Zed", null) === null, "replacing an entry without changing length keeps the cached index");
  growing.push({ name: "Zed", path: "Zed.md" });
  check(resolveLink("Zed", null, growing) === "Zed.md", "a push builds the index again");

  const files = notes.map((n) => ({ path: n.path, is_dir: false }));
  const exists = linkTargets(files, notes);
  check(exists("#here", "Ideas.md") === true, "a same-note heading counts as present");
  check(exists("Café#^ab12", "Ideas.md") === true && exists("Missing#Heading", "Ideas.md") === false, "existence follows the note, not the heading or block");
  check(exists("Plan^ab12", "Ideas.md") === false, "a hashless block ref does not count as the note");

  // --- renames keep aliases, headings, and block refs ---
  const before = [...notes, { name: "Old", path: "Old.md" }];
  const after = [...notes, { name: "New", path: "B/New.md" }];
  const source = [
    "[[Old|the alias]] [[Old#Part|the part]] ![[Old#^ab12]]",
    "[see](Old.md#Part) [esc](Old.md) [[Ideas]]",
    "`[[Old]]` and [[Old]]",
    "```",
    "[[Old#Part]]",
    "```",
    "~~~",
    "[[Old]]",
    "~~~",
    "[[Old|New]]",
  ].join("\n");
  const renamed = rewriteLinks(source, "Ideas.md", "Old.md", "B/New.md", before, after, wiki("shortest"));
  check(renamed.count === 7, `seven links outside code are rewritten (${renamed.count})`);
  check(renamed.text.includes("[[New|the alias]]") && renamed.text.includes("[[New#Part|the part]]") && renamed.text.includes("![[New#^ab12]]"), "aliases, headings, and block refs survive a rename");
  check(renamed.text.includes("[see](New.md#Part)") && renamed.text.includes("[[New|New]]"), "markdown destinations and a now-redundant alias are kept as written");
  check(renamed.text.includes("`[[Old]]`") && renamed.text.includes("```\n[[Old#Part]]\n```") && renamed.text.includes("~~~\n[[Old]]\n~~~"), "inline code and both fence markers stay literal");
  const again = rewriteLinks(renamed.text, "Ideas.md", "Old.md", "B/New.md", before, after, wiki("shortest"));
  check(again.count === 0 && again.text === renamed.text, "a second rename pass changes nothing");
  const relative = rewriteLinks("[[../Old#Part|up]]", "A/Source.md", "Old.md", "B/New.md", before, after, wiki("relative"));
  check(relative.text === "[[../B/New#Part|up]]" && relative.count === 1, "a relative rename keeps the heading and the alias");
  const absolute = rewriteLinks("[[Old]]", "A/Source.md", "Old.md", "B/New.md", before, after, wiki("absolute"));
  check(absolute.text === "[[B/New]]", "an absolute rename writes the vault path");
  const clashing = [...after, { name: "New", path: "Other/New.md" }];
  check(rewriteLinks("[[Old]]", "Ideas.md", "Old.md", "B/New.md", before, clashing, wiki("shortest")).text === "[[B/New]]", "a rename into a clashing name writes the path");
  check(rewriteLinks("[[Old]]", "Ideas.md", "Old.md", "B/New.md", before, after, md("shortest")).text === "[[New]]", "turning markdown links on does not convert an existing wikilink");
  const unclosed = rewriteLinks("```js\n[[Old]]\n[[Ideas]] still fenced", "Ideas.md", "Old.md", "B/New.md", before, after, wiki("shortest"));
  check(unclosed.count === 0 && unclosed.text.endsWith("[[Old]]\n[[Ideas]] still fenced"), "an unclosed fence protects the rest of the note");
  const doubleSpan = [
    "[[Old]] `` a`[[Old]]b `` ``[[Old]]`` ``x`` `` a`b `` [[Old]]",
    "``[[Old]] ` [[Still]]``",
    "`` [old](Old.md) ` x ``",
    "[old](Old.md)",
  ].join("\n");
  const spanned = rewriteLinks(doubleSpan, "Ideas.md", "Old.md", "B/New.md", before, after, wiki("shortest"));
  const spannedText = [
    "[[New]] `` a`[[Old]]b `` ``[[Old]]`` ``x`` `` a`b `` [[New]]",
    "``[[Old]] ` [[Still]]``",
    "`` [old](Old.md) ` x ``",
    "[old](New.md)",
  ].join("\n");
  check(spanned.count === 3 && spanned.text === spannedText, `double-backtick spans stay byte for byte (${spanned.count})`);
  const shortFence = ["````", "```", "[[Old]]", "````", "[[Old]]", "    ```", "[[Old]]", "\t```", "[[Old]]"].join("\n");
  const fenced = rewriteLinks(shortFence, "Ideas.md", "Old.md", "B/New.md", before, after, wiki("shortest"));
  const fencedText = ["````", "```", "[[Old]]", "````", "[[New]]", "    ```", "[[New]]", "\t```", "[[New]]"].join("\n");
  check(fenced.count === 3 && fenced.text === fencedText, "a shorter or deeply indented fence does not end the code block");
  const fencedAgain = rewriteLinks(fenced.text, "Ideas.md", "Old.md", "B/New.md", before, after, wiki("shortest"));
  check(fencedAgain.count === 0 && fencedAgain.text === fenced.text, "a second pass leaves those fences and spans unchanged");

  // --- embeds: sections, block refs, missing targets, depth ---
  check(splitSubpath(" Note#Heading ")[0] === "Note" && splitSubpath("Note#a#b")[1] === "a#b", "splitSubpath trims and keeps everything after the first hash");
  check(JSON.stringify(embedSize("0")) === JSON.stringify({ alt: "", width: 0, height: undefined }), "a zero size is a size");
  check(JSON.stringify(embedSize("200x100x50")) === JSON.stringify({ alt: "200x100x50" }), "a third dimension is alt text, not a size");
  check(embedSize("cap|200|80").width === 80 && embedSize("cap|200|80").alt === "cap|200", "the size is the last pipe");
  const sectionNote = "```\n## Second\nnope\n```\n# Top\nintro\n## Second\nbody ^zzbid\n\n### Nested\nnested\n## Later\nlater\n";
  const second = embedSection(sectionNote, "Second");
  check(second?.text.startsWith("## Second\nbody") && second.text.includes("nested") && !second.text.includes("nope") && !second.text.includes("later"), "a heading section skips a fenced copy and stops at the next same level");
  check(embedSection(sectionNote, "second")?.line === second.line, "heading embeds are case-insensitive");
  check(embedSection(sectionNote, "Missing") === null, "a missing heading is a null section");
  check(embedSection(sectionNote, "^zzbid")?.text === "body", "an inline block id embeds the paragraph without the id");
  const firstBlock = "^zzbid\n\npara\n";
  check(embedSection(firstBlock, "^zzbid") === null, "a standalone block id on the first line has no paragraph");
  const firstId = headingPos(EditorState.create({ doc: firstBlock }).doc, "^zzbid");
  check(firstId === 0, `navigation still finds a first-line block id (${firstId})`);
  if (firstId === 0) bug("embed-first-line-block", "embedSection returns null for a standalone block id on line 1, while headingPos returns 0. An embed of that block says it is missing; following the link lands on the id line.");
  check(embedSection("para\n\n^zzbid\n", "^zzbid")?.text === "para", "a standalone block id embeds the paragraph above it");
  check(embedSection("## Hello | world\nbody\n# Next", "Hello world")?.text.startsWith("## Hello | world"), "pipes are dropped when a heading target is matched");
  const withFm = "---\ntags: [a]\naliases: [Secret]\n---\n# Top\nintro\n";
  const part = embedPart(withFm, "");
  check(part?.text.startsWith("# Top") && !part.text.includes("Secret") && part.line === 4, "a whole-note embed skips frontmatter and counts those lines");
  check(embedPart(withFm, "No such") === null, "a missing heading embed is null");
  check(embedStopped("A.md", "A.md", []) === true, "a note embedding itself is a chip");
  check(embedStopped("B.md", "A.md", []) === false, "one level deep still renders");
  check(embedStopped("E.md", "A.md", ["B.md", "C.md", "D.md"]) === false, "four embeds deep still renders");
  check(embedStopped("F.md", "A.md", ["B.md", "C.md", "D.md", "E.md"]) === false, "five embeds deep still renders");
  check(embedStopped("G.md", "A.md", ["B.md", "C.md", "D.md", "E.md", "F.md"]) === true, "six embeds deep is a chip");
  bug("embed-depth-off-by-one", "embedStopped chips when chain.length >= 5. The chain lists notes already drawn and does not include the embed being drawn, so the sixth nested embed is the first chip. The file comment says five embeds deep.");
  check(embedStopped("A.md", "Top.md", ["B.md", "A.md"]) === true, "a cycle back to a note already in the chain is a chip");
  check(resizedSize(null, 0) === "|0" && resetSize("![[a.png|0]]", 9, "0")?.insert === "", "a zero resize is written and resets");

  // --- callouts ---
  const kinds = {
    note: ["pencil", "blue"], abstract: ["clipboard-list", "cyan"], summary: ["clipboard-list", "cyan"], tldr: ["clipboard-list", "cyan"],
    info: ["info", "blue"], todo: ["circle-check", "blue"], tip: ["flame", "cyan"], hint: ["flame", "cyan"], important: ["flame", "cyan"],
    success: ["check", "green"], check: ["check", "green"], done: ["check", "green"], question: ["circle-help", "orange"], help: ["circle-help", "orange"],
    faq: ["circle-help", "orange"], warning: ["triangle-alert", "orange"], caution: ["triangle-alert", "orange"], attention: ["triangle-alert", "orange"],
    failure: ["x", "red"], fail: ["x", "red"], missing: ["x", "red"], danger: ["zap", "red"], error: ["zap", "red"], bug: ["bug", "red"],
    example: ["list", "purple"], quote: ["quote", "gray"], cite: ["quote", "gray"],
  };
  for (const [type, [icon, color]] of Object.entries(kinds)) {
    const kind = calloutKind(type);
    check(kind.icon === icon && kind.color === color, `callout ${type} is ${icon}/${color}`);
  }
  check(calloutKind("mystery").icon === "pencil" && calloutKind("MYSTERY").color === "blue", "an unknown callout type looks like a note");
  check(JSON.stringify(calloutHeader("> [!NOTE]Title")) === JSON.stringify({ type: "note", title: "Title", fold: "" }), "a title may sit against the bracket");
  check(JSON.stringify(calloutHeader("> [!tip]++")) === JSON.stringify({ type: "tip", title: "+", fold: "+" }), "a doubled fold marker leaves the second character as the title");
  check(calloutHeader(">  [!note]") === null, "two spaces after > are not a callout header");
  check(calloutHeader("> [!注意] 見出し")?.type === "注意", "a non-ascii type is kept");
  check(calloutBody("> [!note]\n> | a | b |\n> | --- | --- |\nline") === "| a | b |\n| --- | --- |\nline", "a callout body keeps a table and a lazy line");
  check(calloutHeader(">\t[!warn]")?.type === "warn", "a tab counts as the one optional space after >");

  // --- tables ---
  const cellsOf = (line) => splitRow(line).map(({ from, to }) => line.slice(from, to));
  check(JSON.stringify(cellsOf("| a \\| b | c |")) === JSON.stringify(["a \\| b", "c"]), "an escaped pipe stays inside the cell");
  check(JSON.stringify(alignments("| :--- | :---: | ---: | --- | : |")) === JSON.stringify(["left", "center", "right", "", "center"]), "a lone colon is both edges, so it centers");
  const ragged = parseTable("| a | b |\n| --- |\n| c");
  check(ragged.rows.length === 2 && ragged.cols.length === 2 && ragged.rows[1][1] === "", "a short row and a short delimiter are padded");
  const round = formatTable(ragged);
  const roundAgain = formatTable(parseTable(round));
  check(round === roundAgain, "formatting a parsed table is stable");
  const padded = parseTable(round);
  check(padded.rows[0][0] === "a" && padded.cols[0].align === "" && padded.cols[1].align === "", "padding keeps the cell text, and a plain delimiter stays unaligned");
  const piped = parseTable("| a \\\\ | b |\n| --- | --- |\n| c \\| d | e |");
  check(formatTable(parseTable(formatTable(piped))) === formatTable(piped), "escaped pipes survive a format roundtrip");
  const onlyHeader = parseTable("| only |\n| --- |");
  check(tableOps.deleteRow(onlyHeader, { row: 0, col: 0 }) === null && tableOps.deleteCol(onlyHeader, { row: 0, col: 0 }) === null, "the last row and the last column cannot be deleted");
  check(nextCell(onlyHeader, { row: 0, col: 0 }).to.row === 1 && previousCell(onlyHeader, { row: 0, col: 0 }).to.col === 0, "Tab in the only cell adds a row, and Shift+Tab stays");
  const sorted = tableOps.sortAsc({ rows: [["H"], ["b"], ["a"]], cols: [{ align: "", width: 1 }] }, { row: 0, col: 0 });
  check(sorted.table.rows[0][0] === "H" && sorted.table.rows[1][0] === "a", "sorting does not move the header");
  const input = (doc, text) => {
    const state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: EditorState.transactionFilter.of(cellTransaction) });
    return state.update(state.replaceSelection(text)).state.doc.toString();
  };
  check(input("a", "|b\nc") === "a\\|b<br>c", "a cell input escapes a pipe and turns a newline into <br>");
  check(input("a\\|", "b") === "a\\|b", "typing beside an escaped pipe does not double the slash");
  const tableDoc = "| a | b |\n| --- | --- |\n| c | d |";
  const tableState = EditorState.create({ doc: tableDoc, extensions: syntax.markdownSyntax, selection: { anchor: tableDoc.indexOf("c") + 1 } });
  ensureSyntaxTree(tableState, tableDoc.length, 1000);
  check(JSON.stringify(tableAt(tableState, tableDoc.indexOf("c") + 1)?.cell) === JSON.stringify({ row: 1, col: 0 }), "the caret in a body cell is that cell");
  check(tableAt(tableState, tableDoc.indexOf("---"))?.cell.row === 0, "the caret on the delimiter row counts as the header");

  // --- tags ---
  check(JSON.stringify(tagsInLine("#zzledge #123 #1a ##double")) === JSON.stringify(["zzledge", "1a"]), "a heading word, a pure number, and a doubled hash are not all tags");
  check(JSON.stringify(tagsInText("---\ntags: [zzledge/alpha, \"#beta\"]\n---\n#zzledge-body\n```\n#zzledge-no\n```\n`#zzledge-code`")) === JSON.stringify(["zzledge/alpha", "beta", "zzledge-body"]), "frontmatter tags come first and fenced or inline tags are skipped");
  check(frontmatterTags("\uFEFF---\ntag: solo\n---").tags[0] === "solo", "a BOM does not hide a legacy tag key");
  check(JSON.stringify(wikilinkTargets("[[A#H|alias]] [[A#^bid]] [[A^bid]] `[[No]]`")) === JSON.stringify(["A", "A", "A^bid"]), "wikilink targets drop headings and aliases, and keep a hashless block ref");
  const tree = tagTree(["zzledge/alpha", "zzledge/alpha", "Zzledge"]);
  check(tree.length === 1 && tree[0].count === 3 && tree[0].children[0].count === 2, "a tag tree folds case and counts the parent with its children");

  // --- daily note dates ---
  const leap = new Date(2024, 1, 29, 0, 30, 0);
  check(formatDate(leap, "YYYY-MM-DD") === "2024-02-29", "29 February 2024 formats");
  check(dateNamePattern("YYYY-MM-DD").parse("2024-02-29") === new Date(2024, 1, 29).getTime(), "29 February 2024 parses back");
  check(formatDate(new Date(2026, 9, 3, 0, 0, 0), "h:mm A") === "12:00 AM", "midnight is 12 AM");
  check(formatDate(new Date(2026, 9, 3, 12, 0, 0), "h:mm a") === "12:00 pm", "noon is 12 pm");
  check(formatDate(new Date(2021, 0, 1), "WW") === "53", "1 January 2021 is ISO week 53");
  check(formatDate(new Date(2020, 0, 1), "W") === "1", "1 January 2020 is ISO week 1");
  const impossible = dateNamePattern("YYYY-MM-DD").parse("2026-02-29");
  check(impossible === new Date(2026, 2, 1).getTime(), `2026-02-29 currently parses as ${new Date(impossible).toDateString()}`);
  bug("daily-date-rollover", "dateNamePattern accepts impossible dates and lets Date roll them forward. 2026-02-29 sorts as 1 March 2026, so it collides with a real 2026-03-01 daily note. 2026-13-40 rolls into 2027.");
  check(dateNamePattern("YYYY-MM-DD").parse("2026-13-40") === new Date(2026, 12, 40).getTime(), "an out-of-range month and day roll forward");
  check(dateNamePattern("MM-DD").parse("10-31") === null, "a format with no year does not order a daily note");
  check(dateNamePattern("YYYYMMDD").parse("20261031") === new Date(2026, 9, 31).getTime(), "a format with no separators still parses");
  const filled = fillTemplate("# {{title}}\n{{ DATE }} {{time}} {{date:dddd}} {{title:ignored}} {{date:}} {{other}}", "Plan", new Date(2026, 9, 31, 7, 5, 0), "YYYY-MM-DD", "HH:mm");
  check(filled === "# Plan\n2026-10-31 07:05 Saturday Plan 2026-10-31 {{other}}", "templates fill title, date, time, and a one-off format");
  check(fillTemplate("{{ date : YYYY }}", "T", new Date(2026, 0, 2), "MM", "HH") === "2026", "spaces inside a template variable are ignored");

  // --- fuzz ---
  const fuzzNotes = [
    { name: "Old", path: "Old.md" },
    { name: "Keep", path: "Folder/Keep.md" },
    { name: "Other", path: "Other.md" },
  ];
  const fuzzAfter = [
    { name: "New", path: "Moved/New.md" },
    fuzzNotes[1],
    fuzzNotes[2],
  ];
  const words = ["alpha", "beta", "[[not a link", "see", "Keep", "Old"];
  let fuzzLinks = 0;
  let fuzzRewrites = 0;
  for (let n = 0; n < 400; n++) {
    const parts = [];
    for (let k = 0; k < 8; k++) {
      const roll = rand();
      if (roll < 0.15) parts.push(pick(words));
      else if (roll < 0.3) parts.push(`[[Old${pick(["", "#H", "#^bid", "|alias", "#H|alias"])}]]`);
      else if (roll < 0.4) parts.push(`[[Keep${pick(["", "#H"])}]]`);
      else if (roll < 0.5) parts.push(`[x](Old.md${pick(["", "#H"])})`);
      else if (roll < 0.58) parts.push("`[[Old]]`");
      else if (roll < 0.66) parts.push("```\n[[Old]]\n```");
      else if (roll < 0.74) parts.push("~~~\n[[Old#H]]\n~~~");
      else parts.push("plain");
    }
    const text = parts.join("\n");
    const seen = scanLines(text, (line) => [...line.matchAll(/`[^`\n]*`/g)].map((m) => m[0]));
    const rewritten = rewriteLinks(text, "Folder/Keep.md", "Old.md", "Moved/New.md", fuzzNotes, fuzzAfter, wiki("shortest"));
    const afterScan = scanLines(rewritten.text, (line) => [...line.matchAll(/`[^`\n]*`/g)].map((m) => m[0]));
    assert.deepEqual(afterScan.bodies, seen.bodies, "fence bodies");
    assert.deepEqual(afterScan.codes, seen.codes, "inline code");
    const twice = rewriteLinks(rewritten.text, "Folder/Keep.md", "Old.md", "Moved/New.md", fuzzNotes, fuzzAfter, wiki("shortest"));
    assert.equal(twice.count, 0);
    assert.equal(twice.text, rewritten.text);
    fuzzLinks += rewritten.count;
    fuzzRewrites++;
  }
  check(fuzzRewrites === 400, `rename fuzz rewrote ${fuzzLinks} links across 400 notes without touching code`);

  let embedCases = 0;
  for (let n = 0; n < 200; n++) {
    const lines = [];
    for (let k = 0; k < 12; k++) {
      const roll = rand();
      if (roll < 0.2) lines.push(`${"#".repeat(1 + integer(6))} Heading ${k}`);
      else if (roll < 0.3) lines.push("```");
      else if (roll < 0.4) lines.push(`para ${k} ^id${k}`);
      else if (roll < 0.5) lines.push(`^id${k}`);
      else lines.push(pick(["", "text", "> quote"]));
    }
    const text = lines.join("\n");
    const sub = pick(["Heading 3", "missing", "^id2", "^nope", "heading 0"]);
    const found = embedSection(text, sub);
    if (found) {
      assert.ok(found.line >= 0 && found.line < lines.length);
      assert.equal(typeof found.text, "string");
    }
    assert.equal(typeof embedStopped(`N${integer(8)}.md`, "Top.md", Array.from({ length: integer(7) }, (_, i) => `C${i}.md`)), "boolean");
    embedCases++;
  }
  check(embedCases === 200, "embed fuzz covered 200 random notes");

  let tableCases = 0;
  for (let n = 0; n < 80; n++) {
    const cols = 1 + integer(4);
    const rows = 1 + integer(5);
    const aligns = ["", "left", "center", "right"];
    let table = {
      rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (rand() < 0.2 ? "" : `r${r}c${c}${rand() < 0.2 ? " \\| x" : ""}`))),
      cols: Array.from({ length: cols }, () => ({ align: pick(aligns), width: integer(6) })),
    };
    for (let step = 0; step < 6; step++) {
      const op = pick(Object.values(tableOps));
      const at = { row: integer(table.rows.length), col: integer(table.cols.length) };
      const done = op(table, at);
      if (!done) continue;
      table = done.table;
      assert.ok(table.rows.every((row) => row.length === table.cols.length));
      const formatted = formatTable(table);
      const parsed = parseTable(formatted);
      assert.deepEqual(parsed.rows, table.rows.map((row) => row.map((cell) => cell)));
      assert.deepEqual(parsed.cols.map((col) => col.align), table.cols.map((col) => col.align));
    }
    tableCases++;
  }
  check(tableCases === 80, "table fuzz kept every random edit rectangular");

  let tagCases = 0;
  for (let n = 0; n < 100; n++) {
    const body = Array.from({ length: 6 }, () => pick(["#ok", "#123", "x#no", "#a/b", "```", "#hidden", "text", "`#code`"])).join("\n");
    const text = `---\ntags: [one, "#two"]\n---\n${body}`;
    const found = tagsInText(text);
    assert.ok(found.includes("one") && found.includes("two"));
    assert.ok(found.every((tag) => !/^\d+$/.test(tag)));
    tagCases++;
  }
  check(tagCases === 100, "tag fuzz kept frontmatter tags and rejected pure numbers");

  let calloutCases = 0;
  const samples = ["note", "TIP", "warn", "注意", "", "a b", "tip"];
  for (let n = 0; n < 60; n++) {
    const line = `${pick([">", "> ", ">", ">>"])}[!${pick(samples)}]${pick(["", "+", "-", "++"])} ${pick(["", "Title", "*md*"])}`;
    const header = calloutHeader(line);
    if (header) {
      assert.equal(header.type, header.type.toLowerCase());
      assert.ok(["", "+", "-"].includes(header.fold));
    }
    calloutBody(`${line}\n> body\nlazy`);
    calloutCases++;
  }
  check(calloutCases === 60, "callout fuzz accepted only + or - as a fold marker");

  let dateCases = 0;
  for (let n = 0; n < 40; n++) {
    const when = new Date(2000 + integer(80), integer(12), 1 + integer(28), integer(24), integer(60), integer(60));
    const formatted = formatDate(when, "YYYY-MM-DD");
    assert.equal(dateNamePattern("YYYY-MM-DD").parse(formatted), new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime());
    formatDate(when, pick(["YYYY-MM-DD", "dddd, MMMM Do YYYY", "[Week] WW", "HH:mm A", "YYYYMMDD"]));
    fillTemplate("{{title}} {{date}} {{time}} {{date:MMM D}}", "T", when, "YYYY-MM-DD", "HH:mm");
    dateCases++;
  }
  check(dateCases === 40, "daily-note formats round-trip on real calendar days");

  let resolveCases = 0;
  const pool = [...notes, { name: "Old", path: "Old.md" }];
  for (let n = 0; n < 300; n++) {
    const target = pick(["", ".", "..", "../..", "Plan", "plan", "Missing", "Café", "%ZZ", "Projects/Plan", "../Plan", "a(b)", "Plan#H", "Plan#^x", "Plan^x", "./Café", "../../../../x"]);
    const from = pick([null, "Ideas.md", "Projects/Plan.md", "Notes/Café.md"]);
    const hit = resolveLink(target, from, pool);
    assert.ok(hit === null || pool.some((note) => note.path === hit));
    resolveCases++;
  }
  check(resolveCases === 300, "resolver fuzz only returned notes from the snapshot");

  // --- timings (medians), not a frame budget ---
  const many = Array.from({ length: 4000 }, (_, i) => ({ name: i % 50 === 0 ? "Shared" : `N${i}`, path: `D${i % 40}/N${i}.md` }));
  const linkText = Array.from({ length: 200 }, (_, i) => `[[N${i}#H|a${i}]] and [t](N${i}.md#H)`).join("\n");
  const bigNote = Array.from({ length: 300 }, (_, i) => `## H${i}\nbody ${i} ^b${i}`).join("\n");
  const wide = parseTable(Array.from({ length: 100 }, (_, r) => `| ${Array.from({ length: 8 }, (_, c) => `c${r}.${c}`).join(" | ")} |`).join("\n").replace(/^([^\n]+)\n/, "$1\n| --- | --- | --- | --- | --- | --- | --- | --- |\n"));
  const tagBlob = `${Array.from({ length: 2000 }, (_, i) => `#t${i % 200}/c${i}`).join(" ")}\n`;
  const bench = {
    resolve_one: time(() => resolveLink("Shared", "D0/N1.md", many)).median,
    resolve_missing: time(() => resolveLink("no-such", null, many)).median,
    link_targets: time(() => linkTargets(many.map((n) => ({ path: n.path, is_dir: false })), many)("Shared", null)).median,
    rewrite_200: time(() => rewriteLinks(linkText, "Ideas.md", "D1/N1.md", "Moved/N1.md", many, many, wiki("shortest"))).median,
    embed_section: time(() => embedSection(bigNote, "H250")).median,
    tags_2000: time(() => tagsInText(tagBlob)).median,
    tag_tree: time(() => tagTree(tagsInText(tagBlob))).median,
    table_100x8: time(() => formatTable(parseTable(formatTable(wide)))).median,
    format_date: time(() => formatDate(new Date(2026, 9, 31, 12, 0, 0), "dddd, MMMM Do YYYY [W]WW"), 20).median,
    fill_template: time(() => fillTemplate("{{title}} {{date}} {{time}} {{date:YYYY-MM-DD}}", "T", new Date(), "YYYY-MM-DD", "HH:mm"), 20).median,
  };
  console.log("LEDGE_FUZZ", JSON.stringify({ rewrites: fuzzRewrites, links: fuzzLinks, embeds: embedCases, tables: tableCases, tags: tagCases, callouts: calloutCases, dates: dateCases, resolves: resolveCases }));
  console.log("LEDGE_BENCH", JSON.stringify(bench));
  console.log("LEDGE_BUGS", JSON.stringify(bugs));
  check(pass > 0, `${pass} edge checks passed`);
  console.log(pass, "PASS");
} finally {
  await server.close();
}
