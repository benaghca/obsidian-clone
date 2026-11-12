// A serial property replay must finish on its own vault, or stay queued there.
// No window is opened.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { popPathHold, pushPathHold, resetHoldsForTests } from "./holdDrain";
import { sealWrites, unsealWrites } from "./saveSeal";
import { backendRoot, resetBackendRootForTests, setBackendRoot, setPageVault } from "./vaultRoot";
import { commitVaultSwitch, localSaveBus, resetVaultSwitchForTests } from "./vaultSwitch";
import {
  flushHandoff,
  handoffPending,
  queuedProp,
  resetHandoffForTests,
  submitProperty,
} from "./vaultWrite";

vi.mock("./api", () => ({
  isTauri: false,
  api: {
    readNote: vi.fn(),
    writeNote: vi.fn(),
    readConfig: vi.fn(),
    writeConfig: vi.fn(),
    writeFileBytes: vi.fn(),
    replaceFileBytes: vi.fn(),
    setProperty: vi.fn(),
    createNote: vi.fn(),
    createFolder: vi.fn(),
    deletePath: vi.fn(),
    renamePath: vi.fn(),
    linkSources: vi.fn(),
  },
}));

const store = new Map<string, string>();
const paths = ["W.md", "X.md", "Y.md", "Z.md"];

function storage(): Storage {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
    clear: () => { store.clear(); },
  } as Storage;
}

function edits() {
  return paths.map((path) => ({ key: "k", expect: null, to: { type: "text", value: path } }));
}

/** Ingress lines are `root path` for a property and `open path` for a switch. */
function deferredProperty(after?: (path: string) => void) {
  const ingress: string[] = [];
  const pending: Array<() => void> = [];
  vi.mocked(api.setProperty).mockImplementation(async (path: string) => {
    ingress.push(`${backendRoot()} ${path}`);
    await new Promise<void>((resolve) => pending.push(resolve));
    after?.(path);
    return { status: "done" } as never;
  });
  return { ingress, pending };
}

async function turn(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** Release one stalled property reply, then let the switch run. */
async function pump(pending: Array<() => void>, done: Promise<unknown>): Promise<void> {
  let finished = false;
  void done.then(() => { finished = true; }, () => { finished = true; });
  for (let step = 0; step < 40 && !finished; step++) {
    await turn();
    const next = pending.shift();
    if (next) next();
  }
  while (pending.length && !finished) {
    pending.shift()?.();
    await turn();
  }
  await done;
}

function queueFour(rows: ReturnType<typeof edits>): void {
  sealWrites();
  for (let i = 0; i < paths.length; i++) void submitProperty("/vault-a", paths[i], rows[i]);
  unsealWrites();
}

async function beginSwitch(ingress: string[]) {
  const bus = localSaveBus();
  const open = vi.fn(async (path: string) => {
    ingress.push(`open ${path}`);
    return { path, name: path };
  });
  await bus.listen("grove-save-barrier", (payload) => {
    const body = payload as { id?: string };
    void bus.emit("grove-save-ack", { id: body.id, label: "note-1", ok: true });
  });
  await bus.listen("grove-save-confirm", (payload) => {
    const body = payload as { id?: string };
    void bus.emit("grove-save-confirm-ack", { id: body.id, label: "note-1", ok: true });
  });
  const switching = commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open,
    reload: vi.fn(),
  }, { bus, others: ["note-1"], self: "main" });
  return { open, switching };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("window", {
    setTimeout: (fn: TimerHandler, ms?: number, ...rest: unknown[]) => globalThis.setTimeout(fn, ms, ...rest),
    clearTimeout: (id?: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
  });
  vi.mocked(api.writeNote).mockResolvedValue(undefined);
  vi.mocked(api.writeConfig).mockResolvedValue(undefined);
  vi.mocked(api.setProperty).mockResolvedValue({ status: "done" } as never);
  setBackendRoot("/vault-a");
  setPageVault("/vault-a");
});

afterEach(() => {
  resetVaultSwitchForTests();
  unsealWrites();
  resetHandoffForTests();
  resetHoldsForTests();
  resetBackendRootForTests();
  vi.unstubAllGlobals();
});

test("a vault switch waits until four property edits have landed on vault A", async () => {
  queueFour(edits());
  const { ingress, pending } = deferredProperty();
  const flushing = flushHandoff();
  expect(api.setProperty).toHaveBeenCalledTimes(1);
  expect(handoffPending("/vault-a")).toBe(true);
  const { open, switching } = await beginSwitch(ingress);
  await pump(pending, Promise.all([flushing, switching]));
  await expect(switching).resolves.toBe(true);
  expect(open).toHaveBeenCalledTimes(1);
  expect(ingress).toEqual([
    "/vault-a W.md",
    "/vault-a X.md",
    "/vault-a Y.md",
    "/vault-a Z.md",
    "open /vault-b",
  ]);
  expect(queuedProp("/vault-a", "Z.md")).toBeUndefined();
});

test("a path hold between property replies keeps the unsent tail on vault A", async () => {
  const rows = edits();
  queueFour(rows);
  const held = (path: string) => path === "Y.md" || path === "Z.md";
  const { ingress, pending } = deferredProperty((path) => {
    if (path === "X.md") pushPathHold(held);
  });
  const flushing = flushHandoff();
  expect(handoffPending("/vault-a")).toBe(true);
  const { open, switching } = await beginSwitch(ingress);
  await pump(pending, Promise.all([flushing, switching]));
  await expect(switching).resolves.toBe(false);
  expect(open).not.toHaveBeenCalled();
  expect(ingress).toEqual(["/vault-a W.md", "/vault-a X.md"]);
  expect(queuedProp("/vault-a", "Y.md")).toEqual(rows[2]);
  expect(queuedProp("/vault-a", "Z.md")).toEqual(rows[3]);
  popPathHold(held);
  const again = flushHandoff();
  await pump(pending, again);
  await expect(again).resolves.toBe(true);
  expect(ingress).toEqual([
    "/vault-a W.md",
    "/vault-a X.md",
    "/vault-a Y.md",
    "/vault-a Z.md",
  ]);
  expect(queuedProp("/vault-a", "Y.md")).toBeUndefined();
  expect(queuedProp("/vault-a", "Z.md")).toBeUndefined();
});
