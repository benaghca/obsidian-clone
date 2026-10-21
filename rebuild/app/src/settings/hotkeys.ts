// Settings → Hotkeys, after Obsidian 1.14's page: a filter field (with a
// keyboard button that filters by pressing a hotkey), filter pills (Conflicts,
// shown when there are any, All, Assigned, Assigned by me, Unassigned) and
// one row per command with its hotkeys as chips. "+" records a new hotkey
// ("Press hotkey..."; Escape cancels), a chip's × removes it, and the
// restore button puts back the defaults. A hotkey shared with another
// command shows red, naming the other command. Changes go through the
// settings store to the command registry, so they apply everywhere at once.

import { type Command, type CommandRegistry, type Hotkey, hotkeyFromEvent, hotkeyLabel, toStored } from "../commands";
import { h, keyButton, pressable } from "../shell/dom";
import { icon } from "../shell/icons";
import { extraButton } from "./controls";
import { settingsSession } from "./modal";
import { settings } from "./store";

type Filter = "conflicts" | "all" | "assigned" | "mine" | "unassigned";

let pendingQuery = "";
let active: { session: number; setQuery(q: string): void } | null = null;

/** Open the hotkeys page filtered to a core plugin's commands. */
export function showHotkeysFor(name: string) {
  if (active && active.session === settingsSession()) active.setQuery(name);
  else pendingQuery = name;
}

const sameKeys = (a: Hotkey, b: Hotkey) => hotkeyLabel(a) === hotkeyLabel(b);

