// Place our two headless captures beside one another without altering either.
import {withBrowser,sleep} from '../app/scripts/browser.mjs';
import {readFile} from 'node:fs/promises';
const images=await Promise.all(['obsidian','grove'].map(async name=>`data:image/png;base64,${(await readFile(new URL(name+'.png',import.meta.url))).toString('base64')}`));
await withBrowser(async({run,send,shot})=>{
 await send('Emulation.setDeviceMetricsOverride',{width:2560,height:840,deviceScaleFactor:1,mobile:false});
 await run(async images=>{
  const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:999999;background:white;display:flex;color:#222;font:16px sans-serif';
  for(let i=0;i<2;i++){const pane=document.createElement('div');pane.style.width='1280px';const label=document.createElement('div');label.style.cssText='height:40px;padding:10px;box-sizing:border-box';label.textContent=i?'Grove · Round 30 Part A (read only)':'Obsidian 1.14.4 · scratch vault';const img=document.createElement('img');img.src=images[i];img.style.cssText='display:block;width:1280px;height:800px';pane.append(label,img);overlay.append(pane);await img.decode();}document.body.append(overlay);
 },images);await sleep(100);await shot('comparison');
},{height:840,screenshots:new URL('.',import.meta.url).pathname});
