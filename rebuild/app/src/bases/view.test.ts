import { expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = globalThis;
});

import { baseChange, baseNeeds, docsOutsideFilter, missesPrefilter, readsChanged, type BaseChange } from "./view";

const tasks = `filters:
  and:
    - file.inFolder("BaseTest")
    - 'status != "done"'
views:
  - type: table
    filters:
      and:
        - 'file.hasTag("work") && file.inFolder("BaseTest")'
`;

function clock() {
  let now = 0;
  let updates = 0;
  let due: number | null = null;
  let deferred = false;
  const fire = (input: Omit<BaseChange, "deferred">) => {
    const next = baseChange({ ...input, deferred, pending: due !== null });
    deferred = next.deferred;
    if (next.delay !== null) due = now + next.delay;
    else if (next.clear) due = null;
  };
  const advance = (ms: number) => {
    now += ms;
    if (due !== null && now >= due) { due = null; updates++; }
  };
  return { fire, advance, get updates() { return updates; }, get pending() { return due !== null; }, get deferred() { return deferred; } };
}

it("typing in a note rebuilds the base once after 300ms of quiet, not on each keystroke", () => {
  const run = clock();
  const edit: Omit<BaseChange, "deferred"> = { change: "doc", shown: true, changed: ["BaseTest/Task A.md"], outside: false };
  for (let i = 0; i < 5; i++) {
    run.fire(edit);
    run.advance(40);
  }
  expect(run.updates).toBe(0);
  expect(run.pending).toBe(true);
  run.advance(259);
  expect(run.updates).toBe(0);
  run.advance(1);
  expect(run.updates).toBe(1);
  run.advance(300);
  expect(run.updates).toBe(1);
});

it("keeps the short delay for file and link changes, and defers a hidden base until it is shown", () => {
  const files = clock();
  files.fire({ change: "files", shown: true, changed: null, outside: false });
  files.advance(19);
  expect(files.updates).toBe(0);
  files.advance(1);
  expect(files.updates).toBe(1);

  const hidden = clock();
  hidden.fire({ change: "doc", shown: true, changed: ["BaseTest/Task A.md"], outside: false });
  hidden.fire({ change: "doc", shown: false, changed: null, outside: false });
  expect(hidden.deferred).toBe(true);
  hidden.advance(1000);
  expect(hidden.updates).toBe(0);
  hidden.fire({ change: "show", shown: true, changed: null, outside: false });
  hidden.advance(19);
  expect(hidden.updates).toBe(0);
  hidden.advance(1);
  expect(hidden.updates).toBe(1);
  expect(hidden.deferred).toBe(false);
});

it("skips a doc change outside the folder or tag pre-filter and still rebuilds when the tag arrives", () => {
  const outside = clock();
  outside.fire({ change: "doc", shown: true, changed: ["Other/Note.md"], outside: true });
  outside.advance(1000);
  expect(outside.updates).toBe(0);
  expect(outside.pending).toBe(false);

  expect(baseNeeds(tasks, 0)).toEqual({ folders: ["BaseTest", "BaseTest"], tags: ["work"] });
  expect(baseNeeds('filters: \'file.inFolder("Perf") && status != "done"\'\n', 0)).toEqual({ folders: ["Perf"], tags: [] });
  expect(missesPrefilter("Other/Note.md", { folders: ["BaseTest"], tags: [] }, "x", false)).toBe(true);
  expect(missesPrefilter("BaseTest/Task A.md", { folders: ["BaseTest"], tags: [] }, "x", false)).toBe(false);
  const textOf = (path: string) => path.endsWith("Fresh.md") ? "# Fresh\n" : null;
  expect(docsOutsideFilter(["Other/Note.md"], tasks, 0, textOf, () => false)).toBe(true);
  expect(docsOutsideFilter(["BaseTest/Fresh.md"], 'filters: \'file.hasTag("newtag")\'\n', 0, textOf, () => false, textOf)).toBe(true);
  expect(docsOutsideFilter(["BaseTest/Fresh.md"], 'filters: \'file.hasTag("newtag")\'\n', 0, () => "# Fresh\n #newtag\n", () => false)).toBe(false);
  expect(docsOutsideFilter(["BaseTest/Fresh.md"], 'filters: \'file.hasTag("newtag")\'\n', 0, textOf, () => true)).toBe(false);
});

