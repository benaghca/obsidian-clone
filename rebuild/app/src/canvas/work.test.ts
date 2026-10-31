import { afterEach, expect, test, vi } from "vitest";
import { canvasWork } from "./work";
afterEach(() => vi.unstubAllGlobals());
function clock() {
  let id = 0; const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const tick = () => { const [key, fn] = frames.entries().next().value!; frames.delete(key); fn(performance.now()); };
  return { frames, tick };
}
test("work slices, pauses, replaces stale jobs and cancels disposal", () => {
  const {frames,tick} = clock(), work = canvasWork(), values: (number|string)[] = [];
  for (let i=0;i<100;i++) work.add(String(i),()=>values.push(i));
  expect(frames.size).toBe(0);work.resume();tick();expect(values).toHaveLength(32);
  work.pause();expect(frames.size).toBe(0);work.add("99",()=>values.push("latest"));work.resume();
  while(frames.size)tick();expect(values).toHaveLength(100);expect(values.at(-1)).toBe("latest");
  work.add("canceled",()=>{throw Error("canceled work ran");});work.cancel("canceled");tick();
  work.add("stop",()=>{throw Error("disposed work ran");});work.dispose();expect(frames.size).toBe(0);
});
test("SVG weights bound mutations independently of JavaScript execution time", () => {
  const {frames,tick}=clock(),work=canvasWork(),values:number[]=[];
  for(let i=0;i<10;i++)work.add(String(i),()=>values.push(i),16);
  work.resume();tick();expect(values).toEqual([0,1]);expect(frames.size).toBe(1);work.dispose();
});
