// Loaded only by the DEV command. Synthetic input measures this engine's
// callback gaps; it cannot see compositor presentation or worker raster time.
import { confirmDialog } from "../shell/confirm";
import { h } from "../shell/dom";
import type { Tab } from "../tabs";
import { canvasViewports } from "./navigation";

let running = false;
export async function measureZoom(el: HTMLElement, tab: Tab, current: () => boolean) {
  if (running || !el.isConnected || !canvasViewports.has(tab)) return;
  running = true;
  const saved = { ...canvasViewports.get(tab)! }, abort = new AbortController();
  let cancelled = false, frame = 0, last = 0, steps = 0;
  const gaps: number[] = [], longTasks: number[] = [];
  const cancel = () => { cancelled = true; };
  window.addEventListener("blur", cancel, { signal: abort.signal });
  window.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } }, { signal: abort.signal, capture: true });
  const observer = PerformanceObserver.supportedEntryTypes.includes("longtask") ? new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration))) : null;
  const tick = (now: number) => { if (last) gaps.push(now - last); last = now; frame = requestAnimationFrame(tick); };
  const started = performance.now();
  try {
    (el.querySelector(".canvas-controls .lucide-maximize")?.closest("[role=button]") as HTMLElement | null)?.click();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const rect = el.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    observer?.observe({ type: "longtask" });
    frame = requestAnimationFrame(tick);
    for (; steps < 300; steps++) {
      if (cancelled || !el.isConnected || !current() || document.hidden) { cancelled = true; break; }
      el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: steps < 150 ? -6 : 6, clientX: x, clientY: y }));
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  } finally {
    cancelAnimationFrame(frame); observer?.disconnect(); abort.abort(); running = false;
    // Tab switch destroys this element and keeps the tab's viewport. Write the
    // saved one back either way; a later open reads the map. Redraw only if
    // this element is still on screen.
    const live = canvasViewports.get(tab);
    if (live) {
      Object.assign(live, saved);
      if (el.isConnected) el.dispatchEvent(new WheelEvent("wheel", { cancelable: true, ctrlKey: true }));
    }
  }
  const sorted = gaps.toSorted((a, b) => a - b), percentile = (p: number) => sorted.length ? sorted[Math.floor((sorted.length - 1) * p)].toFixed(1) : "unavailable";
  const report = {
    steps, cancelled, samples: sorted.length, p50: percentile(.5), p95: percentile(.95), max: percentile(1),
    gapsOver20ms: gaps.filter(n => n > 20).length, elapsedMs: +(performance.now() - started).toFixed(1),
    droppedFrames: null, deviceScale: devicePixelRatio, engine: navigator.userAgent,
    longTasks: observer ? longTasks : null,
  };
  void confirmDialog({ title: "Canvas: measure zoom", confirm: "Close", cancel: false, message: h("div", null,
    h("p", null, `${steps}/300 synthetic Ctrl+wheel steps${cancelled ? " (cancelled)" : ""}; ${report.samples} frame gaps; device scale ${report.deviceScale}.`),
    h("p", null, `Frame-gap p50 / p95 / max: ${report.p50} / ${report.p95} / ${report.max} ms. Gaps over 20 ms: ${report.gapsOver20ms}.`),
    h("p", null, "Compositor dropped frames: unavailable through this engine's page API. Callback gaps do not measure presentation or raster work."),
    h("p", null, observer ? `Long tasks: ${longTasks.length}; max ${Math.max(0, ...longTasks).toFixed(1)} ms.` : "Long-task timing: unavailable in this engine."),
    h("p", null, navigator.userAgent),
  ) });
  return report;
}