it.each([
  'file.inFolder("A") && status == "open" || status == "done"',
  'status == "done" || file.hasTag("work") && file.inFolder("A")',
  'file.inFolder("A") || file.inFolder("B")',
])("does not infer mandatory facts across a top-level OR: %s", filter => {
  const source = `filters: ${JSON.stringify(filter)}\n`;
  expect(baseNeeds(source, 0)).toEqual({ folders: [], tags: [] });
  expect(docsOutsideFilter(["B/Task.md"], source, 0, () => "# work", () => false)).toBe(false);
});

it("keeps safe AND siblings, quoted operators and escaped single quotes intact", () => {
  const source = (filter: string) => `filters: ${JSON.stringify(filter)}\n`;
  expect(baseNeeds(source('file.inFolder("A") && (status == "open" || status == "done")'), 0)).toEqual({ folders: ["A"], tags: [] });
  expect(baseNeeds(source("file.inFolder('A||B') && file.hasTag('work')"), 0)).toEqual({ folders: ["A||B"], tags: ["work"] });
  expect(baseNeeds(source(String.raw`file.inFolder('It\'s') && file.hasTag('work')`), 0)).toEqual({ folders: ["It's"], tags: ["work"] });
  expect(baseNeeds('filters: \'file.inFolder("A") && (true\'\n', 0)).toEqual({ folders: [], tags: [] });
});

it("does not skip tag removals beyond a result limit or an unknown previous state", () => {
  const source = 'filters: \'file.hasTag("work")\'\nviews:\n  - limit: 1\n';
  const absent = () => "# Task\n", present = () => "# Task #work/project\n";
  expect(docsOutsideFilter(["Task.md"], source, 0, absent, () => false, present)).toBe(false);
  expect(docsOutsideFilter(["Task.md"], source, 0, absent, () => false)).toBe(false);
  expect(docsOutsideFilter(["Task.md"], source, 0, absent, () => false, absent)).toBe(true);
  expect(docsOutsideFilter(["Task.md"], source, 0, present, () => false, absent)).toBe(false);
  expect(docsOutsideFilter(["Other/Task.md"], 'filters: \'file.inFolder("A")\'\n', 0, () => null, () => false)).toBe(true);
  expect(docsOutsideFilter(["Task.md"], "filters: [bad", 0, absent, () => false)).toBe(false);
});

it("cancels a pending quiet-period rebuild when the tab hides, without needing another edit", () => {
  const run = clock();
  run.fire({ change: "doc", shown: true, changed: ["A.md"], outside: false });
  run.fire({ change: "tabs", shown: false, changed: null, outside: false });
  run.advance(1000);
  expect(run.updates).toBe(0);
  expect(run.deferred).toBe(true);
  run.fire({ change: "pane", shown: true, changed: null, outside: false });
  run.advance(20);
  expect(run.updates).toBe(1);
});

it("retains pending work across an outside edit and reveals deferred work on an outside edit", () => {
  const run = clock();
  run.fire({ change: "doc", shown: true, changed: ["A.md"], outside: false });
  run.advance(100);
  run.fire({ change: "doc", shown: true, changed: ["Other.md"], outside: true });
  run.advance(200);
  expect(run.updates).toBe(1);
  expect(baseChange({ change: "doc", shown: true, deferred: true, changed: ["Other.md"], outside: true })).toEqual({ deferred: false, delay: 20, clear: false });
});

it("rebuilds an embedded base that reads `this` when its note changes, even outside its folder", () => {
  const source = `filters:\n  and:\n    - file.inFolder("BaseTest")\n    - 'status == this.status'\n`;
  expect(docsOutsideFilter(["Host.md"], source, 0, () => "", () => false)).toBe(true);
  expect(readsChanged(source, "Host.md", ["Host.md"])).toBe(true);
  expect(readsChanged(source, "Host.md", ["Other.md"])).toBe(false);
  expect(readsChanged(source, null, ["Host.md"])).toBe(false);
  expect(readsChanged(tasks, "Host.md", ["Host.md"])).toBe(false);
});
