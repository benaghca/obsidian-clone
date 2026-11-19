// The save-failure notice: once per streak, quiet again after a save, and one
// notice when many notes fail together. No window.
import { expect, test } from "vitest";
import { createSaveNotices, saveFailureReason, type SaveNoticeBoard } from "./saveNotices";

const q = (name: string) => `\u201C${name}\u201D`;

function failure(who: string, reason?: string): string {
  const why = reason ? `: ${reason}` : "";
  return `Couldn\u2019t save ${who}${why}. Grove will keep trying.`;
}

function saved(who: string): string {
  return `Saved ${who}.`;
}

function harness() {
  const shown: string[][] = [];
  const queued: Array<() => void> = [];
  const board: SaveNoticeBoard = createSaveNotices(
    (lines) => { shown.push(lines); },
    (run) => { queued.push(run); },
  );
  return {
    shown,
    board,
    waiting: () => queued.length,
    drain() {
      const run = queued.shift();
      if (!run) throw new Error("no notice was waiting");
      run();
    },
  };
}

function failTwice(board: SaveNoticeBoard, path: string, reason = "disk full") {
  board.reject(path, reason);
  board.reject(path, reason);
}

test("a reason keeps the useful part of an I/O error", () => {
  expect(saveFailureReason(new Error("Permission denied (os error 13)"))).toBe("Permission denied");
  expect(saveFailureReason("Read-only file system (os error 30)")).toBe("Read-only file system");
  expect(saveFailureReason("Note is not UTF-8")).toBe("Note is not UTF-8");
  expect(saveFailureReason(new Error("  disk\nfull  "))).toBe("disk full");
  expect(saveFailureReason(new Error(""))).toBe("the file could not be written");
  expect(saveFailureReason({ message: "No space left on device (os error 28)" })).toBe("No space left on device");
  expect(saveFailureReason(undefined)).toBe("the file could not be written");
  const long = "x".repeat(161);
  expect(saveFailureReason(long)).toBe(`${"x".repeat(159)}\u2026`);
  expect(saveFailureReason(long)).toHaveLength(160);
});

test("one failure stays quiet, and the second failure of a streak speaks once", () => {
  const { board, shown, drain, waiting } = harness();
  board.reject("Daily.md", "disk full");
  expect(waiting()).toBe(0);
  board.reject("Daily.md", "disk full");
  expect(waiting()).toBe(1);
  board.reject("Daily.md", "still full");
  board.reject("Daily.md", "still full");
  expect(waiting()).toBe(1);
  drain();
  expect(shown).toEqual([[failure(q("Daily"), "disk full")]]);
  board.reject("Daily.md", "disk full");
  expect(waiting()).toBe(0);
});

test("a confirmed write resets the count, and the saved notice waits", () => {
  const { board, shown, drain, waiting } = harness();
  board.reject("Daily.md", "disk full");
  board.confirmed("Daily.md");
  board.reject("Daily.md", "disk full");
  expect(waiting()).toBe(0);
  board.reject("Daily.md", "disk full");
  drain();
  expect(shown).toEqual([[failure(q("Daily"), "disk full")]]);
  board.confirmed("Daily.md");
  expect(waiting()).toBe(0);
  board.landed("Daily.md");
  drain();
  expect(shown.map((lines) => lines[0])).toEqual([
    failure(q("Daily"), "disk full"),
    saved(q("Daily")),
  ]);
});

test("a save clears the streak, and the next streak can speak again", () => {
  const { board, shown, drain } = harness();
  board.reject("Daily.md", "disk full");
  board.landed("Daily.md");
  expect(shown).toEqual([]);
  failTwice(board, "Daily.md");
  board.landed("Daily.md");
  drain();
  expect(shown).toEqual([]);
  failTwice(board, "Daily.md", "Permission denied");
  drain();
  expect(shown).toEqual([[failure(q("Daily"), "Permission denied")]]);
  board.landed("Daily.md");
  drain();
  expect(shown.map((lines) => lines[0])).toEqual([
    failure(q("Daily"), "Permission denied"),
    saved(q("Daily")),
  ]);
  board.reject("Daily.md", "Permission denied");
  expect(shown).toHaveLength(2);
  failTwice(board, "Daily.md", "Permission denied");
  drain();
  expect(shown).toHaveLength(3);
  expect(shown[2]).toEqual([failure(q("Daily"), "Permission denied")]);
});

test("many notes that fail together share one notice", () => {
  const { board, shown, drain, waiting } = harness();
  for (const path of ["A.md", "B.md", "C.md", "D.md", "E.md"]) failTwice(board, path, "Read-only file system");
  expect(waiting()).toBe(1);
  drain();
  expect(shown).toEqual([[failure(`${q("A")}, ${q("B")}, and 3 more`, "Read-only file system")]]);
});

test("notes that fail apart stay under a cap, and a new outage may speak again", () => {
  const h = harness();
  const { board, shown } = h;
  for (const path of ["A.md", "B.md", "C.md", "D.md"]) {
    failTwice(board, path);
    if (h.waiting()) h.drain();
  }
  expect(shown.map((lines) => lines[0])).toEqual([
    failure(q("A"), "disk full"),
    failure(q("B"), "disk full"),
    failure(q("C"), "disk full"),
  ]);
  board.landed("D.md");
  expect(shown).toHaveLength(3);
  for (const path of ["A.md", "B.md", "C.md"]) board.landed(path);
  h.drain();
  expect(shown[3]).toEqual([saved(`${q("A")}, ${q("B")}, and ${q("C")}`)]);
  failTwice(board, "D.md", "disk full");
  h.drain();
  expect(shown[4]).toEqual([failure(q("D"), "disk full")]);
});

test("mixed reasons leave the reason off the shared notice", () => {
  const { board, shown, drain } = harness();
  failTwice(board, "A.md", "disk full");
  failTwice(board, "B.md", "Permission denied");
  drain();
  expect(shown).toEqual([[failure(`${q("A")} and ${q("B")}`)]]);
});

test("two notes with the same name are told apart by their paths", () => {
  const { board, shown, drain } = harness();
  failTwice(board, "Folder/Daily.md", "disk full");
  failTwice(board, "Other/Daily.md", "disk full");
  drain();
  expect(shown).toEqual([[failure(`${q("Folder/Daily.md")} and ${q("Other/Daily.md")}`, "disk full")]]);
});

test("a rename before the notice uses the new name, once", () => {
  const { board, shown, drain, waiting } = harness();
  failTwice(board, "Old.md");
  board.rekey((path) => path === "Old.md", (path) => (path === "Old.md" ? "New.md" : path));
  board.reject("New.md", "disk full");
  expect(waiting()).toBe(1);
  drain();
  expect(shown).toEqual([[failure(q("New"), "disk full")]]);
});

test("deleting the note drops the streak without a saved notice", () => {
  const { board, shown, drain, waiting } = harness();
  failTwice(board, "Gone.md");
  board.drop((path) => path === "Gone.md");
  expect(waiting()).toBe(1);
  drain();
  expect(shown).toEqual([]);
  failTwice(board, "Kept.md", "Note is not UTF-8");
  drain();
  expect(shown).toEqual([[failure(q("Kept"), "Note is not UTF-8")]]);
  board.drop((path) => path === "Kept.md");
  expect(waiting()).toBe(0);
});
