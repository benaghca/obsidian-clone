import {withBrowser,sleep} from './browser.mjs';
await withBrowser(async({run,open,read,click,point,check})=>{
 await open('Hit.canvas',{nodes:[{id:'a',type:'text',x:-800,y:0,width:100,height:100,text:'A'},{id:'b',type:'text',x:800,y:0,width:100,height:100,text:'B'}],edges:[{id:'e',fromNode:'a',fromSide:'right',toNode:'b',toSide:'left'}]});
 const source=await read();
 for(const steps of [0,4,8,-2]){
  await click('[aria-label="Reset zoom"]');for(let i=0;i<Math.abs(steps);i++)await click(`[aria-label="Zoom ${steps<0?'in':'out'}"]`);await sleep(60);
  const p=await run(()=>{const e=document.querySelector('path.canvas-edge'),p=e.getPointAtLength(e.getTotalLength()/2),q=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return{x:q.x,y:q.y,scale:new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform).a};});
  for(const dy of [-11,11]){await click({x:p.x,y:p.y+dy});check(await run(()=>!!document.querySelector('path.canvas-edge.is-selected')),`${p.scale}×: native click ${dy}px from edge selects it`);await click({x:p.x,y:p.y+45});}
  await click({x:p.x,y:p.y+14});check(await run(()=>!document.querySelector('path.canvas-edge.is-selected')),`${p.scale}×: 14px outside the edge stroke stays background`);
 }
 check(await read()===source,'Hit selection at every zoom leaves exact canvas bytes unchanged');
});
