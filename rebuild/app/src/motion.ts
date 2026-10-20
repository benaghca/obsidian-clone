// Motion helpers. Durations and curves come from the --anim-* tokens in
// styles/theme.css, which collapse to 0ms under prefers-reduced-motion, so
// nothing here hard-codes timing. None of this runs on a keystroke.

type Speed = "fast" | "moderate" | "slow";
type Curve = "out" | "in" | "in-out";

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A duration token in milliseconds. */
export function duration(speed: Speed): number {
  return parseTime(token(`--anim-duration-${speed}`));
}

/** An easing token, as a CSS timing function. */
export function easing(curve: Curve): string {
  return token(`--anim-ease-${curve}`) || "ease";
}

function parseTime(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.endsWith("ms") ? n : n * 1000;
}

/** The longest animation or transition (duration + delay) set on an element, in ms. */
function longestMotion(el: Element): number {
  const style = getComputedStyle(el);
  const longest = (durations: string, delays: string) => {
    const d = durations.split(",").map(parseTime);
    const l = delays.split(",").map(parseTime);
    return Math.max(0, ...d.map((x, i) => x + (l[i % l.length] ?? 0)));
  };
  const animation = style.animationName === "none" ? 0 : longest(style.animationDuration, style.animationDelay);
  return Math.max(animation, longest(style.transitionDuration, style.transitionDelay));
}

/**
 * Add `cls` (whose CSS plays the exit animation or transition), wait for it
 * to end, then remove the element. A timeout covers events that never come
 * (element hidden, animation interrupted); with motion reduced to 0ms the
 * element goes at once.
 */
export function animateOut(el: Element, cls = "is-closing"): Promise<void> {
  return new Promise((resolve) => {
    if (!el.isConnected || el.classList.contains(cls)) return resolve(); // gone, or already on its way out
    el.classList.add(cls);
    const ms = longestMotion(el);
    let timer = 0;
    const done = (e?: Event) => {
      if (e && e.target !== el) return; // a child's animation ending
      clearTimeout(timer);
      el.removeEventListener("animationend", done);
      el.removeEventListener("transitionend", done);
      el.remove();
      resolve();
    };
    if (ms <= 0) return done();
    el.addEventListener("animationend", done);
    el.addEventListener("transitionend", done);
    timer = window.setTimeout(done, ms + 50);
  });
}

/**
 * Slide an element open (to its natural height) or closed (to 0), fading as
 * it goes. Starts from wherever a previous slide left it, so quick re-toggles
 * reverse smoothly. Resolves true if it ran to the end, false if a later
 * slide interrupted it.
 */
export function slideHeight(el: HTMLElement, open: boolean, fromZero = false): Promise<boolean> {
  const style = getComputedStyle(el);
  const fromHeight = fromZero ? 0 : el.getBoundingClientRect().height;
  const fromOpacity = fromZero ? 0 : parseFloat(style.opacity);
  for (const a of el.getAnimations()) a.cancel();
  const toHeight = open ? el.scrollHeight : 0;
  el.style.overflow = "hidden";
  const anim = el.animate(
    [
      { height: `${fromHeight}px`, opacity: fromOpacity },
      { height: `${toHeight}px`, opacity: open ? 1 : 0 },
    ],
    { duration: duration("moderate"), easing: easing(open ? "out" : "in-out"), fill: open ? "none" : "forwards" },
  );
  return anim.finished.then(
    () => {
      el.style.overflow = "";
      return true;
    },
    () => false,
  );
}

/** A CSS cubic-bezier() timing function as a JS function of progress 0..1. */
function bezier(css: string): (t: number) => number {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css);
  const [x1, y1, x2, y2] = m ? m[1].split(",").map(Number) : [0.25, 0.1, 0.25, 1];
  const curve = (a1: number, a2: number, t: number) => 3 * (1 - t) * (1 - t) * t * a1 + 3 * (1 - t) * t * t * a2 + t * t * t;
  return (x) => {
    // Bisection on x(t); 20 rounds is far below a pixel.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (curve(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return curve(y1, y2, (lo + hi) / 2);
  };
}

const running = new WeakMap<HTMLElement, (arrived: boolean) => void>();
const INTERRUPTS = ["wheel", "pointerdown", "keydown", "touchstart"];

/**
 * Smoothly scroll `el` to `target` with the slow duration and ease-out curve.
 * A function target is re-read every frame, so it can follow content whose
 * position settles while scrolling. Any wheel, pointer or key input from the
 * user stops it where it is. Resolves true if it arrived, false if stopped.
 */
export function smoothScrollTo(el: HTMLElement, target: number | (() => number)): Promise<boolean> {
  running.get(el)?.(false);
  const top = typeof target === "number" ? () => target : target;
  const ms = duration("slow");
  const start = el.scrollTop;
  if (ms <= 0 || Math.abs(top() - start) < 1) {
    el.scrollTop = top();
    return Promise.resolve(true);
  }
  const ease = bezier(easing("out"));
  return new Promise((resolve) => {
    let frame = 0;
    const t0 = performance.now();
    const stop = (arrived = false) => {
      cancelAnimationFrame(frame);
      running.delete(el);
      for (const type of INTERRUPTS) el.removeEventListener(type, interrupt);
      resolve(arrived);
    };
    const interrupt = () => stop(false);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      el.scrollTop = start + (top() - start) * ease(p);
      if (p < 1) frame = requestAnimationFrame(step);
      else stop(true);
    };
    for (const type of INTERRUPTS) el.addEventListener(type, interrupt, { passive: true });
    running.set(el, stop);
    frame = requestAnimationFrame(step);
  });
}

export const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
