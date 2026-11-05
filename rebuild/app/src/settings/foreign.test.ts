import { expect, test } from "vitest";
import { type ForeignFiles, importMessage, planImport } from "./foreign";

const none: ForeignFiles = { cinder: null, daily: null, templates: null, app: null };
const json = (v: unknown) => JSON.stringify(v);

test("Cinder: its keys map onto Grove's daily notes, templates, attachment and new-note settings", () => {
  const plan = planImport({
    ...none,
    cinder: json({ dailyFolder: "/Journal/Daily/", dailyFormat: "YYYY-MM-DD dddd", dailyTemplate: "Templates/Daily", templatesFolder: "Meta/Templates", attachFolder: "Files/", newNoteFolder: "Inbox" }),
  });
  expect(plan.source).toBe("Cinder");
  expect(plan.problems).toEqual([]);
  expect(plan.values).toEqual({
    "daily-notes.json": { folder: "Journal/Daily", format: "YYYY-MM-DD dddd", template: "Templates/Daily" },
    "templates.json": { folder: "Meta/Templates" },
    "app.json": { attachmentFolderPath: "Files", newFileLocation: "folder", newFileFolderPath: "Inbox" },
  });
  expect(plan.imported).toEqual([
    { label: "Daily notes folder", value: "Journal/Daily" },
    { label: "Daily note date format", value: "YYYY-MM-DD dddd" },
    { label: "Daily note template", value: "Templates/Daily" },
    { label: "Template folder", value: "Meta/Templates" },
    { label: "Attachment folder", value: "Files" },
    { label: "New note folder", value: "Inbox" },
  ]);
  expect(plan.notImported).toEqual([]);
});

test("Cinder: a missing key is Cinder's default, so {} still brings its Templates and attachments folders", () => {
  const plan = planImport({ ...none, cinder: "{}" });
  expect(plan.values).toEqual({ "daily-notes.json": {}, "templates.json": { folder: "Templates" }, "app.json": { attachmentFolderPath: "attachments" } });
  // Values of the wrong kind fall back to Cinder's default, as Cinder reads them; an empty
  // attachment folder is the vault folder, Grove's "/".
  const odd = planImport({ ...none, cinder: json({ dailyFolder: 5, dailyFormat: "", templatesFolder: null, attachFolder: "", newNoteFolder: "/" }) });
  expect(odd.values).toEqual({ "daily-notes.json": {}, "templates.json": { folder: "Templates" }, "app.json": {} });
  expect(odd.imported).toEqual([{ label: "Template folder", value: "Templates" }]);
});

test("Cinder: weekly and monthly notes, folder templates, Templater and other settings are listed, not imported", () => {
  const plan = planImport({
    ...none,
    cinder: json({
      dailyFolder: "Daily",
      weeklyFormat: "YYYY-[W]ww",
      monthlyFolder: "Monthly",
      folderTemplates: "Meetings: Templates/Meeting",
      weekStart: "sunday",
      webEmbeds: "auto", // Cinder's default: not a change, not listed
      plugins: { templater: true, "daily-notes": true },
      theme: "dark",
      vim: true,
    }),
  });
  expect(plan.values["daily-notes.json"]).toEqual({ folder: "Daily" });
  expect(plan.notImported).toEqual([
    "weekly notes",
    "monthly notes",
    "folder templates",
    "calendar week start",
    "Templater syntax",
    "3 other Cinder settings (plugins, theme, vim)",
  ]);
  const lines = importMessage(plan)!;
  expect(lines[0]).toBe("Imported settings from Cinder:");
  expect(lines).toContain("• Daily notes folder: Daily");
  expect(lines.at(-1)).toBe("Not imported: weekly notes; monthly notes; folder templates; calendar week start; Templater syntax; 3 other Cinder settings (plugins, theme, vim).");
  // The periodic-notes plugin alone means weekly and monthly notes were in use.
  expect(planImport({ ...none, cinder: json({ plugins: { "periodic-notes": true } }) }).notImported).toEqual(["weekly and monthly notes"]);
  // A weekly folder only covers weekly notes; the plugin still means monthly notes too.
  expect(planImport({ ...none, cinder: json({ weeklyFolder: "W", plugins: { "periodic-notes": true } }) }).notImported).toEqual(["weekly notes", "monthly notes"]);
  expect(planImport({ ...none, cinder: json({ weeklyFolder: "W", monthlyFolder: "M", plugins: { "periodic-notes": true } }) }).notImported).toEqual(["weekly notes", "monthly notes"]);
  // A plugins value that isn't an on/off map is still named, not dropped.
  expect(planImport({ ...none, cinder: json({ plugins: ["templater"] }) }).notImported).toEqual(["1 other Cinder setting (plugins)"]);
});

