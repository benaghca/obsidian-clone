// The month grid for the calendar view. Pure dates: no DOM, no vault, no
// I/O. The view paints from this and from the notes it already has in memory.
// Week numbers and month names are not links; weekly and monthly notes are
// a later piece.

import { dailyNoteList } from "../settings/dateFormat";

export type WeekStart = "monday" | "sunday";

export interface CalendarCell {
  year: number;
  /** 0–11. */
  month: number;
  day: number;
  /** False for the leading and trailing days from the neighbouring months. */
  inMonth: boolean;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for a cell, the value the view puts on `data-day`. */
export function dayKey(cell: CalendarCell): string {
  return `${cell.year}-${pad(cell.month + 1)}-${pad(cell.day)}`;
}

/** The accessible name of a day: the date, and whether a daily note is there. */
export function dayLabel(cell: CalendarCell, hasNote: boolean): string {
  return `${cell.day} ${MONTHS[cell.month]} ${cell.year}${hasNote ? ", daily note" : ", no daily note yet"}`;
}

/** Local midnight, the same instant `dateNamePattern.parse` returns for that day. */
export function dayTime(year: number, month: number, day: number): number {
  return new Date(year, month, day).getTime();
}

export function monthTitle(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

export function weekdayLabels(weekStart: WeekStart): readonly string[] {
  return weekStart === "sunday"
    ? ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
    : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
}

/**
 * The weeks that cover `year`/`month` (month is 0–11). Each week is seven
 * days, Monday or Sunday first. A month that starts late in the week and
 * runs 31 days is six rows; a February that starts on the week start and
 * is not a leap year is four. Trailing weeks that begin after the month
 * are left out.
 */
export function monthGrid(year: number, month: number, weekStart: WeekStart): CalendarCell[][] {
  const first = new Date(year, month, 1).getDay();
  const lead = weekStart === "sunday" ? first : (first + 6) % 7;
  const origin = new Date(year, month, 1 - lead);
  const rows: CalendarCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + w * 7 + i);
      row.push({
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        inMonth: date.getFullYear() === year && date.getMonth() === month,
      });
    }
    if (w >= 4 && !row[0].inMonth) break;
    rows.push(row);
  }
  return rows;
}

/**
 * Local midnights of the days that have a daily note. Reads the note list
 * it is given (the vault's in-memory `notes`) and the daily-notes folder
 * and format, by the same rule as `openDailyNote` and previous/next
 * (`dailyNoteList`). Nothing is opened or read from disk.
 */
export function dailyNoteDays(notes: readonly { path: string }[], folder: string, format: string): Set<number> {
  return new Set(dailyNoteList(notes.map((n) => n.path), { folder, format }).map((n) => n.time));
}

/** The day `path` is a daily note for, or null when it is not one. */
export function dailyNoteTime(path: string | null, folder: string, format: string): number | null {
  if (!path) return null;
  const time = dailyNoteDays([{ path }], folder, format).values().next().value;
  return time === undefined ? null : time;
}
