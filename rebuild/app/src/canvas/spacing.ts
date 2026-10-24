import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

// Only detached card previews get block margins. Editable CodeMirror DOM is untouched.
export function spaceCardBody(content: HTMLElement, state: EditorState) {
  if (content.childElementCount < 2) return; // One-block previews already have zero outer spacing.
  const doc = state.doc;
  const lines = [...content.children] as HTMLElement[], covered = new Set<HTMLElement>();
  for (let block = syntaxTree(state).topNode.firstChild; block; block = block.nextSibling) {
    const first = doc.lineAt(block.from).number, last = doc.lineAt(Math.max(block.from, block.to - 1)).number;
    const children = lines.filter(el => Number(el.dataset.line) >= first && Number(el.dataset.line) <= last);
    if (!children.length) continue;
    children.forEach(el => covered.add(el));
    children[0].classList.add("canvas-block"); children.at(-1)!.classList.add("canvas-block-end");
    if (block.name === "Paragraph") children[0].classList.add("canvas-paragraph");
    if (["BulletList", "OrderedList"].includes(block.name)) children.forEach(el => el.classList.add("canvas-list"));
  }
  for (const line of lines) if (!covered.has(line) && !line.textContent?.trim()) line.remove();
}
