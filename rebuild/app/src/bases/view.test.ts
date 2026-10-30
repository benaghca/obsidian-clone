import { expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = globalThis;
});

import { baseChange, baseNeeds, docsOutsideFilter, missesPrefilter, type BaseChange } from "./view";

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
    const next = baseChange({ ...input, deferred });
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
  expect(docsOutsideFilter(["BaseTest/Fresh.md"], 'filters: \'file.hasTag("newtag")\'\n', 0, textOf, () => false)).toBe(true);
  expect(docsOutsideFilter(["BaseTest/Fresh.md"], 'filters: \'file.hasTag("newtag")\'\n', 0, () => "# Fresh\n #newtag\n", () => false)).toBe(false);
  expect(docsOutsideFilter(["BaseTest/Fresh.md"], 'filters: \'file.hasTag("newtag")\'\n', 0, textOf, () => true)).toBe(false);
});
