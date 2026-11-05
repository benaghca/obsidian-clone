import { beforeEach, expect, test, vi } from "vitest";

// The backend as a map of files: .grove settings by name, foreign files by "source/name".
const disk = vi.hoisted(() => ({ grove: new Map<string, string>(), foreign: new Map<string, string>(), reads: [] as string[], fail: new Set<string>() }));
vi.mock("../api", () => ({
  api: {
    readConfig: async (name: string) => disk.grove.get(name) ?? null,
    writeConfig: async (name: string, content: string) => {
      if (disk.fail.has(name)) throw new Error("disk full");
      disk.grove.set(name, content);
    },
    readForeignConfig: async (source: string, name: string) => {
      disk.reads.push(`${source}/${name}`);
      return disk.foreign.get(`${source}/${name}`) ?? null;
    },
  },
}));
const notices = vi.hoisted(() => [] as string[][]);
vi.mock("../shell/notice", () => ({ notice: (lines: string[]) => notices.push(lines) }));

const { settings } = await import("./store");
const { importForeignSettings } = await import("./importSettings");

beforeEach(() => {
  disk.grove.clear();
  disk.foreign.clear();
  disk.reads.length = 0;
  disk.fail.clear();
  notices.length = 0;
});

test("the first open of a vault with Cinder's settings imports them into .grove once, with one notice", async () => {
  disk.foreign.set("cinder/settings.json", JSON.stringify({ dailyFolder: "Daily", attachFolder: "Files", weeklyFolder: "Weekly" }));
  const foreignBefore = new Map(disk.foreign);
  await settings.load();
  expect(settings.fresh).toBe(true);
  await importForeignSettings();
  expect(settings.get("daily-notes.json").folder).toBe("Daily");
  expect(settings.get("app.json").attachmentFolderPath).toBe("Files");
  expect(settings.get("templates.json").folder).toBe("Templates");
  expect([...disk.grove.keys()].sort()).toEqual(["app.json", "daily-notes.json", "templates.json"]);
  expect(JSON.parse(disk.grove.get("daily-notes.json")!)).toEqual({ folder: "Daily" });
  expect(JSON.parse(disk.grove.get("app.json")!)).toEqual({ attachmentFolderPath: "Files" });
  expect(disk.foreign).toEqual(foreignBefore);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toEqual([
    "Imported settings from Cinder:",
    "• Daily notes folder: Daily",
    "• Template folder: Templates",
    "• Attachment folder: Files",
    "Not imported: weekly notes.",
  ]);
  // The next open finds Grove's own settings and doesn't look at Cinder's again.
  disk.reads.length = 0;
  await settings.load();
  expect(settings.fresh).toBe(false);
  await importForeignSettings();
  expect(disk.reads).toEqual([]);
  expect(notices).toHaveLength(1);
  expect(settings.get("daily-notes.json").folder).toBe("Daily");
});

test("a vault that already has Grove settings is left alone, even with Cinder's beside them", async () => {
  disk.grove.set("hotkeys.json", "{}");
  disk.foreign.set("cinder/settings.json", JSON.stringify({ dailyFolder: "Daily" }));
  await settings.load();
  expect(settings.fresh).toBe(false);
  await importForeignSettings();
  expect(disk.reads).toEqual([]);
  expect(settings.get("daily-notes.json").folder).toBe("");
  // An unreadable .grove file counts as there too.
  disk.grove.clear();
  disk.grove.set("app.json", "{ broken");
  await settings.load();
  expect(settings.fresh).toBe(false);
});

test("bad JSON writes nothing, says why, and the next open tries again", async () => {
  disk.foreign.set("cinder/settings.json", "{ nope");
  await settings.load();
  await importForeignSettings();
  expect(disk.grove.size).toBe(0);
  expect(settings.get("templates.json").folder).toBe("");
  expect(notices).toEqual([["Grove didn't import this vault's settings:", "• .cinder/settings.json isn't valid JSON", "Fix the file and open the vault again to import them."]]);
  disk.foreign.set("cinder/settings.json", "{}");
  await settings.load();
  expect(settings.fresh).toBe(true);
  await importForeignSettings();
  expect(settings.get("templates.json").folder).toBe("Templates");
  expect(disk.grove.size).toBe(3);
});

test("neither Cinder's nor Obsidian's settings: no notice and no files", async () => {
  await settings.load();
  await importForeignSettings();
  expect(disk.reads.sort()).toEqual(["cinder/settings.json", "obsidian/app.json", "obsidian/daily-notes.json", "obsidian/templates.json"]);
  expect(disk.grove.size).toBe(0);
  expect(notices).toEqual([]);
});

test("Obsidian's settings import the same way, and a failed save is said in the notice", async () => {
  disk.foreign.set("obsidian/daily-notes.json", JSON.stringify({ folder: "Journal", format: "DD-MM-YYYY" }));
  disk.foreign.set("obsidian/app.json", JSON.stringify({ attachmentFolderPath: "./img" }));
  disk.fail.add("app.json");
  await settings.load();
  await importForeignSettings();
  expect(settings.get("daily-notes.json")).toMatchObject({ folder: "Journal", format: "DD-MM-YYYY" });
  expect(settings.get("app.json").attachmentFolderPath).toBe("./img");
  expect([...disk.grove.keys()].sort()).toEqual(["daily-notes.json", "templates.json"]);
  expect(notices[0][0]).toBe("Imported settings from Obsidian:");
  expect(notices[0].at(-1)).toBe("Couldn't save .grove/app.json; the settings apply until Grove closes.");
});
