// Clipboard HTML only. The parsed document is inert and is never inserted
// into the page; URLs remain text, including remote images.
const blocks = /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|UL|OL|TABLE|HR)$/;
const skip = /^(SCRIPT|STYLE|META|LINK|TITLE|IFRAME|OBJECT|NOSCRIPT)$/;
const clean = (s: string) => s.replace(/ +\n/g, "\n").replace(/\n +/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
// Obsidian leaves literal Markdown punctuation alone in clipboard text.
const destination = (s: string) => s.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
const wrap = (text: string, marker: string) => text.trim() ? text.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${marker}$2${marker}$3`) : text;

/** null means the clipboard has no Markdown formatting: keep text/plain exactly. */
export function htmlToMarkdown(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let rich = false;
  const literals: string[] = [];
  let token = "\uE000";
  while (html.includes(token)) token += "\uE000";
  const literal = (value: string) => `${token}${literals.push(value) - 1}\uE001`;
  const restore = (s: string): string => s.replace(new RegExp(`${token}(\\d+)\uE001`, "g"), (_, index) => literals[Number(index)]);
  const children = (el: Node): string => Array.from(el.childNodes, walk).join("").replace(/ {2,}/g, " ");
  const block = (s: string) => `\n\n${clean(s)}\n\n`;
  function list(el: Element): string {
    let number = Number.parseInt(el.getAttribute("start") ?? "1", 10);
    if (!Number.isFinite(number)) number = 1;
    return Array.from(el.children).filter(e => e.tagName === "LI").map(li => {
      let body = "", nested = "";
      for (const node of li.childNodes) {
        if (node instanceof Element && /^(UL|OL)$/.test(node.tagName)) nested += "\n" + list(node).split("\n").map(line => "    " + line).join("\n");
        else body += walk(node);
      }
      const checkbox = Array.from(li.querySelectorAll('input[type="checkbox"]')).find(input => input.closest("li") === li);
      const task = checkbox ? `[${checkbox.hasAttribute("checked") ? "x" : " "}] ` : "";
      const prefix = el.tagName === "OL" ? `${number++}. ` : "- ";
      return prefix + task + restore(clean(body)).replace(/\n/g, "\n    ") + nested;
    }).join("\n");
  }
  function table(el: Element): string {
    const rows = Array.from(el.querySelectorAll("tr")).filter(tr => tr.closest("table") === el)
      .map(tr => Array.from(tr.children).filter(c => /^(TD|TH)$/.test(c.tagName))
        .map(c => restore(clean(children(c))).replace(/ *\n+/g, "<br>").replace(/\|/g, "\\|")));
    if (!rows.length) return "";
    const width = Math.max(...rows.map(r => r.length));
    const row = (cells: string[]) => "|" + Array.from({ length: width }, (_, i) => cells[i] ?? "").join("|") + "|";
    return [row(rows[0]), row(Array(width).fill("---")), ...rows.slice(1).map(row)].join("\n");
  }
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/[\s\u00a0]+/g, " ");
    if (!(node instanceof Element)) return "";
    const tag = node.tagName;
    if (skip.test(tag) || tag === "O:P" || /mso-list:\s*Ignore/i.test(node.getAttribute("style") ?? "")) return "";
    if (tag === "INPUT") return "";
    if (tag === "PRE") {
      rich = true;
      const code = node.querySelector("code") ?? node;
      const language = (code.className + " " + node.className).match(/\blanguage-([\w+-]+)/)?.[1] ?? "";
      const text = (code.textContent ?? "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
      const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
      // Do not run block whitespace cleanup over literal code.
      return block(literal(`${fence}${language}\n${text}\n${fence}`));
    }
    if (tag === "UL" || tag === "OL") { rich = true; return block(literal(list(node))); }
    if (tag === "TABLE") { rich = true; return block(literal(table(node))); }
    if (tag === "IMG") {
      const src = node.getAttribute("src");
      if (!src) return "";
      rich = true;
      return `![${(node.getAttribute("alt") ?? "").replace(/[\[\]]/g, "\\$&")}](${destination(src)})`;
    }
    const text = children(node);
    if (tag === "BR") { rich = true; return literal("  \n"); }
    if (tag === "HR") { rich = true; return block("---"); }
    if (/^H[1-6]$/.test(tag)) { rich = true; return block("#".repeat(Number(tag[1])) + " " + clean(text)); }
    if (tag === "BLOCKQUOTE") { rich = true; return block(literal(restore(clean(text)).split("\n").map(line => "> " + line).join("\n"))); }
    if (tag === "A" && node.getAttribute("href")) {
      rich = true;
      const href = node.getAttribute("href")!;
      return node.textContent === href ? href : `[${text}](${destination(href)})`;
    }
    if (tag === "CODE") {
      rich = true;
      const value = (node.textContent ?? "").replace(/\s+/g, " ");
      const marker = "`".repeat(Math.max(1, ...Array.from(value.matchAll(/`+/g), m => m[0].length + 1)));
      return literal(marker + (/^`|`$/.test(value) ? " " + value + " " : value) + marker);
    }
    if (tag === "SPAN") {
      const { fontWeight, fontStyle } = (node as HTMLElement).style;
      let styled = text;
      if (fontStyle === "italic") { rich = true; styled = wrap(styled, "_"); }
      if (/^(bold|[6-9]00)$/.test(fontWeight)) { rich = true; styled = wrap(styled, "**"); }
      return styled;
    }
    if (/^(B|STRONG|I|EM|S|DEL|STRIKE)$/.test(tag)) {
      // Google Docs wraps the whole fragment in <b style="font-weight:normal">.
      if ((tag === "B" || tag === "STRONG") && /^(normal|400)$/.test((node as HTMLElement).style.fontWeight)) return text;
      rich = true;
      return wrap(text, /^(B|STRONG)$/.test(tag) ? "**" : /^(I|EM)$/.test(tag) ? "_" : "~~");
    }
    if (blocks.test(tag)) return block(text);
    return text;
  }
  const result = children(doc.body);
  // A lone paragraph or code-editor span has no formatting to convert.
  if (!rich) return null;
  // Block walkers own their spacing. Preserve fenced code's literal whitespace.
  return restore(clean(result));
}
