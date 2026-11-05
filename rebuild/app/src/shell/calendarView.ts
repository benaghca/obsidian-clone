// Calendar for the right sidebar, part of the Daily notes plugin. A month
// grid: today is marked, and a day with a daily note has a dot. Click a day
// to open or create its note; Ctrl+click (or a middle click) opens it in a
// new tab. Previous, next and Today move the month. The grid is drawn from
// ws.vault.notes and the daily-notes settings. Painting does no I/O.
// Week numbers, month-name clicks and task-due rings are left out.

import { openDailyNote } from "../editorHost";
import { settings } from "../settings/store";
import { type OpenWhere, whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { type CalendarCell, dailyNoteDays, dailyNoteTime, dayKey, dayLabel, dayTime, monthGrid, monthTitle, weekdayLabels, type WeekStart } from "./calendarGrid";
import { h, iconButton } from "./dom";
import { icon } from "./icons";
import type { SideView } from "./sideView";

/** The clicked day, at the current time of day so a template's {{time}} is not midnight. */
function noteDate(cell: CalendarCell): Date {
  const now = new Date();
  return new Date(cell.year, cell.month, cell.day, now.getHours(), now.getMinutes(), now.getSeconds());
}

export function createCalendarView(ws: Workspace): SideView {
  const title = h("div", { class: "calendar-title" });
  const prev = iconButton(icon("chevron-left", 16), "Previous month", () => shift(-1));
  const next = iconButton(icon("chevron-right", 16), "Next month", () => shift(1));
  const todayBtn = h("button", { class: "calendar-today", type: "button", "aria-label": "Today", onclick: () => show(new Date()) }, "Today");
  const names = h("div", { class: "calendar-names" });
  const grid = h("div", { class: "calendar-grid", role: "grid", "aria-label": "Calendar" });
  const el = h(
    "div",
    { class: "calendar-view" },
    h("div", { class: "calendar-head" }, title, prev, todayBtn, next),
    names,
    grid,
    h("div", { class: "calendar-hint" }, "Click a day to open its note. Ctrl+click opens a new tab."),
  );

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let active = false;
  let stale = true;
  let opening = false;
  /** The note list and settings the dots were last counted from. */
  let counted: { notes: typeof ws.vault.notes; folder: string; format: string; days: Set<number> } | null = null;

  function show(date: Date) {
    year = date.getFullYear();
    month = date.getMonth();
    stale = true;
    if (active) paint();
  }

  function shift(delta: number) {
    show(new Date(year, month + delta, 1));
  }

  function days(): Set<number> {
    const daily = settings.get("daily-notes.json");
    const folder = daily.folder;
    const format = daily.format;
    if (counted && counted.notes === ws.vault.notes && counted.folder === folder && counted.format === format) return counted.days;
    const next = dailyNoteDays(ws.vault.notes, folder, format);
    counted = { notes: ws.vault.notes, folder, format, days: next };
    return next;
  }

  function mark() {
    stale = true;
    if (active) paint();
  }

  async function openCell(cell: CalendarCell, event: MouseEvent) {
    if (opening) return;
    opening = true;
    try {
      const where: OpenWhere = event.button === 1 ? "tab" : whereFromEvent(event);
      await openDailyNote(ws, noteDate(cell), where);
    } catch (err) {
      console.error("Could not open the daily note", err);
    } finally {
      opening = false;
    }
  }

  function paint() {
    if (!active) return;
    stale = false;
    const daily = settings.get("daily-notes.json");
    const weekStart: WeekStart = daily.weekStart === "sunday" ? "sunday" : "monday";
    const present = days();
    const open = dailyNoteTime(ws.active.path, daily.folder, daily.format);
    const today = new Date();
    title.textContent = monthTitle(year, month);
    names.replaceChildren(...weekdayLabels(weekStart).map((label) => h("span", {}, label)));
    const buttons: HTMLButtonElement[] = [];
    for (const row of monthGrid(year, month, weekStart)) {
      for (const cell of row) {
        const time = dayTime(cell.year, cell.month, cell.day);
        const has = present.has(time);
        const isToday = cell.year === today.getFullYear() && cell.month === today.getMonth() && cell.day === today.getDate();
        buttons.push(h(
          "button",
          {
            class: ["calendar-day", cell.inMonth ? "" : "is-outside", isToday ? "is-today" : "", has ? "has-note" : "", open === time ? "is-active" : ""].filter(Boolean).join(" "),
            type: "button",
            role: "gridcell",
            "data-day": dayKey(cell),
            "aria-label": dayLabel(cell, has),
            "aria-current": isToday ? "date" : undefined,
            "aria-selected": open === time ? "true" : undefined,
            onclick: (event: MouseEvent) => void openCell(cell, event),
            onauxclick: (event: MouseEvent) => {
              if (event.button !== 1) return;
              event.preventDefault();
              void openCell(cell, event);
            },
          },
          h("span", { class: "calendar-num" }, String(cell.day)),
          h("span", { class: has ? "calendar-dot" : "calendar-dot is-empty" }),
        ));
      }
    }
    grid.replaceChildren(...buttons);
  }

  ws.on((change) => {
    if (change === "files" || change === "show") mark();
  });
  settings.on((file) => {
    if (file === null || file === "daily-notes.json") mark();
  });

  return {
    el,
    setActive(next: boolean) {
      if (next === active) return;
      active = next;
      if (active && stale) paint();
    },
  };
}
