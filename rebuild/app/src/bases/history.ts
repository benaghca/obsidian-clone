// Per-tab, per-base/view CAS history. The queue also serialises quick consecutive moves.
import type { EditResult, PropertyEdit } from "../editor/propertyEdit";
import type { Tab } from "../tabs";
import type { Yaml } from "./yaml";
export interface MoveOp { path: string; key: string; before: string | null; after: string | null }
export interface MoveRecord { label: string; ops: MoveOp[]; order?: { index: number; view: string; before: Yaml | undefined; after: Yaml | undefined } }
export type WriteProperty = (path: string, edit: PropertyEdit, dryRun?: boolean) => Promise<EditResult>;
type Preview = (ops: { op: MoveOp; result: EditResult }[]) => void;
type ApplyOrder = (record: MoveRecord, undo: boolean) => Promise<void>;
export function reverseEdit(op: MoveOp, undo: boolean): PropertyEdit {
  const expect = undo ? op.after : op.before, lines = undo ? op.before : op.after;
  return { key: op.key, expect, to: lines === null ? null : { lines } };
}
function success(result: EditResult, path: string) {
  if (result.status === "conflict") throw Error(`${path} changed since: ${result.current ?? "No value"}`);
  if (result.status === "refused") throw Error(`${path}: ${result.reason}`);
}
/** Validate the entire batch first; compensate completed writes if a later CAS fails. */
export async function replay(record: MoveRecord, undo: boolean, write: WriteProperty, preview?: Preview, order?: ApplyOrder) {
  if (record.order) { if (!order) throw Error("Open the board to restore column order"); return order(record, undo); }
  const ops = undo ? [...record.ops].reverse() : record.ops;
  const prepared = [];
  for (const op of ops) { const result = await write(op.path, reverseEdit(op, undo), true); success(result, op.path); prepared.push({ op, result }); }
  preview?.(prepared);
  const done: MoveOp[] = [];
  try {
    for (const op of ops) { const result = await write(op.path, reverseEdit(op, undo)); success(result, op.path); if (result.status === "done") done.push(op); }
  } catch (error) {
    const left: string[] = [];
    for (const op of done.reverse()) try { success(await write(op.path, reverseEdit(op, !undo)), op.path); } catch { left.push(op.path); }
    throw Error(`${String(error)}${left.length ? ` · Left changed: ${left.join(", ")}` : ""}`);
  }
}
export function createMoveHistory() {
  const undo: MoveRecord[] = [], redo: MoveRecord[] = [];
  let tail = Promise.resolve();
  const queue = <T>(run: () => Promise<T>): Promise<T> => { const next = tail.then(run); tail = next.then(() => {}, () => {}); return next; };
  return {
    queue,
    push(record: MoveRecord) { undo.push(record); if (undo.length > 100) undo.shift(); redo.length = 0; },
    async replay(back: boolean, write: WriteProperty, preview?: Preview, order?: ApplyOrder) {
      return queue(async () => {
        const from = back ? undo : redo, to = back ? redo : undo, record = from.at(-1);
        if (!record) return null;
        await replay(record, back, write, preview, order); from.pop(); to.push(record); return record;
      });
    },
    get sizes() { return { undo: undo.length, redo: redo.length }; },
  };
}
const histories = new WeakMap<Tab, Map<string, ReturnType<typeof createMoveHistory>>>();
export function moveHistory(tab: Tab, scope: string) {
  let scopes = histories.get(tab); if (!scopes) histories.set(tab, scopes = new Map());
  let history = scopes.get(scope); if (!history) scopes.set(scope, history = createMoveHistory());
  return history;
}
