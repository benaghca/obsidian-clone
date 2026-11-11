// Canvas, Bases, the graph, the drawing editor and the settings modal are
// separate chunks. The first note does not wait on them. They are fetched
// once the first frame has painted and the browser is idle, and a restored
// workspace waits for the chunks it is about to show so the first paint of
// that view is the real view.

function slot<T>(importer: () => Promise<T>) {
  let mod: T | null = null;
  let pending: Promise<T> | null = null;
  return {
    ready: () => mod !== null,
    get: (): T | null => mod,
    load(): Promise<T> {
      return (pending ??= importer().then((loaded) => {
        mod = loaded;
        return loaded;
      }));
    },
  };
}

export const canvasViews = slot(() => import("./canvas/view"));
export const baseViews = slot(() => import("./bases/view"));
export const baseEmbeds = slot(() => import("./bases/embed"));
export const graphViews = slot(() => import("./graph/view"));
export const drawingViews = slot(() => import("./drawing/view"));

/** A note that draws a base: a ```base block, or a ![[….base]] embed. */
export function noteNeedsBase(text: string): boolean {
  return /```[ \t]*base\b/i.test(text) || /!\[[^\]]*\.base(?:[#|\]])/i.test(text);
}

const HEAVY_ATTR = "data-grove-heavy";
let warmed = false;

function startLoads() {
  void Promise.all([
    canvasViews.load(),
    baseViews.load(),
    baseEmbeds.load(),
    graphViews.load(),
    drawingViews.load(),
    import("./settings/gate").then((gate) => gate.preloadSettings()),
  ]).then(() => {
    document.documentElement.setAttribute(HEAVY_ATTR, "ready");
  });
}

/**
 * Parse the heavy chunks after the first note is on screen. In dev they
 * start at once so a test can open a view without waiting out an idle
 * timeout; the dev server already serves modules separately.
 */
export function warmHeavyViews() {
  if (warmed) return;
  warmed = true;
  if (import.meta.env.DEV) {
    startLoads();
    return;
  }
  const arm = () => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => startLoads(), { timeout: 800 });
    else setTimeout(startLoads, 1);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => arm());
  else arm();
}

/** True when `type` needs no chunk, or that chunk is already evaluated. */
export function kindReady(type: string | undefined): boolean {
  if (type === "canvas") return canvasViews.ready();
  if (type === "base") return baseViews.ready();
  if (type === "drawing") return drawingViews.ready();
  if (type === "graph" || type === "localgraph") return graphViews.ready();
  return true;
}

/** True when none of these notes draw a base, or the base chunks are already evaluated. */
export function notesReady(notes: readonly string[]): boolean {
  if (!notes.some(noteNeedsBase)) return true;
  return baseViews.ready() && baseEmbeds.ready();
}

/** Load the chunk a tab type needs. Already-loaded chunks resolve at once. */
export function preloadKinds(types: Iterable<string | undefined>, notes: readonly string[] = []): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  let canvas = false;
  let base = false;
  let drawing = false;
  let graph = false;
  for (const type of types) {
    if (type === "canvas" && !canvas) {
      canvas = true;
      jobs.push(canvasViews.load());
    } else if (type === "base" && !base) {
      base = true;
      jobs.push(baseViews.load(), baseEmbeds.load());
    } else if (type === "drawing" && !drawing) {
      drawing = true;
      jobs.push(drawingViews.load());
    } else if ((type === "graph" || type === "localgraph") && !graph) {
      graph = true;
      jobs.push(graphViews.load());
    }
  }
  if (!base && notes.some(noteNeedsBase)) jobs.push(baseViews.load(), baseEmbeds.load());
  return Promise.all(jobs).then(() => {});
}
