import { expect, it, vi } from "vitest";
vi.mock("../api", () => ({api: {setProperty: vi.fn()}}));
import { inspectDocument, propertyMove, readOnlyReason, writeProperty } from "./move";
import { editProperty } from "../editor/propertyEdit";
import { api } from "../api";
import type { Workspace } from "../workspace";
it("infers the note type, keeps list/quote style, empties instead of removing, and refuses unsafe values",()=>{
 const text="\uFEFF---\r\nstatus: 'todo'\r\ntags: [a, b]\r\nkeep: yes\r\n---\r\nbody";
 const info=inspectDocument(text,"status");
 expect(propertyMove("status",info,"doing").expect).toBe("status: 'todo'");
 const list=propertyMove("tags",info,["b","c"]);expect(editProperty(text,list)).toMatchObject({status:"done",after:"tags: [b, c]"});
 expect(editProperty(text,propertyMove("status",info,null))).toMatchObject({status:"done",after:"status:"});
 expect(editProperty(text,propertyMove("tags",info,null))).toMatchObject({status:"done",after:"tags: []"});
 expect(()=>propertyMove("status",info,"nope","number")).toThrow();
 expect(propertyMove("due",{props:[],lines:[]},"2026-11-03").to).toMatchObject({type:"date"});
 expect(()=>inspectDocument("---\nx: 1\nx: 2\n---","x")).toThrow();
 expect(readOnlyReason("this.status")).toContain("can't be moved");expect(readOnlyReason("file.folder")).toContain("can't be moved");expect(readOnlyReason("formula.f")).toContain("can't be moved");
});
it("uses one editor transaction for unsaved loaded text and never calls the disk writer",async()=>{
 const text="---\nstatus: todo\n---\nunsaved body", change=vi.fn(), disk=vi.spyOn(api,"setProperty");
 const ws={editors:{isLoaded:()=>true,doc:()=>({toString:()=>text}),change},vault:{written:vi.fn()}} as unknown as Workspace;
 const edit=propertyMove("status",inspectDocument(text,"status"),"doing");
 expect((await writeProperty(ws,"A.md",edit,true)).status).toBe("done");expect(change).not.toHaveBeenCalled();
 expect((await writeProperty(ws,"A.md",edit)).status).toBe("done");expect(change).toHaveBeenCalledWith("A.md",expect.objectContaining({userEvent:"input.property",scrollIntoView:false}));expect(disk).not.toHaveBeenCalled();disk.mockRestore();
});
it("switches to the editor if the note loads while the native API is being resolved",async()=>{
 const text="---\nstatus: todo\n---\nunsaved",change=vi.fn(),disk=vi.spyOn(api,"setProperty");
 const ws={editors:{isLoaded:vi.fn().mockReturnValueOnce(false).mockReturnValue(true),doc:()=>({toString:()=>text}),change},vault:{written:vi.fn()}} as unknown as Workspace;
 expect((await writeProperty(ws,"A.md",propertyMove("status",inspectDocument(text,"status"),"doing"))).status).toBe("done");expect(change).toHaveBeenCalledTimes(1);expect(disk).not.toHaveBeenCalled();disk.mockRestore();
});
