// Direct writers (link updates, properties, attachments, an unloaded note)
// have no dirty set of their own. While a vault switch has sealed saves they
// queue here, keyed by the path, and go out only after the old root is back.
// A queued write is not a success: callers must not treat the bytes as landed.

import { api } from "./api";
import { writesSealed } from "./saveSeal";

interface NoteHandoff {
  text: string;
  notify?: () => void;
}

let quiet: Promise<void> = Promise.resolve();
const notes = new Map<string, NoteHandoff>();
const configs = new Map<string, string>();
const later: Array<() => Promise<void>> = [];

/** True when a direct write is waiting for the seal to lift. */
export function handoffPending(): boolean {
  return notes.size > 0 || configs.size > 0 || later.length > 0;
}

/** Resolves when every write that already started has settled. */
export function vaultQuiet(): Promise<void> {
  return quiet;
}

function track<T>(work: Promise<T>): Promise<T> {
  const done = work.finally(() => {});
  const settled = done.then(() => {}, () => {});
  quiet = quiet.then(() => settled);
  return done;
}

export async function writeVaultNote(path: string, text: string, notify?: () => void): Promise<"queued" | "sent"> {
  if (writesSealed()) {
    notes.set(path, { text, notify });
    return "queued";
  }
  await track(api.writeNote(path, text));
  notify?.();
  return "sent";
}

export async function writeVaultConfig(name: string, text: string): Promise<"queued" | "sent"> {
  if (writesSealed()) {
    configs.set(name, text);
    return "queued";
  }
  await track(api.writeConfig(name, text));
  return "sent";
}

/**
 * Run `work` against the current vault, or after the seal lifts.
 * The returned promise waits until `work` finishes, including a handoff
 * flushed once the old root is restored. The vault switch itself must not
 * await this from inside `open`, or the handoff cannot run.
 */
export function runOnVault(work: () => Promise<void>): Promise<void> {
  if (!writesSealed()) return track(work());
  return new Promise((resolve, reject) => {
    later.push(async () => {
      try {
        await work();
        resolve();
      } catch (err) {
        reject(err);
        throw err;
      }
    });
  });
}

/** Send everything queued during the seal. False leaves it queued. */
export async function flushHandoff(): Promise<boolean> {
  if (writesSealed()) return false;
  const noteEntries = [...notes];
  const configEntries = [...configs];
  const jobs = later.splice(0);
  notes.clear();
  configs.clear();
  let failed = false;
  await Promise.all([
    ...noteEntries.map(async ([path, saved]) => {
      try {
        await track(api.writeNote(path, saved.text));
        try { saved.notify?.(); } catch { /* the bytes landed; a listener can fail on its own */ }
      } catch {
        failed = true;
        if (!notes.has(path)) notes.set(path, saved);
      }
    }),
    ...configEntries.map(async ([name, text]) => {
      try {
        await track(api.writeConfig(name, text));
      } catch {
        failed = true;
        if (!configs.has(name)) configs.set(name, text);
      }
    }),
    ...jobs.map(async (job) => {
      try {
        await job();
      } catch {
        failed = true;
        later.push(job);
      }
    }),
  ]);
  return !failed && !handoffPending();
}