export function createHotkeysPage(registry: CommandRegistry): HTMLElement {
  let filter: Filter = "all";
  let capturing: string | null = null;
  let listeningForQuery = false;

  const query = h("input", { class: "setting-hotkey-search", type: "search", value: pendingQuery, placeholder: "Filter...", spellcheck: "false", "aria-label": "Filter commands" });
  pendingQuery = "";
  const byKey = keyButton(icon("keyboard", 16), "Search by hotkey", () => toggleListening(), "input-right-decorator");

  const pills = new Map<Filter, HTMLElement>();
  const conflictBadge = h("span", { class: "setting-group-filter-badge" });
  const pill = (f: Filter, ...label: (Node | string)[]) => {
    const el = pressable(h("div", { class: `setting-group-filter${f === "conflicts" ? " mod-error" : ""}`, role: "button" }, ...label), () => {
      filter = filter === f && f === "conflicts" ? "all" : f;
      apply();
    });
    pills.set(f, el);
    return el;
  };
  const filters = h(
    "div",
    { class: "setting-group-filters" },
    pill("conflicts", h("span", null, "Conflicts"), conflictBadge),
    pill("all", "All"),
    pill("assigned", "Assigned"),
    pill("mine", "Assigned by me"),
    pill("unassigned", "Unassigned"),
  );

  // ----- rows -----
  interface Row {
    cmd: Command;
    el: HTMLElement;
    keys: HTMLElement;
    restore: HTMLElement;
    add: HTMLElement;
    text: string;
  }
  const rows: Row[] = registry
    .all()
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
    .map((cmd) => {
      const keys = h("div", { class: "setting-command-hotkeys" });
      const restore = extraButton("rotate-ccw", "Restore default", () => settings.setHotkeys(cmd.id, null), "setting-restore-hotkey-button");
      const add = extraButton("circle-plus", "Customize this command", () => startCapture(cmd.id), "setting-add-hotkey-button");
      const el = h(
        "div",
        { class: "setting-item mod-hotkey" },
        h("div", { class: "setting-item-info" }, h("div", { class: "setting-item-name" }, cmd.name)),
        h("div", { class: "setting-item-control" }, keys, restore, add),
      );
      return { cmd, el, keys, restore, add, text: cmd.name.toLowerCase() };
    });
  const byId = new Map(rows.map((r) => [r.cmd.id, r]));

  const setHotkeys = (id: string, list: Hotkey[]) => settings.setHotkeys(id, list.map(toStored));

  function renderRow(r: Row) {
    const list = registry.hotkeysOf(r.cmd.id);
    const chips: HTMLElement[] = list.map((hk) => {
      const others = registry.conflicts(hk, r.cmd.id);
      const chip = h(
        "span",
        { class: `setting-hotkey${others.length ? " has-conflict" : ""}` },
        hotkeyLabel(hk),
        extraButton("x", "Delete hotkey", () => setHotkeys(r.cmd.id, list.filter((x) => !sameKeys(x, hk))), "setting-hotkey-icon setting-delete-hotkey"),
      );
      if (others.length) chip.title = `This hotkey conflicts with ${others.map((c) => `“${c.name}”`).join(", ")}`;
      return chip;
    });
    if (capturing === r.cmd.id) chips.push(h("span", { class: "setting-hotkey mod-active" }, "Press hotkey..."));
    else if (!list.length) chips.push(h("span", { class: "setting-hotkey mod-empty" }, "Blank"));
    r.keys.replaceChildren(...chips);
    r.restore.hidden = !registry.isCustomized(r.cmd.id);
    r.add.classList.toggle("mod-active", capturing === r.cmd.id);
  }

  const hasConflict = (r: Row) => registry.hotkeysOf(r.cmd.id).some((hk) => registry.conflicts(hk, r.cmd.id).length > 0);

  function apply() {
    const q = query.value.trim().toLowerCase();
    let conflicts = 0;
    for (const r of rows) {
      const list = registry.hotkeysOf(r.cmd.id);
      const conflict = hasConflict(r);
      if (conflict) conflicts++;
      const matches = !q || r.text.includes(q) || list.some((hk) => hotkeyLabel(hk).toLowerCase() === q);
      const passes =
        filter === "all" ||
        (filter === "conflicts" && conflict) ||
        (filter === "assigned" && list.length > 0) ||
        (filter === "mine" && registry.isCustomized(r.cmd.id)) ||
        (filter === "unassigned" && list.length === 0);
      r.el.hidden = !(matches && passes);
    }
    if (!conflicts && filter === "conflicts") filter = "all";
    conflictBadge.textContent = String(conflicts);
    pills.get("conflicts")!.hidden = conflicts === 0;
    for (const [f, el] of pills) el.classList.toggle("is-active", f === filter);
    empty.hidden = rows.some((r) => !r.el.hidden);
  }

  function renderAll(only = rows) {
    for (const r of only) renderRow(r);
    apply();
  }

  // ----- recording a hotkey -----
  function startCapture(id: string) {
    stopCapture();
    capturing = id;
    renderRow(byId.get(id)!);
    window.addEventListener("keydown", onCaptureKey, true);
    document.addEventListener("pointerdown", onCapturePointer, true);
  }
  function stopCapture() {
    const was = capturing;
    capturing = null;
    window.removeEventListener("keydown", onCaptureKey, true);
    document.removeEventListener("pointerdown", onCapturePointer, true);
    if (was) renderRow(byId.get(was)!);
  }
  function onCaptureKey(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    const id = capturing!;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    if (e.key === "Escape" && plain) return stopCapture();
    const hk = hotkeyFromEvent(e);
    if (!hk) return; // only modifiers so far
    const list = registry.hotkeysOf(id);
    stopCapture();
    if (!list.some((x) => sameKeys(x, hk))) setHotkeys(id, [...list, hk]);
  }
  function onCapturePointer(e: PointerEvent) {
    if (!(e.target as HTMLElement).closest(".setting-add-hotkey-button")) stopCapture();
  }

  // ----- filtering by pressing a hotkey -----
  function onQueryKey(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    if (e.key === "Escape" && plain) return stopListening();
    const hk = hotkeyFromEvent(e);
    if (!hk) return;
    query.value = hotkeyLabel(hk);
    stopListening();
    apply();
  }
  function stopListening() {
    listeningForQuery = false;
    byKey.classList.remove("is-active");
    query.placeholder = "Filter...";
    window.removeEventListener("keydown", onQueryKey, true);
  }
  const toggleListening = () => {
    if (listeningForQuery) return stopListening();
    listeningForQuery = true;
    byKey.classList.add("is-active");
    query.value = "";
    query.placeholder = "Press a hotkey...";
    window.addEventListener("keydown", onQueryKey, true);
  };
  query.addEventListener("input", apply);

  const empty = h("div", { class: "setting-search-empty" }, "No commands match.");
  // The first screenful of rows is drawn at once, the rest on the next frame,
  // so the page opens within a frame.
  const FIRST = 24;
  const list = h("div", { class: "setting-items" }, ...rows.slice(0, FIRST).map((r) => r.el), empty);
  requestAnimationFrame(() => {
    for (const r of rows.slice(FIRST)) renderRow(r);
    empty.before(...rows.slice(FIRST).map((r) => r.el));
  });
  const page = h(
    "div",
    { class: "setting-group mod-list mod-hotkeys" },
    h(
      "div",
      { class: "setting-group-search" },
      h("div", { class: "search-input-container mod-hotkey" }, icon("search", 16), query, byKey),
      filters,
    ),
    list,
  );

  // Hotkeys changed (here or by a command): redraw the chips, keep the filter.
  // A page from an earlier opening of settings lets go on the next change.
  const stop = registry.onChange(() => {
    if (session !== settingsSession()) stop();
    else renderAll();
  });
  const session = settingsSession();
  active = {
    session,
    setQuery(q) {
      query.value = q;
      filter = "all";
      apply();
    },
  };
  renderAll(rows.slice(0, FIRST));
  return page;
}
