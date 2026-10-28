#!/usr/bin/env node
// Deterministic vault shaped like rebuild/RUST_MIGRATION_PLAN.md section 1.
//
//   node scripts/gen-vault.mjs <dir> [n]
//
// Default n is 5000. Notes sit in 25 folders × 4 subfolders, 20–60 lines
// each (frontmatter included). 60% start with a tags: list. About 8% of
// lines carry an inline #tag, about 7% a link (wikilinks, except every
// 20th of those lines, which is a markdown link), about 10% an extra
// heading, and about 3% of notes a fenced block (``` and ~~~, with a #tag
// and a wikilink inside so fence-skipping has something to skip). Some
// tags are Unicode.
// Prose lines contain the word "meeting", which the Rust bench searches for.
// The same n always writes the same bytes.
//
// <dir> is replaced. It must be a directory inside the system temp dir,
// not the temp dir itself. Generated vaults stay out of the repo.

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";

const TOP = 25;
const SUB = 4;
const WORDS = "alpha beta gamma delta river stone garden forest cloud signal lantern harbor meadow copper ember willow cedar maple orbit prism quartz echo".split(" ");
const UNICODE = ["café", "日本語", "проект"];
// ASCII prose, padded to this width so a 5,000-note vault lands near 13.6 MB.
const PROSE_WIDTH = 92;

const dir = process.argv[2];
const n = Number(process.argv[3] ?? 5000);
if (!dir || !Number.isInteger(n) || n < 1) {
  console.error("usage: node scripts/gen-vault.mjs <dir> [n]");
  process.exit(1);
}

const dest = resolve(dir);
const temp = resolve(tmpdir());
const tempPrefix = temp.endsWith(sep) ? temp : temp + sep;
if (!dest.startsWith(tempPrefix) || dest.length < tempPrefix.length + 3) {
  console.error(`refusing to write outside a subdirectory of ${temp}`);
  process.exit(1);
}

const noteName = (i) => `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]} ${i}`;
const notePath = (i) => {
  const top = String(i % TOP).padStart(2, "0");
  const sub = Math.floor(i / TOP) % SUB;
  return `Folder ${top}/Sub ${sub}/${noteName(i)}.md`;
};

// Total lines in the file, frontmatter included. Uniform over 20..60.
const fileLength = (i) => 20 + ((i * 17) % 41);

function frontmatter(i) {
  if (i % 5 >= 3) return [];
  const tags = ["meeting", `project/${WORDS[i % WORDS.length]}`];
  if (i % 50 === 0) tags.push(UNICODE[(i / 50) % UNICODE.length]);
  else if (i % 50 === 25) tags.push("cafe\u0301");
  const lines = ["---", "tags:", ...tags.map((tag) => `  - ${tag}`)];
  if (i % 20 === 0) lines.push("tag: legacy");
  lines.push("---");
  return lines;
}

const lengths = Array.from({ length: n }, (_, i) => fileLength(i));
const totalLines = lengths.reduce((sum, len) => sum + len, 0);
const slots = [];
for (let i = 0; i < n; i++) {
  const fm = frontmatter(i).length;
  const bodyLen = lengths[i] - fm;
  const fenced = i % 33 === 0;
  const end = fenced ? bodyLen - 4 : bodyLen;
  for (let line = 1; line < end; line++) slots.push({ i, line });
}

const tagN = Math.round(totalLines * 0.08);
const linkN = Math.round(totalLines * 0.07);
const headingN = Math.round(totalLines * 0.1);
const roles = new Array(slots.length).fill("prose");

function paint(count, role) {
  const open = [];
  for (let s = 0; s < roles.length; s++) if (roles[s] === "prose") open.push(s);
  if (count > open.length) {
    console.error(`not enough body lines for ${count} ${role} lines (have ${open.length})`);
    process.exit(1);
  }
  let prev = -1;
  for (let k = 0; k < count; k++) {
    const at = Math.floor(((k + 0.5) * open.length) / count);
    if (at <= prev || at >= open.length) {
      console.error(`could not place ${role} line ${k}`);
      process.exit(1);
    }
    prev = at;
    roles[open[at]] = role;
  }
}

paint(headingN, "heading");
paint(tagN, "tag");
paint(linkN, "link");

const roleOf = new Map();
for (let s = 0; s < slots.length; s++) {
  if (roles[s] !== "prose") roleOf.set(`${slots[s].i}:${slots[s].line}`, roles[s]);
}

function prose(i, line) {
  const base = (i + line) % 2 === 0
    ? "The meeting notes followed the garden path beside the river. "
    : "A meeting was kept while the garden path held the river light. ";
  let text = base;
  while (text.length < PROSE_WIDTH) text += "notes ";
  return text.slice(0, PROSE_WIDTH);
}

