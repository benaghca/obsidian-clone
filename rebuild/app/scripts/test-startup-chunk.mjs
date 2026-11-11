// The production entry, and every JS file it imports statically, must not
// contain the canvas, Bases, graph, drawing editor, or settings modal.
// Those views live in other chunks. CSS stays with the entry on purpose.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const built = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { cwd: root, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);

const MARKERS = [
  ["Snap to objects", "canvas"],
  ["Group by a property to make columns.", "bases"],
  ["Start timelapse animation", "graph"],
  ["drawing-tools", "drawing editor"],
  ["Search settings...", "settings"],
];

/** Specifiers of static `import` statements. `import()` is left out. */
function staticSpecifiers(code) {
  const specs = [];
  const re = /(?:^|[^.\w$])import/g;
  let match;
  while ((match = re.exec(code))) {
    let i = match.index + match[0].length;
    while (code[i] === " " || code[i] === "\n" || code[i] === "\r" || code[i] === "\t") i++;
    if (code[i] === "(" || code[i] === ".") continue;
    let specAt = i;
    if (code[i] !== '"' && code[i] !== "'") {
      const from = code.indexOf("from", i);
      if (from < 0 || from - i > 8000) continue;
      specAt = from + 4;
      while (code[specAt] === " " || code[specAt] === "\n" || code[specAt] === "\r" || code[specAt] === "\t") specAt++;
    }
    const quote = code[specAt];
    if (quote !== '"' && quote !== "'") continue;
    const end = code.indexOf(quote, specAt + 1);
    if (end < 0) continue;
    specs.push(code.slice(specAt + 1, end));
  }
  return specs;
}

function resolveSpec(fromFile, spec) {
  const file = spec.split("?")[0];
  if (file.startsWith(".")) return resolve(dirname(fromFile), file);
  if (file.startsWith("/")) return join(dist, file.slice(1));
  return null;
}

function closure(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const path = queue.pop();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (!path.endsWith(".js")) continue;
    let code;
    try {
      code = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const spec of staticSpecifiers(code)) {
      const next = resolveSpec(path, spec);
      if (next) queue.push(next);
    }
  }
  return seen;
}

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkJs(path, out);
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

const html = readFileSync(join(dist, "index.html"), "utf8");
const entryHref = [...html.matchAll(/<script\b[^>]*>/g)]
  .map((tag) => tag[0])
  .filter((tag) => /type="module"/.test(tag) && /src=/.test(tag))
  .map((tag) => tag.match(/src="([^"]+)"/)?.[1])
  .find(Boolean);
if (!entryHref) throw new Error("dist/index.html has no module entry");
const entryPath = join(dist, entryHref.replace(/^\//, ""));
const startup = closure(entryPath);
const startupJs = [...startup].filter((file) => file.endsWith(".js") && file.startsWith(dist));
const startupText = startupJs.map((file) => readFileSync(file, "utf8")).join("\n");
const otherText = walkJs(dist)
  .filter((file) => !startup.has(file))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const failures = [];
for (const [marker, name] of MARKERS) {
  if (startupText.includes(marker)) failures.push(`startup JS still contains the ${name} view (${JSON.stringify(marker)})`);
  if (!otherText.includes(marker)) failures.push(`no other chunk contains the ${name} view (${JSON.stringify(marker)})`);
}

const preloads = [...html.matchAll(/<link\b[^>]*>/g)]
  .map((tag) => tag[0])
  .filter((tag) => /rel="modulepreload"/.test(tag))
  .map((tag) => tag.match(/href="([^"]+)"/)?.[1])
  .filter(Boolean);
for (const href of preloads) {
  const path = join(dist, href.replace(/^\//, ""));
  if (!path.endsWith(".js")) continue;
  const code = readFileSync(path, "utf8");
  for (const [marker, name] of MARKERS) {
    if (code.includes(marker)) failures.push(`modulepreload fetches the ${name} view: ${href}`);
  }
}

const entryBytes = statSync(entryPath).size;
const closureBytes = startupJs.reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`startup entry ${entryBytes} bytes; static JS closure ${closureBytes} bytes in ${startupJs.length} files`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("PASS startup chunk omits canvas, bases, graph, the drawing editor and settings");
