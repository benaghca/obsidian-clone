import { describe, expect, it } from "vitest";
import { createMoveHistory, replay, reverseEdit, type MoveRecord } from "./history";
import { editProperty } from "../editor/propertyEdit";
const record: MoveRecord = { label: "move", ops: [{ path: "a.md", key: "status", before: "status: 'todo'", after: "status: doing" }] };
describe("board CAS history", () => {
  it("restores raw quotes, retries idempotently and retains a conflicting entry", async () => {
    let text = "---\nstatus: doing\n---\nbody";
    const write = async (_: string, edit: Parameters<typeof editProperty>[1], dry = false) => { const r = editProperty(text, edit); if (!dry && r.status === "done" && r.change) text = text.slice(0,r.change.from)+r.change.insert+text.slice(r.change.to); return r; };
    const history = createMoveHistory(); history.push(record);
    await history.replay(true, write); expect(text).toContain("status: 'todo'"); expect(history.sizes).toEqual({ undo: 0, redo: 1 });
    await history.replay(false, write); expect(text).toContain("status: doing");
    text = text.replace("doing", "external"); await expect(history.replay(true, write)).rejects.toThrow("changed since"); expect(history.sizes.undo).toBe(1);
    text = text.replace("external", "'todo'"); await history.replay(true, write); expect(history.sizes.redo).toBe(1);
  });
  it("serialises work, bounds history to 100 and clears redo for a new move", async () => {
    const h=createMoveHistory(), order:number[]=[];
    await Promise.all([h.queue(async()=>{await new Promise(r=>setTimeout(r,5));order.push(1);}),h.queue(async()=>{order.push(2);})]); expect(order).toEqual([1,2]);
    for(let i=0;i<105;i++)h.push(record);expect(h.sizes.undo).toBe(100);
    await h.replay(true,async()=>({status:"unchanged",before:null,after:null,props:{props:[],lines:[]},mtime_ms:0}));h.push(record);expect(h.sizes.redo).toBe(0);
  });
  it("preflights the entire batch and compensates in reverse without overwriting conflicts", async () => {
    const batch={label:"batch",ops:[record.ops[0],{...record.ops[0],path:"b.md"}]};
    const calls:string[]=[];
    await expect(replay(batch,false,async(path,edit,dry)=>{calls.push(`${path}:${dry?"dry":edit.expect}`);if(path==="b.md"&&!dry)return {status:"conflict",current:"status: external"};return {status:"done",before:edit.expect,after:"status: doing",props:{props:[],lines:[]},mtime_ms:0};})).rejects.toThrow("changed since");
    expect(calls).toEqual(["a.md:dry","b.md:dry","a.md:status: 'todo'","b.md:status: 'todo'","a.md:status: doing"]);
    expect(reverseEdit({path:"x",key:"x",before:null,after:"x: a"},true).to).toBeNull();
  });
  it("does not preview/write when any preflight fails and names uncompensated notes", async()=>{
    let preview=false,writes=0;
    await expect(replay(record,true,async()=>({status:"conflict",current:"changed"}),()=>{preview=true;})).rejects.toThrow();expect(preview).toBe(false);
    const batch={label:"batch",ops:[record.ops[0],{...record.ops[0],path:"b.md"}]};
    await expect(replay(batch,false,async(_path,edit,dry)=>{if(!dry&&++writes>1)return {status:"conflict",current:"other"};return {status:"done",before:edit.expect,after:null,props:{props:[],lines:[]},mtime_ms:0};})).rejects.toThrow("Left changed or unconfirmed: a.md");
  });
});
it("compensates a transport error after an uncertain rename with CAS",async()=>{
 let text="---\nstatus: 'todo'\n---\nbody", first=true;
 await expect(replay(record,false,async(_path,edit,dry)=>{const r=editProperty(text,edit);if(!dry&&r.status==="done"&&r.change){text=text.slice(0,r.change.from)+r.change.insert+text.slice(r.change.to);if(first){first=false;throw Error("sync failed after rename");}}return r;})).rejects.toThrow("sync failed");
 expect(text).toBe("---\nstatus: 'todo'\n---\nbody");
});
