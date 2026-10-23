// Motion helpers. Durations and curves come from the --anim-* tokens in
// styles/theme.css, which collapse to 0ms under prefers-reduced-motion, so
// nothing here hard-codes timing. None of this runs on a keystroke.

type Speed = "fast" | "moderate" | "sidebar";
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
 * Add "is-closing" (whose CSS plays the exit animation or transition), wait for it
 * to end, then remove the element. A timeout covers events that never come
 * (element hidden, animation interrupted); with motion reduced to 0ms the
 * element goes at once.
 */
export function animateOut(el: Element): Promise<void> {
  return new Promise((resolve) => {
    if (!el.isConnected || el.classList.contains("is-closing")) return resolve(); // gone, or already on its way out
    el.classList.add("is-closing");
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
