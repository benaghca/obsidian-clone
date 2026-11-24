// The Results menu (limit, Copy to clipboard, Export as CSV...) and the one CSV
// export path. "Export as CSV" (this menu, the tab's More options and the
// command palette's "Bases: Export as CSV") writes the rows the view shows, in
// its order, with its column names and the text its cells show, to a vault path
// chosen in a save dialog. Cancel writes nothing.

import { h } from "../shell/dom";
import { closeMenu, showMenu, SEPARATOR } from "../shell/menu";
import { confirmDialog } from "../shell/confirm";
import { notice } from "../shell/notice";
import { menuInputEscape } from "./menuInput";
import { writeClipboard } from "../editor/clipboard";
import { asType, fits, type Property, type PropertyType } from "../editor/frontmatter";
import { formatDate } from "../settings/dateFormat";
import { fileName, parentDir } from "../paths";
import { sourceVault } from "../vaultRoot";
import { submitBytes } from "../vaultWrite";
import type { Workspace } from "../workspace";
import type { Value } from "./expression";
import { baseNotice } from "./notice";
import { noteKey } from "./model";

/** What the view shows: its column names and each shown row's cell text. */
export interface ShownTable { headers: string[]; rows: string[][] }

const LIST_TYPES = new Set<PropertyType>(["list", "tags", "aliases"]);
/** A list item as its pill reads: `[[Note|Alias]]` shows Alias, `[[Note]]` shows Note. */
const pillText = (item: string) => { const link = /^\[\[([^\]|#]+)[^\]|]*(?:\|([^\]]*))?\]\]$/.exec(item); return link ? link[2] ?? link[1] : item; };
/** A date the view reformats (file.mtime/ctime, UTC values), else as written. */
const dateText = (value: Value) => /Z$/.test(String(value)) ? formatDate(new Date(String(value)), "YYYY-MM-DDTHH:mm:ss") : String(value);

/**
 * The text a table cell (view.ts `cell`) or a card value shows for `value`,
 * already read in the vault's type for `key`. A note property shows its
 * frontmatter value in `kind` (pills, the date field's date, a checkbox as
 * true/false). File and formula columns show the evaluated value. An empty
 * cell, or a property the note does not have, is "".
 */
export function shownText(key: string, value: Value, prop: Property | undefined, kind: PropertyType): string {
  if (!/^(file|formula)\./.test(key) && kind !== "unknown") {
    if (!prop) return "";
    const ok = fits(prop, kind), shown = ok ? kind : prop.type, v = ok ? asType(prop, kind) : prop.value;
    if (shown === "checkbox") return v === true ? "true" : "false";
    if (LIST_TYPES.has(shown)) return (Array.isArray(v) ? v : []).map(pillText).join(", ");
    return Array.isArray(v) ? v.join(", ") : String(v ?? "");
  }
  if (value === null || value === undefined || value === "") return "";
  if (kind === "date" || kind === "datetime") return dateText(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(item => String(item ?? "")).join(", ");
  return String(value);
}

/** What a cell is drawn from: the row's context and its frontmatter properties. */
export interface ShownEntry { context: { get(key: string): Value }; row: { props: readonly Property[] } }
/**
 * One cell's text, read as view.ts `cell` reads it: the value in the vault's
 * type for the property (`want`) when it fits, then `shownText` in the
 * cell's kind. A failing formula shows its message.
 */
export function entryText(key: string, entry: ShownEntry, want: PropertyType | null | undefined, kind: (key: string, value: Value) => PropertyType): string {
  let value: Value;
  try { value = entry.context.get(key); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  const p = entry.row.props.find(p => p.key === noteKey(key));
  if (p && want && fits(p, want)) value = asType(p, want);
  return shownText(key, value, p, kind(key, value));
}
/** The shown columns by display name, and each shown entry's cells, in the order given. */
export function tableOf<E extends ShownEntry>(keys: readonly string[], label: (key: string) => string, entries: readonly E[], cell: (key: string, entry: E) => string): ShownTable {
  return { headers: keys.map(label), rows: entries.map(entry => keys.map(key => cell(key, entry))) };
}

function quoted(text: string, special: RegExp): string {
  return special.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
/** Tab-separated, for pasting into a spreadsheet: the same cells as the CSV. */
export function tableTsv({ headers, rows }: ShownTable) {
  return [headers, ...rows].map(row => row.map(text => quoted(text, /[\t\r\n"]/)).join("\t")).join("\n");
}
/**
 * RFC 4180: CRLF after every record, and a field is quoted (its quotes doubled)
 * when it holds a comma, a quote, CR or LF. Line breaks inside a field are kept as written.
 */
export function tableCsv({ headers, rows }: ShownTable) {
  let out = "";
  for (const row of [headers, ...rows]) out += row.map(text => quoted(text, /[",\r\n]/)).join(",") + "\r\n";
  return out;
}
/** The file's bytes: UTF-8, no byte order mark. */
export const csvBytes = (table: ShownTable) => new TextEncoder().encode(tableCsv(table));

/** One part of a file name: path separators, reserved and control characters become spaces; no leading or trailing dots. */
const namePart = (text: string | null | undefined) => (text ?? "").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim();
/** `<base>-<view>.csv`: the .base file's (or note's) name and the view's, each made safe for a file name. */
export function csvFilename(base: string | null | undefined, view: string | null | undefined): string {
  const stem = [namePart((base ?? "").replace(/\.(base|md)$/i, "")), namePart(view)].filter(Boolean).join("-").slice(0, 200).trim();
  return `${stem || "Results"}.csv`;
}
/** The default save path: beside the base (`source` is the .base file, or the note a ```base block is in). */
export function csvDefaultPath(source: string | null | undefined, view: string | null | undefined): string {
  const folder = source ? parentDir(source) : "";
  const name = csvFilename(source ? fileName(source) : null, view);
  return folder ? `${folder}/${name}` : name;
}
/** A typed vault path, tidied: forward slashes, no leading slash, `.csv` added when it has no extension of that name. */
export function csvPath(typed: string): { path: string } | { error: string } {
  const parts = typed.trim().replaceAll("\\", "/").split("/").filter(part => part !== "" && part !== ".");
  if (!parts.length) return { error: "Type a file name" };
  if (parts.some(part => part === "..")) return { error: "Choose a path inside this vault" };
  if (parts.some(part => part.startsWith("."))) return { error: "Names cannot start with a dot" };
  if (!/\.csv$/i.test(parts[parts.length - 1])) parts[parts.length - 1] += ".csv";
  return { path: parts.join("/") };
}

export interface CsvExport {
  /** The .base file, or the note a ```base block is in: names the default file and folder. */
  source: string | null;
  view: string;
  table: ShownTable;
}
/**
 * The save dialog: a vault path, the base's folder and `<base>-<view>.csv` to
 * start. A file already at the path is replaced only after "Replace"; a folder
 * there, or a bad path, keeps the dialog open. Resolves with the path, or null
 * when cancelled.
 */
export async function askCsvPath(ws: Workspace, initial: string, table: ShownTable): Promise<string | null> {
  const input = h("input", { class: "setting-input", type: "text", spellcheck: "false", "aria-label": "File path", value: initial });
  const problem = h("div", { class: "bases-export-error", role: "alert" });
  problem.hidden = true;
  const rows = table.rows.length, columns = table.headers.length;
  const message = h("div", { class: "bases-export" },
    h("label", { class: "bases-export-label" }, h("span", null, "Save to"), input),
    h("div", { class: "bases-export-note" }, `${rows} ${rows === 1 ? "row" : "rows"}, ${columns} ${columns === 1 ? "column" : "columns"}, in the vault “${ws.vault.name}”.`),
    problem);
  const fail = (text: string) => { problem.textContent = text; problem.hidden = false; return false; };
  input.addEventListener("input", () => { problem.hidden = true; });
  let target = "";
  const pending = confirmDialog({
    title: "Export as CSV", message, confirm: "Save", field: input,
    accept: async () => {
      const typed = csvPath(input.value);
      if ("error" in typed) return fail(typed.error);
      const taken = ws.vault.matchPath(typed.path);
      if (taken?.is_dir) return fail(`“${fileName(taken.path)}” is a folder`);
      if (taken) {
        const answer = await confirmDialog({ title: `Replace “${fileName(taken.path)}”?`, message: "A file with that name is already there.", confirm: "Replace", warning: true });
        if (!answer.ok) return false;
      }
      target = taken?.path ?? typed.path;
      return true;
    },
  });
  // Select the name, not the folder or ".csv", so typing renames it.
  const start = initial.lastIndexOf("/") + 1, end = /\.csv$/i.test(initial) ? initial.length - 4 : initial.length;
  input.setSelectionRange(start, end);
  return (await pending).ok ? target : null;
}

/**
 * Export a view: ask where (`choose`, the save dialog), then write the CSV's
 * bytes there. Returns the written path, or null when cancelled or it failed.
 */
export async function exportCsv(ws: Workspace, o: CsvExport, choose = askCsvPath): Promise<string | null> {
  const target = await choose(ws, csvDefaultPath(o.source, o.view), o.table);
  if (target === null) return null;
  try {
    const source = sourceVault();
    await submitBytes(source, target, csvBytes(o.table), "replace");
    if (sourceVault() === source) {
      await ws.vault.refreshFiles();
      ws.vault.written(target);
    }
    notice([`Saved “${fileName(target)}”`]);
    return target;
  } catch (err) {
    notice([`Couldn’t export “${fileName(target)}”: ${err instanceof Error ? err.message : String(err)}`]);
    return null;
  }
}

export const EXPORT_CSV_TITLE = "Export as CSV...";
export function resultsMenu(at:HTMLElement, limit:number|undefined, total:number, table:()=>ShownTable, exportView:()=>void, write:(value:number|undefined)=>void) {
  const input=h("input",{type:"number",min:"0",step:"1",placeholder:"e.g. 10","aria-label":"Limit number of results",value:limit===undefined?"":String(limit)});
  let committed=false;
  const commit=()=>{const value=input.value===""?undefined:Number(input.value);if(input.validity.badInput||value!==undefined&&(!Number.isInteger(value)||value<0)){input.setCustomValidity("Enter a non-negative whole number");input.reportValidity();return false;}if(!committed&&value!==limit){committed=true;write(value);}return true;};
  input.addEventListener("input",()=>input.setCustomValidity(""));input.addEventListener("blur",commit);
  input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();if(commit())closeMenu();}});
  const content=h("div",{class:"bases-results-limit",onclick:(e:MouseEvent)=>e.stopPropagation()},h("span",null,"Limit number of results"),input);
  const cleanup=menuInputEscape(content);
  showMenu([{title:"Limit number of results",content},SEPARATOR,limit!==undefined&&limit<total&&{title:`Show all (${total})`,icon:"rotate-ccw",action:()=>write(undefined)},{title:"Copy to clipboard",icon:"copy",action:()=>{
    writeClipboard(tableTsv(table()));baseNotice("Copied to your clipboard");
  }},{title:EXPORT_CSV_TITLE,icon:"file-down",action:exportView}],at,{className:"bases-results-menu"});
  if(!content.isConnected)cleanup();
}
