import { expect, test } from "vitest";
import { clippedCubic, clippedEdge } from "./edgeClip";
import { edgeCurve } from "./model";
const at=(p:number[],c:number[],d:number[],q:number[],t:number)=>[0,1].map(i=>p[i]*(1-t)**3+3*c[i]*(1-t)**2*t+3*d[i]*(1-t)*t*t+q[i]*t**3);
test("clipping keeps exact cubic geometry and every in-view parameter interval",()=>{
 const p=[0,0],c=[5000,-5000],d=[5000,5000],q=[10000,0],box={x:4900,y:-100,width:200,height:200};
 const pieces=clippedCubic(p,c,d,q,box);expect(pieces.length).toBeGreaterThan(0);expect(pieces.length).toBeLessThanOrEqual(3);
 for(const piece of pieces)for(const t of [.2,.5,.8]) {
  const actual=at(piece.p,piece.c,piece.d,piece.q,t),expected=at(p,c,d,q,piece.from+(piece.to-piece.from)*t);
  expect(actual[0]).toBeCloseTo(expected[0],8);expect(actual[1]).toBeCloseTo(expected[1],8);
 }
 for(let i=0;i<=1000;i++){const t=i/1000,a=at(p,c,d,q,t);if(a[0]>=box.x&&a[0]<=box.x+box.width&&a[1]>=box.y&&a[1]<=box.y+box.height)expect(pieces.some(s=>s.from<=t&&s.to>=t)).toBe(true);}
 expect(clippedCubic(p,c,d,q,{x:-1000,y:-1000,width:10,height:10})).toEqual([]);
});
test("an entirely visible edge keeps the original path and endpoint geometry",()=>{
 const a={id:"a",type:"text" as const,x:0,y:0,width:200,height:100},b={...a,id:"b",x:400};
 const curve=edgeCurve(a,b,{id:"e",fromNode:"a",toNode:"b"});expect(clippedEdge(curve,{x:-1000,y:-1000,width:4000,height:4000})).toBe(curve.path);
});
test("a crossing edge survives even with both endpoints far outside the viewport",()=>{
 const a={id:"a",type:"text" as const,x:0,y:0,width:200,height:100},b={...a,id:"b",x:10000};
 const curve=edgeCurve(a,b,{id:"e",fromNode:"a",toNode:"b"});const path=clippedEdge(curve,{x:4000,y:0,width:1000,height:200});
 expect(path).toContain("C");expect(path).not.toContain("M200,50");expect(clippedEdge(curve,{x:4000,y:1000,width:100,height:100})).toBe("");
});
