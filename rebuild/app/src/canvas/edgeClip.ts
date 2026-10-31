// Clip long off-screen curves before handing them to SVG/Skia. An SVG viewport
// alone clips pixels, but can still rasterize huge original paths on every tile.
import type { Box } from "./spatial";
import type { edgeCurve } from "./model";
type Point = number[];
export interface CubicPiece { p: Point; c: Point; d: Point; q: Point; from: number; to: number }
const inside = (p: Point, b: Box) => p[0] >= b.x && p[0] <= b.x + b.width && p[1] >= b.y && p[1] <= b.y + b.height;
const mix = (a: Point, b: Point, t: number) => a.map((v, i) => v + (b[i] - v) * t);
function split(p: Point, c: Point, d: Point, q: Point, t: number) {
  const a = mix(p,c,t), b = mix(c,d,t), e = mix(d,q,t), f = mix(a,b,t), g = mix(b,e,t), h = mix(f,g,t);
  return [[p,a,f,h],[h,g,e,q]];
}
// Split at actual boundary intersections. Recursive clipping produces many tiny
// adjacent cubics, multiplying SVG stroke/raster work without changing geometry.
function roots(p: number, c: number, d: number, q: number, boundary: number) {
  const a=-p+3*c-3*d+q,b=3*p-6*c+3*d,k=-3*p+3*c;
  const value=(t:number)=>((a*t+b)*t+k)*t+p-boundary;
  const stops=[0,1], discriminant=b*b-3*a*k;
  if (Math.abs(a)<1e-10) { if(Math.abs(b)>1e-10)stops.push(-k/(2*b)); }
  else if(discriminant>=0)for(const sign of [-1,1])stops.push((-b+sign*Math.sqrt(discriminant))/(3*a));
  const ordered=stops.filter(t=>t>=0&&t<=1).sort((x,y)=>x-y), result:number[]=[];
  for(let i=0;i<ordered.length;i++) {
    let lo=ordered[i],hi=ordered[i+1];
    if(Math.abs(value(lo))<1e-8)result.push(lo);
    if(hi===undefined||value(lo)*value(hi)>=0)continue;
    const positive=value(lo)>0;
    for(let n=0;n<48;n++){const t=(lo+hi)/2;if((value(t)>0)===positive)lo=t;else hi=t;}
    result.push((lo+hi)/2);
  }
  return result;
}
/** De Casteljau subdivision retains exact cubic pieces, not a polyline. */
export function clippedCubic(p: Point, c: Point, d: Point, q: Point, box: Box): CubicPiece[] {
  const points=[p,c,d,q];
  if(points.every(p=>inside(p,box)))return [{p,c,d,q,from:0,to:1}];
  if([0,1].some(i=>Math.max(...points.map(p=>p[i]))<(i?box.y:box.x)||Math.min(...points.map(p=>p[i]))>(i?box.y+box.height:box.x+box.width)))return [];
  const cuts=[0,1,...roots(p[0],c[0],d[0],q[0],box.x),...roots(p[0],c[0],d[0],q[0],box.x+box.width),...roots(p[1],c[1],d[1],q[1],box.y),...roots(p[1],c[1],d[1],q[1],box.y+box.height)].sort((a,b)=>a-b).filter((t,i,a)=>!i||t-a[i-1]>1e-10);
  const pieces:CubicPiece[]=[];
  for(let i=0;i<cuts.length-1;i++) {
    const from=cuts[i],to=cuts[i+1], t=(from+to)/2;
    if(!inside([0,1].map(i=>p[i]*(1-t)**3+3*c[i]*(1-t)**2*t+3*d[i]*(1-t)*t*t+q[i]*t**3),box))continue;
    const left=split(p,c,d,q,to)[0],part=from?split(...left as [Point,Point,Point,Point],from/to)[1]:left;
    pieces.push({p:part[0],c:part[1],d:part[2],q:part[3],from,to});
  }
  return pieces;
}
function clippedLine(a: Point, b: Point, box: Box): string {
  const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
  for(const[p,q]of[[-dx,a[0]-box.x],[dx,box.x+box.width-a[0]],[-dy,a[1]-box.y],[dy,box.y+box.height-a[1]]]) {
    if(p===0){if(q<0)return "";}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);
  }
  return lo>hi?"":`M${a[0]+lo*dx},${a[1]+lo*dy} L${a[0]+hi*dx},${a[1]+hi*dy}`;
}
export function clippedEdge(curve: ReturnType<typeof edgeCurve>, box: Box): string {
  if([curve.p,curve.start,curve.c,curve.d,curve.end,curve.q].every(p=>inside(p,box)))return curve.path;
  let path=clippedLine(curve.p,curve.start,box),last:Point|undefined;
  for(const piece of clippedCubic(curve.start,curve.c,curve.d,curve.end,box)) {
    if(!last||last[0]!==piece.p[0]||last[1]!==piece.p[1])path+=` M${piece.p}`;
    path+=` C${piece.c} ${piece.d} ${piece.q}`;last=piece.q;
  }
  return (path+" "+clippedLine(curve.end,curve.q,box)).trim();
}

/** Candidate cells follow the curve, rather than scanning its often huge box. */
export function edgeTiles(curve: ReturnType<typeof edgeCurve>, viewport: Box, cell: number): Box[] {
  const tiles = new Map<string,Box>();
  function visit(p: Point,c: Point,d: Point,q: Point,depth=0) {
    const points=[p,c,d,q],left=Math.max(viewport.x,Math.min(...points.map(p=>p[0]))),right=Math.min(viewport.x+viewport.width,Math.max(...points.map(p=>p[0]))),top=Math.max(viewport.y,Math.min(...points.map(p=>p[1]))),bottom=Math.min(viewport.y+viewport.height,Math.max(...points.map(p=>p[1])));
    if(left>right||top>bottom)return;
    if(depth<24&&(right-left>cell||bottom-top>cell)) { const [a,b]=split(p,c,d,q,.5);visit(...a as [Point,Point,Point,Point],depth+1);visit(...b as [Point,Point,Point,Point],depth+1);return; }
    const x=Math.floor(left/cell),y=Math.floor(top/cell),endX=Math.floor(right/cell),endY=Math.floor(bottom/cell);
    if(![x,y,endX,endY].every(Number.isSafeInteger)||(endX-x+1)*(endY-y+1)>4096){tiles.set("fallback",viewport);return;}
    for(let i=x;i<=endX;i++)for(let j=y;j<=endY;j++) {
      const bx=Math.max(viewport.x,i*cell),by=Math.max(viewport.y,j*cell);
      tiles.set(`${i}/${j}`,{x:bx,y:by,width:Math.min(viewport.x+viewport.width,(i+1)*cell)-bx,height:Math.min(viewport.y+viewport.height,(j+1)*cell)-by});
    }
  }
  visit(curve.p,curve.p,curve.start,curve.start);visit(curve.start,curve.c,curve.d,curve.end);visit(curve.end,curve.end,curve.q,curve.q);
  return [...tiles.values()];
}
