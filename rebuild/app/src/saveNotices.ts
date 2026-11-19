// When a note's saves keep failing, say so once. The retry loop is not here:
// this only decides which notices to show, and when to stay quiet.

import { noteName } from "./paths";

/** Rejected writes in a row before the first notice. One blip stays quiet. */
export const SAVE_NOTICE_AFTER_FAILURES = 2;

/** Failures that land together share one notice. */
export const SAVE_NOTICE_COALESCE_MS = 100;

/** Failure notices in one outage. A later outage, after every note has saved, may speak again. */
export const SAVE_NOTICE_CAP = 3;

const LQ = "\u201C";
const RQ = "\u201D";

interface Streak {
  failures: number;
  /** The user was told, or a notice for this note is waiting to be shown. */
  announced: boolean;
  /** The outage already used its notices. Stay quiet, including when it later saves. */
  suppressed: boolean;
}

interface QueuedFailure {
  path: string;
  reason: string;
}

export interface SaveNoticeBoard {
  /** A write of `path` was rejected and the note is still dirty. */
  reject(path: string, reason: string): void;
  /** The latest text of `path` reached disk. */
  landed(path: string): void;
  /** The note is gone. No "saved" notice. */
  drop(under: (path: string) => boolean): void;
  /** A rename retargets an open streak. */
  rekey(under: (path: string) => boolean, swap: (path: string) => string): void;
}

/**
 * A short reason for a notice. Rust I/O errors look like "Permission denied (os error 13)".
 * The parenthetical is noise next to the sentence. A missing message gets a plain fallback.
 */
export function saveFailureReason(err: unknown): string {
  let raw = "";
  if (typeof err === "string") raw = err;
  else if (err instanceof Error) raw = err.message;
  else if (err && typeof err === "object" && "message" in err && typeof err.message === "string") raw = err.message;
  const cleaned = raw.replace(/\s+/g, " ").replace(/ \(os error \d+\)$/i, "").trim();
  const reason = cleaned || "the file could not be written";
  const cap = 160;
  return reason.length > cap ? `${reason.slice(0, cap - 1)}\u2026` : reason;
}

function labels(paths: string[]): string[] {
  return paths.map((path) => {
    const name = noteName(path);
    const collision = paths.some((other) => other !== path && noteName(other) === name);
    return collision ? path : name;
  });
}

function quotedList(names: string[]): string {
  const quoted = names.map((name) => `${LQ}${name}${RQ}`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  if (quoted.length === 3) return `${quoted[0]}, ${quoted[1]}, and ${quoted[2]}`;
  return `${quoted[0]}, ${quoted[1]}, and ${quoted.length - 2} more`;
}

function failureSentence(items: QueuedFailure[]): string {
  const who = quotedList(labels(items.map((item) => item.path)));
  const shared = items.every((item) => item.reason === items[0]?.reason) ? items[0]?.reason ?? "" : "";
  const why = shared ? `: ${shared}` : "";
  return `Couldn\u2019t save ${who}${why}. Grove will keep trying.`;
}

function savedSentence(paths: string[]): string {
  return `Saved ${quotedList(labels(paths))}.`;
}

function dedupeFailures(items: QueuedFailure[]): QueuedFailure[] {
  const seen = new Set<string>();
  const out: QueuedFailure[] = [];
  for (const item of items) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
  }
  return out;
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

export function createSaveNotices(
  show: (lines: string[]) => void,
  schedule: (run: () => void) => void = (run) => {
    window.setTimeout(run, SAVE_NOTICE_COALESCE_MS);
  },
): SaveNoticeBoard {
  const streaks = new Map<string, Streak>();
  let failQueue: QueuedFailure[] = [];
  let saveQueue: string[] = [];
  let failureNoticesShown = 0;
  let pending = false;

  const endWave = () => {
    if (streaks.size === 0 && failQueue.length === 0) failureNoticesShown = 0;
  };

  const drain = () => {
    const fails = dedupeFailures(failQueue.splice(0));
    const saves = dedupePaths(saveQueue.splice(0));
    if (fails.length) {
      failureNoticesShown += 1;
      show([failureSentence(fails)]);
    }
    if (saves.length) show([savedSentence(saves)]);
    endWave();
  };

  const kick = () => {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      drain();
    });
  };

  return {
    reject(path, reason) {
      let streak = streaks.get(path);
      if (!streak) {
        streak = { failures: 0, announced: false, suppressed: false };
        streaks.set(path, streak);
      }
      if (streak.announced || streak.suppressed) return;
      streak.failures += 1;
      if (streak.failures < SAVE_NOTICE_AFTER_FAILURES) return;
      if (failureNoticesShown >= SAVE_NOTICE_CAP) {
        streak.suppressed = true;
        return;
      }
      streak.announced = true;
      failQueue.push({ path, reason });
      kick();
    },

    landed(path) {
      const streak = streaks.get(path);
      if (!streak) return;
      streaks.delete(path);
      const at = failQueue.findIndex((item) => item.path === path);
      // Still waiting to speak: the save won. Say nothing.
      if (at >= 0) failQueue.splice(at, 1);
      else if (streak.announced) {
        saveQueue.push(path);
        kick();
      }
      endWave();
    },

    drop(under) {
      for (const path of [...streaks.keys()]) if (under(path)) streaks.delete(path);
      failQueue = failQueue.filter((item) => !under(item.path));
      saveQueue = saveQueue.filter((path) => !under(path));
      endWave();
    },

    rekey(under, swap) {
      for (const [path, streak] of [...streaks]) {
        if (!under(path)) continue;
        streaks.delete(path);
        streaks.set(swap(path), streak);
      }
      for (const item of failQueue) if (under(item.path)) item.path = swap(item.path);
      saveQueue = saveQueue.map((path) => (under(path) ? swap(path) : path));
    },
  };
}
