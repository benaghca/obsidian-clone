import { markdownLanguage } from "@codemirror/lang-markdown";
import type { Text } from "@codemirror/state";
import { h } from "../shell/dom";

// Only detached card previews get block margins. Editable CodeMirror DOM is untouched.
export function spaceCardBody(content: HTMLElement, doc: Text) {
  const lines = [...content.children] as HTMLElement[], covered = new Set<HTMLElement>();
  for (let block = markdownLanguage.parser.parse(doc.toString()).topNode.firstChild; block; block = block.nextSibling) {
    const first = doc.lineAt(block.from).number, last = doc.lineAt(Math.max(block.from, block.to - 1)).number;
    const children = lines.filter(el => Number(el.dataset.line) >= first && Number(el.dataset.line) <= last);
    if (!children.length) continue;
    children.forEach(el => covered.add(el));
    if (["Paragraph", "BulletList", "OrderedList"].includes(block.name)) {
      const box = h("div", { class: `canvas-block ${block.name === "Paragraph" ? "canvas-paragraph" : "canvas-list"}` });
      children[0].before(box); box.append(...children);
    } else children[0].classList.add("canvas-block");
  }
  for (const line of lines) if (!covered.has(line) && !line.textContent?.trim()) line.remove();
}