test("Obsidian: daily-notes.json, templates.json and app.json, as Grove reads the same keys", () => {
  const plan = planImport({
    ...none,
    daily: json({ folder: "Journal/", format: "DD-MM-YYYY", template: "Templates/Daily", autorun: true }),
    templates: json({ folder: "Templates", dateFormat: "D MMM YYYY", timeFormat: "" }),
    app: json({ attachmentFolderPath: "./assets", newFileLocation: "current", newFileFolderPath: "Old", useMarkdownLinks: true, promptDelete: false }),
  });
  expect(plan.source).toBe("Obsidian");
  expect(plan.values).toEqual({
    "daily-notes.json": { folder: "Journal", format: "DD-MM-YYYY", template: "Templates/Daily" },
    "templates.json": { folder: "Templates", dateFormat: "D MMM YYYY" },
    // "./assets" is relative to the note in Grove too; the folder only counts with "folder".
    "app.json": { attachmentFolderPath: "./assets", newFileLocation: "current" },
  });
  expect(plan.imported.map((i) => `${i.label}: ${i.value}`)).toEqual([
    "Daily notes folder: Journal",
    "Daily note date format: DD-MM-YYYY",
    "Daily note template: Templates/Daily",
    "Template folder: Templates",
    "Template date format: D MMM YYYY",
    "Attachment folder: ./assets",
    "New notes go in: the current note's folder",
  ]);
  expect(plan.notImported).toEqual(["opening today's daily note on startup", "2 other Obsidian settings (useMarkdownLinks, promptDelete)"]);
  // A note path keeps its ".md" and loses slashes, so Grove can resolve it.
  expect(planImport({ ...none, daily: json({ template: "/Templates/Daily.md/" }) }).values["daily-notes.json"].template).toBe("Templates/Daily.md");
  // A known key of the wrong type is named, and the other keys still import.
  const typed = planImport({ ...none, daily: json({ folder: 5, format: "DD-MM-YYYY" }) });
  expect(typed.values["daily-notes.json"]).toEqual({ format: "DD-MM-YYYY" });
  expect(typed.notImported).toEqual(["Daily notes folder (5 isn't a value Grove takes)"]);
  // Only some of the files is fine; "./" reads as the note's folder.
  const app = planImport({ ...none, app: json({ attachmentFolderPath: "./", newFileLocation: "folder", newFileFolderPath: "/New/" }) });
  expect(app.values["app.json"]).toEqual({ attachmentFolderPath: "./", newFileLocation: "folder", newFileFolderPath: "New" });
  expect(app.imported).toEqual([{ label: "Attachment folder", value: "the note's folder" }, { label: "New note folder", value: "New" }]);
});

test("both: Cinder's file wins, and Obsidian's isn't read into it", () => {
  const plan = planImport({
    cinder: json({ dailyFolder: "Cinder Daily" }),
    daily: json({ folder: "Obsidian Daily", format: "DD.MM.YYYY" }),
    templates: json({ dateFormat: "D MMM" }),
    app: "not json", // not even looked at
  });
  expect(plan.source).toBe("Cinder");
  expect(plan.problems).toEqual([]);
  expect(plan.values["daily-notes.json"]).toEqual({ folder: "Cinder Daily" });
  expect(plan.values["templates.json"]).toEqual({ folder: "Templates" });
});

test("neither: nothing to import and nothing to say", () => {
  const plan = planImport(none);
  expect(plan).toEqual({ source: null, values: { "daily-notes.json": {}, "templates.json": {}, "app.json": {} }, imported: [], notImported: [], problems: [] });
  expect(importMessage(plan)).toBeNull();
  // Obsidian files that hold only defaults: found, but the notice has nothing to list.
  const defaults = planImport({ ...none, daily: json({ folder: "", format: "YYYY-MM-DD" }), app: json({ attachmentFolderPath: "/", newFileLocation: "root" }) });
  expect(defaults.source).toBe("Obsidian");
  expect(defaults.imported).toEqual([]);
  expect(importMessage(defaults)).toBeNull();
});

