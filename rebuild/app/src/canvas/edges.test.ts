import { afterEach, expect, test, vi } from "vitest";
import { canvasEdges } from "./edges";
import { canvasWork } from "./work";
import type { CanvasNode } from "./model";
afterEach(() => vi.unstubAllGlobals());
class ElementStub {
  attrs = new Map<string,string>(); classes = new Set<string>(); children: ElementStub[] = []; parentElement: ElementStub | null = null; style = {}; textContent = "";
  get parentNode() { return this.parentElement; }
  set className(value: string) { this.classes = new Set(value.split(" ")); }
  classList = { add: (v: string) => this.classes.add(v), contains: (v: string) => this.classes.has(v), toggle: (v: string, on: boolean) => on ? this.classes.add(v) : this.classes.delete(v) };
  setAttribute(k: string,v: string) { this.attrs.set(k,v); if(k === "class") this.className = v; }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  append(...els: ElementStub[]) { for (const el of els) { el.remove(); this.children.push(el); el.parentElement = this; } }
  remove() { if(this.parentElement) this.parentElement.children = this.parentElement.children.filter(el=>el!==this); this.parentElement = null; }
}
function setup(count = 1) {
  let id = 0; const frames = new Map<number,FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{frames.set(++id,fn);return id;});
  vi.stubGlobal("cancelAnimationFrame",(id:number)=>frames.delete(id));
  vi.stubGlobal("document",{createElementNS:()=>new ElementStub(),createElement:()=>new ElementStub()});
  const world = new ElementStub(), svg = new ElementStub(), work = canvasWork(); world.append(svg);
  const a:CanvasNode={id:"a",type:"text",x:0,y:0,width:200,height:100},b={...a,id:"b",x:400};
  const edges=Array.from({length:count},(_,i)=>({id:String(i),fromNode:"a",toNode:"b",toEnd:"none" as const}));
  const drawing=canvasEdges(world as unknown as HTMLElement,svg as unknown as SVGSVGElement,edges,new Map([[a.id,a],[b.id,b]]),work,()=>"red");
  work.resume();const flush=()=>{while(frames.size){const [id,fn]=frames.entries().next().value!;frames.delete(id);fn(performance.now());}};
  return {drawing,work,svg,a,flush};
}
test("a title batch follows geometry immediately and full-mode ends are selection-only",()=>{
  const {drawing,svg,a,flush}=setup();drawing.mode(true,-4);flush();
  const batch=svg.children.find(el=>el.classes.has("canvas-edge-batch"))!,before=batch.getAttribute("d");
  a.x+=100;drawing.changed(new Set(["a"]));expect(batch.getAttribute("d")).not.toBe(before);expect(drawing.get("0")).toBeUndefined();
  drawing.mode(false,0);flush();expect(drawing.get("0")!.ends).toHaveLength(0);
  drawing.select(new Set(["0"]));expect(drawing.get("0")!.ends).toHaveLength(2);
  drawing.mode(true,-4);flush();expect(drawing.get("0")).toBeUndefined();drawing.dispose();
});
test("a mode reversal cancels obsolete weighted construction rather than delaying the latest view",()=>{
  const {drawing,work,svg,flush}=setup(4000);drawing.mode(false,0);expect(work.stats().pending).toBeGreaterThan(200);
  drawing.mode(true,-4);expect(work.stats().pending).toBeLessThan(1100);flush();
  expect(svg.children.filter(el=>el.classes.has("canvas-edge-batch"))).toHaveLength(16);expect(drawing.get("0")).toBeUndefined();drawing.dispose();
});
