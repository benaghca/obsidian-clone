import { commands } from "../commands";
import { readStored } from "../storage";

/** Opt in on a dev build: localStorage.setItem('grove.dev.hitchMeter', 'true')
 * then reload. Works in WebKitGTK without Long Tasks/Event Timing support.
 * Logs event type/target only, never typed text or note contents.
 */
export function installHitchMeter(): () => void {
  if (!import.meta.env.DEV || readStored("grove.dev.hitchMeter", false) !== true) return () => {};
  let last = "startup";
  let at = performance.now();
  let previous: number | undefined;
  let frame = 0;
  const record = (event: Event) => {
    const target = event.target instanceof Element ? event.target.tagName.toLowerCase() : "window";
    last = `${event.type} (${target})`;
    at = performance.now();
  };
  const types = ["keydown", "pointerdown", "input", "wheel", "change"];
  for (const type of types) window.addEventListener(type, record, true);
  // Capture command handlers themselves: hotkeys call cmd.run directly.
  // Wrappers exist only while this dev meter is enabled and are restored on stop.
  const wrapped = commands.all().map(command => {
    const original = command.run;
    const wrapper = () => {
      last = `command ${command.id}`;
      at = performance.now();
      return original.call(command);
    };
    command.run = wrapper;
    return () => { if (command.run === wrapper) command.run = original; };
  });
  const visibility = () => { previous = undefined; };
  document.addEventListener("visibilitychange", visibility);
  const tick = (time: number) => {
    if (!document.hidden) {
      if (previous !== undefined && time - previous > 50) {
        console.warn("[Grove hitch]", { gapMs: Math.round(time - previous), last, eventAgeMs: Math.round(performance.now() - at) });
      }
      previous = time;
    } else previous = undefined;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    for (const type of types) window.removeEventListener(type, record, true);
    document.removeEventListener("visibilitychange", visibility);
    for (const restore of wrapped) restore();
  };
}