test("bad JSON, a non-object or a failed read stops the import, with the file named", () => {
  const bad = planImport({ ...none, cinder: "{ dailyFolder: 'x' " });
  expect(bad.source).toBeNull();
  expect(bad.problems).toEqual([".cinder/settings.json isn't valid JSON"]);
  expect(bad.values).toEqual({ "daily-notes.json": {}, "templates.json": {}, "app.json": {} });
  // A broken Cinder file doesn't fall back to Obsidian's older settings.
  expect(planImport({ ...none, cinder: "[1]", daily: json({ folder: "Daily" }) }).problems).toEqual([".cinder/settings.json isn't a settings object"]);
  // Without Cinder, one bad Obsidian file stops the others too.
  const obsidian = planImport({ ...none, daily: json({ folder: "Daily" }), app: "{", templates: { error: "not a settings file: obsidian/templates.json" } });
  expect(obsidian.problems).toEqual([".obsidian/templates.json couldn't be read (not a settings file: obsidian/templates.json)", ".obsidian/app.json isn't valid JSON"]);
  expect(obsidian.values["daily-notes.json"]).toEqual({});
  expect(importMessage(obsidian)).toEqual([
    "Grove didn't import this vault's settings:",
    "• .obsidian/templates.json couldn't be read (not a settings file: obsidian/templates.json)",
    "• .obsidian/app.json isn't valid JSON",
    "Fix the file and open the vault again to import them.",
  ]);
  // Obsidian's errors don't matter when Cinder's file is there and good.
  expect(planImport({ ...none, cinder: "{}", app: { error: "denied" } }).problems).toEqual([]);
});

test("template paths lose extra slashes, and a folder location needs a folder Grove can use", () => {
  const ok = planImport({ ...none, cinder: json({ dailyTemplate: "/Templates/Daily/" }) });
  expect(ok.values["daily-notes.json"].template).toBe("Templates/Daily");
  const refused = planImport({ ...none, app: json({ newFileLocation: "folder", newFileFolderPath: "a\nb" }) });
  expect(refused.values["app.json"]).toEqual({});
  expect(refused.notImported).toEqual(['New note folder ("a\\nb" isn\'t a value Grove takes)']);
  const missing = planImport({ ...none, app: json({ newFileLocation: "folder" }) });
  expect(missing.values["app.json"]).toEqual({});
  expect(missing.notImported).toEqual(["New notes go in (no folder was set)"]);
  // An empty folder is the vault folder, the same as Grove's default location.
  const empty = planImport({ ...none, app: json({ newFileLocation: "folder", newFileFolderPath: "/" }) });
  expect(empty.values["app.json"]).toEqual({});
  expect(empty.notImported).toEqual([]);
  expect(importMessage(empty)).toBeNull();
});

test("Cinder: embedded web pages map click and off, and always is already Grove's default", () => {
  const off = planImport({ ...none, cinder: json({ webEmbeds: "off" }) });
  expect(off.values["app.json"].webEmbeds).toBe("off");
  expect(off.imported).toContainEqual({ label: "Embedded web pages", value: "off (links only)" });
  expect(off.notImported).toEqual([]);
  const click = planImport({ ...none, cinder: json({ webEmbeds: "click" }) });
  expect(click.values["app.json"].webEmbeds).toBe("click");
  expect(click.imported).toContainEqual({ label: "Embedded web pages", value: "click to load" });
  const always = planImport({ ...none, cinder: json({ webEmbeds: "always" }) });
  expect(always.values["app.json"].webEmbeds).toBeUndefined();
  expect(always.imported.some((item) => item.label === "Embedded web pages")).toBe(false);
  const auto = planImport({ ...none, cinder: json({ webEmbeds: "auto" }) });
  expect(auto.values["app.json"].webEmbeds).toBeUndefined();
  expect(auto.notImported).toEqual([]);
  const bad = planImport({ ...none, cinder: json({ webEmbeds: "sometimes" }) });
  expect(bad.values["app.json"].webEmbeds).toBeUndefined();
  expect(bad.notImported).toEqual(['Embedded web pages ("sometimes" isn\'t a value Grove takes)']);
});

test("values Grove's schema refuses are listed, not imported", () => {
  const plan = planImport({ ...none, daily: json({ folder: "a\nb", format: "x".repeat(101) }), app: json({ newFileLocation: "nowhere" }) });
  expect(plan.values).toEqual({ "daily-notes.json": {}, "templates.json": {}, "app.json": {} });
  expect(plan.notImported).toEqual([
    'Daily notes folder ("a\\nb" isn\'t a value Grove takes)',
    `Daily note date format ("${"x".repeat(101)}" isn't a value Grove takes)`,
    'New notes go in ("nowhere" isn\'t a value Grove takes)',
  ]);
  expect(importMessage(plan)![0]).toBe("Nothing imported from Obsidian.");
});
