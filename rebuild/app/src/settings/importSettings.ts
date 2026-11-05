// The first open of a vault with no Grove settings yet: take its daily-note,
// template, attachment and new-note settings from Cinder's or Obsidian's
// files (src/settings/foreign.ts), save them in .grove, and say what was
// imported in one notice. The foreign files are only read.

import { api } from "../api";
import { notice } from "../shell/notice";
import { FOREIGN_FILES, type ForeignFiles, type ForeignRead, IMPORT_FILES, importMessage, planImport } from "./foreign";
import { settings } from "./store";

/** How long the notice stays (it lists several lines; a click closes it sooner). */
const NOTICE_MS = 15000;

export async function importForeignSettings(): Promise<void> {
  if (!settings.fresh) return;
  const read = async (key: keyof ForeignFiles): Promise<ForeignRead> => {
    const { source, name } = FOREIGN_FILES[key];
    try {
      return await api.readForeignConfig(source, name);
    } catch (err) {
      return { error: String(err instanceof Error ? err.message : err) };
    }
  };
  const [cinder, daily, templates, app] = await Promise.all([read("cinder"), read("daily"), read("templates"), read("app")]);
  const plan = planImport({ cinder, daily, templates, app });
  const lines = importMessage(plan);
  if (!lines) return;
  if (plan.problems.length) {
    // Nothing is written, so the next open tries again once the file is fixed.
    console.warn("Settings: not imported", plan.problems);
    notice(lines, NOTICE_MS);
    return;
  }
  const failed = await settings.adopt(plan.values, IMPORT_FILES);
  if (failed.length) lines.push(`Couldn't save ${failed.map((f) => `.grove/${f}`).join(", ")}; the settings apply until Grove closes.`);
  notice(lines, NOTICE_MS);
}