function tagText(serial) {
  if (serial % 40 === 0) return UNICODE[serial % UNICODE.length];
  if (serial % 40 === 20) return "cafe\u0301";
  if (serial % 3 === 0) return `project/${WORDS[serial % WORDS.length]}`;
  return ["garden", "work", "topic/river", "orchard"][serial % 4];
}

let tagSerial = 0;
let linkSerial = 0;
const hash = createHash("sha256");
const files = [];
const stats = {
  notes: n,
  folders: TOP,
  subfolders_each: SUB,
  lines: 0,
  bytes: 0,
  frontmatter_notes: 0,
  heading_lines: 0,
  inline_tag_lines: 0,
  unicode_inline_tags: 0,
  wikilink_lines: 0,
  markdown_link_lines: 0,
  fence_backtick_notes: 0,
  fence_tilde_notes: 0,
  meeting_lines: 0,
};

for (let i = 0; i < n; i++) {
  const fm = frontmatter(i);
  const bodyLen = lengths[i] - fm.length;
  const fenced = i % 33 === 0;
  const marker = i % 66 === 0 ? "```" : "~~~";
  const body = [];
  for (let line = 0; line < bodyLen; line++) {
    if (line === 0) {
      body.push(`# ${noteName(i)}`);
      stats.heading_lines++;
      continue;
    }
    if (fenced && line === bodyLen - 4) {
      body.push(marker, `// #skip-me [[${noteName(0)}]]`, "const hidden = 1;", marker);
      line += 3;
      if (marker === "```") stats.fence_backtick_notes++;
      else stats.fence_tilde_notes++;
      continue;
    }
    const role = roleOf.get(`${i}:${line}`) ?? "prose";
    if (role === "heading") {
      body.push(`# ${WORDS[(i + line) % WORDS.length]} section ${line}`);
      stats.heading_lines++;
    } else if (role === "tag") {
      const tag = tagText(tagSerial++);
      body.push(`See #${tag} beside the path.`);
      stats.inline_tag_lines++;
      if (UNICODE.includes(tag) || tag.normalize("NFC") !== tag) stats.unicode_inline_tags++;
    } else if (role === "link") {
      let dest = (i + line * 13 + 1) % n;
      if (dest === i) dest = (i + 1) % n;
      if (linkSerial++ % 20 === 19) {
        body.push(`See [${noteName(dest)}](${encodeURI(notePath(dest))}).`);
        stats.markdown_link_lines++;
      } else {
        body.push(`Related: [[${noteName(dest)}]].`);
        stats.wikilink_lines++;
      }
    } else {
      body.push(prose(i, line));
    }
  }
  if (fm.length) stats.frontmatter_notes++;
  const text = [...fm, ...body].join("\n") + "\n";
  const lineCount = text.split("\n").length - 1;
  if (lineCount < 20 || lineCount > 60 || lineCount !== lengths[i]) {
    console.error(`note ${i} has ${lineCount} lines, wanted ${lengths[i]}`);
    process.exit(1);
  }
  stats.lines += lineCount;
  stats.bytes += Buffer.byteLength(text);
  stats.meeting_lines += text.split("\n").filter((line) => line.includes("meeting")).length;
  const path = notePath(i);
  hash.update(path);
  hash.update("\0");
  hash.update(text);
  files.push([path, text]);
}

if (stats.inline_tag_lines !== tagN || stats.wikilink_lines + stats.markdown_link_lines !== linkN) {
  console.error("line roles did not land on the planned counts");
  process.exit(1);
}
if (n >= 66 && (stats.fence_backtick_notes === 0 || stats.fence_tilde_notes === 0)) {
  console.error("expected both ``` and ~~~ fences");
  process.exit(1);
}
if (n >= 50 && stats.unicode_inline_tags === 0) {
  console.error("expected a Unicode inline tag");
  process.exit(1);
}
if (n % 5 === 0 && stats.frontmatter_notes !== (n * 3) / 5) {
  console.error(`expected 60% frontmatter, got ${stats.frontmatter_notes}`);
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
const parents = new Set(files.map(([path]) => dirname(path)));
await Promise.all([...parents].map((parent) => mkdir(resolve(dest, parent), { recursive: true })));
const chunk = 64;
for (let at = 0; at < files.length; at += chunk) {
  await Promise.all(files.slice(at, at + chunk).map(([path, text]) => writeFile(resolve(dest, path), text)));
}

stats.dir = dest;
stats.sha256 = hash.digest("hex");
stats.search_term = "meeting";
console.log(JSON.stringify(stats));
