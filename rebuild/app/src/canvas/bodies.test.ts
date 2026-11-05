import { afterEach, expect, test, vi } from "vitest";
vi.mock("./navigation",()=>({titleBand:()=>undefined}));
import { canvasBodies } from "./bodies";
import { canvasWork } from "./work";
import type { CanvasViewport } from "./navigation";
import type { CanvasNode } from "./model";
afterEach(()=>vi.unstubAllGlobals());
// Minimal elements keep these scheduling/state regressions independent of the
// browser; the headless suite verifies real layout, rendering and pointer input.
class ElementStub {
  classes=new Set<string>();attrs=new Map<string,string>();style={display:""};children:ElementStub[]=[];parentElement:ElementStub|null=null;
  classList={add:(v:string)=>this.classes.add(v),contains:(v:string)=>this.classes.has(v),toggle:(v:string,on:boolean)=>on?this.classes.add(v):this.classes.delete(v)};
  matches(){return false;}querySelector(){return null;}
  getAttribute(k:string){return this.attrs.get(k)??null;}setAttribute(k:string,v:string){this.attrs.set(k,v);}
  append(e:ElementStub){e.remove();this.children.push(e);e.parentElement=this;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);this.parentElement=null;}
}
function setup(count=2){
  let id=0;const frames=new Map<number,FrameRequestCallback>();vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{frames.set(++id,fn);return id;});vi.stubGlobal("cancelAnimationFrame",(i:number)=>frames.delete(i));
  const nodes:CanvasNode[]=Array.from({length:count},(_,i)=>({id:String(i),type:"text",x:i*1000,y:0,width:100,height:100}));
  const view:CanvasViewport={x:0,y:0,width:250,height:200,focusX:0,focusY:0,band:0,titles:false,scale:1};
  const work=canvasWork(),manager=canvasBodies(nodes,work,()=>view);let live=0;
  const cards=nodes.map(node=>{const el=new ElementStub(),content=new ElementStub();let ready=false;manager.add(node,el as unknown as HTMLElement,{element:content as unknown as HTMLElement,ensure(){if(!ready){live++;ready=true;}},ready:()=>ready,release(){if(ready){ready=false;live--;}}});return{el,content};});
  work.resume();const flush=()=>{while(frames.size){const[k,fn]=frames.entries().next().value!;frames.delete(k);fn(performance.now());}};
  return{view,manager,cards,flush,live:()=>live,nodes};
}
test("a superseded settle still culls every previously shown card",()=>{
  const{view,manager,cards,flush}=setup();manager.update();flush();view.x=1000;manager.update();manager.update();flush();
  expect(cards[0].el.classes.has("is-culled")).toBe(true);expect(cards[1].el.classes.has("is-culled")).toBe(false);
  view.x=0;manager.update();flush();expect(cards[0].el.classes.has("is-culled")).toBe(false);expect(cards[1].el.classes.has("is-culled")).toBe(true);manager.dispose();
});
test("title mode detaches bodies without rebuilding their cached rendering",()=>{
  const{view,manager,cards,flush,live}=setup();manager.update();flush();expect(cards[0].content.parentElement).toBe(cards[0].el);expect(live()).toBe(1);
  view.titles=true;manager.update();flush();expect(cards[0].content.parentElement).toBeNull();expect(live()).toBe(1);manager.dispose();expect(live()).toBe(0);
});
test("presentation keeps an off-screen body out of title mode",()=>{
  const{view,manager,cards,flush}=setup();view.titles=true;manager.update();flush();
  expect(cards[1].content.parentElement).toBeNull();
  manager.present(["1"]);
  expect(cards[1].el.classes.has("is-culled")).toBe(false);
  expect(cards[1].el.classes.has("is-title-mode")).toBe(false);
  expect(cards[1].content.parentElement).toBe(cards[1].el);
  manager.update();flush();
  expect(cards[1].content.parentElement).toBe(cards[1].el);
  expect(cards[1].el.classes.has("is-title-mode")).toBe(false);
  manager.present([]);manager.update();flush();
  expect(cards[1].el.classes.has("is-culled")).toBe(true);
  manager.dispose();
});
test("a pinned slide stays wanted in title mode and survives the body cache",()=>{
  const{view,manager,cards,flush,nodes}=setup(400);
  manager.present(["0"]);
  for(let i=0;i<400;i++){view.x=i*1000;manager.update();flush();}
  expect(manager.stats().retained).toBe(300);
  expect(cards[0].content.parentElement).toBe(cards[0].el);
  view.titles=true;view.x=399*1000;manager.update();flush();
  expect(manager.wanted(nodes[0])).toBe(true);
  expect(cards[0].content.parentElement).toBe(cards[0].el);
  expect(cards[0].el.classes.has("is-culled")).toBe(false);
  expect(cards[0].el.classes.has("is-title-mode")).toBe(false);
  manager.present([]);manager.update();flush();
  expect(manager.wanted(nodes[0])).toBe(false);
  expect(cards[0].content.parentElement).toBeNull();
  expect(cards[0].el.classes.has("is-culled")).toBe(true);
  manager.dispose();
});
test("the LRU releases old bodies and disposal releases the remaining cache",()=>{
  const{view,manager,flush,live}=setup(400);
  for(let i=0;i<400;i++){view.x=i*1000;manager.update();flush();}
  expect(manager.stats().retained).toBe(300);expect(live()).toBe(300);manager.dispose();expect(live()).toBe(0);
});
test("at most six link cards keep a frame, and title mode releases them",()=>{
  let id=0;const frames=new Map<number,FrameRequestCallback>();vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{frames.set(++id,fn);return id;});vi.stubGlobal("cancelAnimationFrame",(i:number)=>frames.delete(i));
  const nodes:CanvasNode[]=Array.from({length:8},(_,i)=>({id:String(i),type:"link",x:i*30,y:0,width:200,height:120,url:"local"}));
  const view:CanvasViewport={x:0,y:0,width:1000,height:800,focusX:400,focusY:60,band:0,titles:false,scale:1};
  const work=canvasWork(),manager=canvasBodies(nodes,work,()=>view);
  const live=new Set<string>();let peak=0;
  for(const node of nodes){
    const el=new ElementStub(),content=new ElementStub();
    manager.add(node,el as unknown as HTMLElement,{
      element:content as unknown as HTMLElement,frame:true,wantsFrame:()=>true,
      ensure(){if(manager.slotted(node.id)&&!live.has(node.id)){live.add(node.id);peak=Math.max(peak,live.size);}},
      ready:()=>true,
      release(){live.delete(node.id);},
    });
  }
  work.resume();const flush=()=>{while(frames.size){const[k,fn]=frames.entries().next().value!;frames.delete(k);fn(performance.now());}};
  manager.update();flush();
  expect(manager.stats().frames).toBe(6);expect(live.size).toBe(6);expect(peak).toBe(6);
  const unslotted=nodes.map(n=>n.id).find(id=>!live.has(id))!;
  manager.recheck(unslotted);flush();
  expect(live.has(unslotted)).toBe(true);expect(live.size).toBe(6);expect(peak).toBe(6);
  view.titles=true;manager.update();
  expect(manager.stats().frames).toBe(0);expect(live.size).toBe(0);
  flush();
  view.titles=false;manager.recheck("0");flush();
  expect(live.has("0")).toBe(true);expect(live.size).toBe(6);expect(peak).toBe(6);
  manager.dispose();
});
test("a pinned link slide shows off screen without a frame, then takes a slot once it fits",()=>{
  let id=0;const frames=new Map<number,FrameRequestCallback>();vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{frames.set(++id,fn);return id;});vi.stubGlobal("cancelAnimationFrame",(i:number)=>frames.delete(i));
  const nodes:CanvasNode[]=[
    ...Array.from({length:8},(_,i)=>({id:String(i),type:"link" as const,x:i*30,y:0,width:200,height:120,url:"local"})),
    {id:"far",type:"link",x:5000,y:0,width:200,height:120,url:"local"},
  ];
  const view:CanvasViewport={x:0,y:0,width:1000,height:800,focusX:400,focusY:60,band:0,titles:false,scale:1};
  const work=canvasWork(),manager=canvasBodies(nodes,work,()=>view);
  const live=new Set<string>();const cards=new Map<string,ElementStub>();
  for(const node of nodes){
    const el=new ElementStub(),content=new ElementStub();
    cards.set(node.id,el);
    manager.add(node,el as unknown as HTMLElement,{
      element:content as unknown as HTMLElement,frame:true,wantsFrame:()=>true,
      ensure(){if(manager.slotted(node.id)&&!live.has(node.id))live.add(node.id);},
      ready:()=>true,
      release(){live.delete(node.id);},
    });
    (el as unknown as {content:ElementStub}).content=content;
  }
  work.resume();const flush=()=>{while(frames.size){const[k,fn]=frames.entries().next().value!;frames.delete(k);fn(performance.now());}};
  const far=cards.get("far")!,content=(far as unknown as {content:ElementStub}).content;
  manager.update();flush();
  expect(manager.stats().frames).toBe(6);expect(live.has("far")).toBe(false);
  manager.present(["far"]);
  expect(far.classes.has("is-culled")).toBe(false);
  expect(far.classes.has("is-title-mode")).toBe(false);
  expect(content.parentElement).toBe(far);
  expect(manager.stats().frames).toBe(6);expect(live.has("far")).toBe(false);
  manager.update();flush();
  expect(manager.stats().frames).toBe(6);expect(live.has("far")).toBe(false);expect(content.parentElement).toBe(far);
  view.titles=true;manager.update();
  expect(manager.stats().frames).toBe(0);expect(live.size).toBe(0);
  expect(far.classes.has("is-title-mode")).toBe(false);expect(content.parentElement).toBe(far);
  flush();
  view.titles=false;view.x=4900;view.focusX=5100;view.width=400;
  manager.update();flush();
  expect(live.has("far")).toBe(true);expect(manager.stats().frames).toBe(1);expect(live.size).toBe(1);
  manager.present([]);
  view.x=0;view.focusX=400;view.width=1000;
  manager.update();flush();
  expect(manager.wanted(nodes[8])).toBe(false);
  expect(content.parentElement).toBeNull();
  expect(far.classes.has("is-culled")).toBe(true);
  manager.dispose();expect(live.size).toBe(0);
});
