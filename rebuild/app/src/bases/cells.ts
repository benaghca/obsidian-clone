import { Text } from "@codemirror/state";
import { api } from "../api";
import { addProperty, asType, fits, readFrontmatter, setValue, type Property, type PropertyType } from "../editor/frontmatter";
import { propertyValue } from "../editor/properties";
import type { Group } from "../tabs";
import type { Workspace } from "../workspace";
import { noteKey } from "./model";

/** Use the Properties writer against the current document; preserve unsaved edits. */
async function setCell(ws: Workspace, path: string, key: string, type: PropertyType, value: Property["value"]) {
  const doc = ws.editors.doc(path) ?? Text.of((await api.readNote(path)).split("\n"));
  const fm = readFrontmatter(doc);
  if (fm && !fm.props) throw Error("This note's frontmatter cannot be edited safely");
  const p = fm?.props?.find(p => p.key === key);
  if (p && p.type === type && JSON.stringify(p.value) === JSON.stringify(value)) return;
  const changes = p ? setValue(fm!, p, value, type) : addProperty(fm, key, type, value);
  if (ws.editors.isLoaded(path)) ws.editors.change(path, { changes, userEvent: "input.property", scrollIntoView: false });
  else { await api.writeNote(path, doc.replace(changes.from, changes.to, Text.of(changes.insert.split("\n"))).toString()); ws.vault.written(path); }
}
export function cellEditor(ws: Workspace, group: Group, path: string, key: string, kind: PropertyType, prop: Property | undefined, changed: () => void, error: (e: unknown) => void) {
  key = noteKey(key);
  const p: Property = prop ?? { key, type: kind, value: ["tags", "list", "aliases"].includes(kind) ? [] : kind === "checkbox" ? false : "", line: 0, count: 0 };
  const type = fits(p, kind) ? kind : p.type;
  let value = fits(p, kind) ? asType(p, kind) : p.value;
  // Serialize rapid checkbox/list edits, reading the latest text for each write.
  let writing = Promise.resolve();
  const view = ws.editors.viewOf(group);
  const commit = (next: Property["value"], part: string) => {
    writing = writing.then(() => setCell(ws, path, key, type, next)).then(async () => {
      if (part === "add" && el.isConnected) {
        const doc = ws.editors.doc(path) ?? Text.of((await api.readNote(path)).split("\n"));
        const latest = readFrontmatter(doc)?.props?.find(p => p.key === key);
        if (latest) {
          const focused = el.contains(document.activeElement); value = latest.value;
          el.replaceChildren(...propertyValue(view, { ...latest, type }, commit).childNodes);
          if (focused) el.querySelector<HTMLElement>('[data-part="add"]')?.focus();
        }
      }
      changed();
    }).catch(error);
  };
  const el = propertyValue(view, { ...p, type, value }, commit);
  el.classList.toggle("is-empty", value === "" || value === null);
  el.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement) target.select(); else if (target.isContentEditable) getSelection()?.selectAllChildren(target);
      e.preventDefault(); e.stopPropagation();
    }
    if (e.key === "Escape") {
      const input = e.target as HTMLElement;
      if (input instanceof HTMLInputElement) input.value = String(value); else if (input.isContentEditable) input.textContent = input.dataset.part === "add" ? "" : String(value);
      (el.closest("td") as HTMLElement)?.focus();
    }
  }, true);
  return el;
}
