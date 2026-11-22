// The graph's force-directed layout, written for Grove (no library): a
// velocity Verlet simulation in the style of d3-force, with the four forces
// of Obsidian's graph settings.
//
// - Centre force pulls every node towards the middle, harder the further out
//   it is, so unlinked notes and separate clusters stay in view.
// - Repel force pushes every pair of nodes apart, weaker with distance. It is
//   approximated with a Barnes-Hut quadtree, so a tick costs n log n, not n².
// - Link force pulls linked nodes towards the link distance, like a spring.
//
// The simulation cools: `alpha` scales every force and decays towards zero
// over about 300 ticks (five seconds at 60 frames a second), the way
// Obsidian's graph settles quickly and then creeps to a stop. Once alpha is
// below `ALPHA_MIN` it is settled and the view stops ticking it altogether.
// Dragging a node holds alpha up (`alphaTarget`); a change to the graph
// reheats it a little. Free of the DOM, so it is tested on its own.
//
// Review 4: a tick can be taken in steps (`advance`), so one tick of a 50,000
// node graph (about 95 ms) is spread over several frames instead of holding
// one. The steps do the same arithmetic in the same order as `tick`, and
// positions change only in a tick's last step, so the layout is the same
// tick for tick; only a new graph must wait for the tick to end
// (`ticking`).

export interface Forces {
  /** Obsidian's "Center force", 0 to 1. */
  center: number;
  /** "Repel force", 0 to 20. */
  repel: number;
  /** "Link force", 0 to 1. */
  link: number;
  /** "Link distance", 30 to 500. */
  distance: number;
}

export const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
/** Velocity kept from one tick to the next (d3's velocityDecay of 0.4). */
const VELOCITY_KEEP = 0.6;
// The sliders' numbers scaled to forces in layout units (screen pixels at
// 100% zoom). Tuned so the same vault spreads about as wide as in Obsidian
// at the default settings: a few hundred pixels for twenty notes, a few
// thousand for a thousand.
const REPEL_SCALE = 40;
const CENTER_SCALE = 0.09;
const THETA2 = 0.81; // Barnes-Hut accuracy (theta 0.9, squared)
const DISTANCE_MIN2 = 1;

/** A graph prepared for `Simulation.installGraph`. */
export interface SimGraph {
  n: number;
  /** Per node: the current node whose place and speed it keeps, or -1. */
  from: Int32Array<ArrayBuffer>;
  /** Nodes given a place and speed of their own. */
  given: Map<number, [number, number, number, number]>;
  ls: Int32Array<ArrayBuffer>;
  lt: Int32Array<ArrayBuffer>;
  bias: Float64Array<ArrayBuffer>;
  strength: Float64Array<ArrayBuffer>;
  /** (new node, placed neighbour) pairs, in placing order. */
  plan: number[];
  /** Nodes left for the spiral, in order. */
  spiral: number[];
}

export class Simulation {
  n = 0;
  x = new Float64Array(0);
  y = new Float64Array(0);
  vx = new Float64Array(0);
  vy = new Float64Array(0);
  /** 1 while a node is held where it is (being dragged). */
  fixed = new Uint8Array(0);
  alpha = 1;
  alphaTarget = 0;
  forces: Forces = { center: 0.518713248970312, repel: 10, link: 1, distance: 250 };

  private ls = new Int32Array(0);
  private lt = new Int32Array(0);
  private bias = new Float64Array(0);
  private strength = new Float64Array(0);
  private tree = new QuadTree();
  private random = lcg(1);
  /** The tick under way in steps (`advance`), if any. */
  private work: Generator<void, void> | null = null;
  /** Nodes put somewhere by `place` while a tick was under way: they go there when it ends. */
  private placed = new Map<number, [number, number]>();

  /** Whether a tick is under way: positions move when it ends, and a new graph must wait for that. */
  get ticking() {
    return this.work !== null;
  }

  /** Whether it has cooled down: nothing moves any more, so nothing needs to tick. */
  get settled() {
    return this.alpha < ALPHA_MIN && this.alphaTarget === 0;
  }

  /**
   * Take a new set of nodes and links. Nodes that were already there (same
   * id) keep their place and speed; new ones start next to a linked node
   * already placed, or on a spiral around the middle (always the same spiral
   * for the same graph, so it opens the same way each time).
   */
  setGraph(ids: readonly string[], links: readonly { source: number; target: number }[], known: (id: string) => [number, number, number, number] | undefined) {
    const steps = this.prepareGraph(ids, links, known);
    for (;;) {
      const step = steps.next();
      if (step.done) return this.installGraph(step.value);
    }
  }

  /**
   * `setGraph` in two parts (review 3): this works out everything that does not
   * depend on where the current nodes are, in steps (it yields), without
   * touching the simulation, and `installGraph` then puts it in place. `known`
   * gives a node's place and speed, or the index of the current node whose
   * place and speed it keeps (read when it is installed, so the layout keeps
   * moving meanwhile).
   */
  *prepareGraph(
    ids: readonly string[],
    links: readonly { source: number; target: number }[],
    known: (id: string) => number | [number, number, number, number] | undefined,
  ): Generator<void, SimGraph> {
    const n = ids.length;
    const from = new Int32Array(n).fill(-1);
    const given = new Map<number, [number, number, number, number]>();
    const placed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if ((i & 4095) === 4095) yield;
      const k = known(ids[i]);
      if (k === undefined) continue;
      if (typeof k === "number") from[i] = k;
      else given.set(i, k);
      placed[i] = 1;
    }
    const m = links.length;
    const ls = new Int32Array(m);
    const lt = new Int32Array(m);
    const bias = new Float64Array(m);
    const strength = new Float64Array(m);
    const degree = new Int32Array(n);
    for (let i = 0; i < m; i++) {
      if ((i & 4095) === 4095) yield;
      const l = links[i];
      ls[i] = l.source;
      lt[i] = l.target;
      degree[l.source]++;
      degree[l.target]++;
    }
    for (let i = 0; i < m; i++) {
      if ((i & 4095) === 4095) yield;
      const s = degree[ls[i]];
      const t = degree[lt[i]];
      bias[i] = s / (s + t);
      strength[i] = 1 / Math.min(s, t);
    }
    // New nodes beside an already placed neighbour, in the order `installGraph`
    // places them: (new node, its neighbour) pairs.
    const plan: number[] = [];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < m; i++) {
        if ((i & 4095) === 4095) yield;
        const a = ls[i];
        const b = lt[i];
        if (placed[a] === placed[b]) continue;
        const [anchor, to] = placed[a] ? [a, b] : [b, a];
        plan.push(to, anchor);
        placed[to] = 1;
      }
      if (pass === 0 && placed.every((p) => !p)) break;
    }
    const spiral: number[] = [];
    for (let i = 0; i < n; i++) {
      if ((i & 4095) === 4095) yield;
      if (!placed[i]) spiral.push(i);
    }
    return { n, from, given, ls, lt, bias, strength, plan, spiral };
  }

  /**
   * Put node `i` at (`px`, `py`) (a drag). Between ticks it goes there now. During a tick it
   * goes there when the tick ends (review 5): the tick under way reads every position as it
   * was when it began, as a whole tick does, so the layout is the same as with the move made
   * at that boundary. `showing` shows it there meanwhile.
   */
  place(i: number, px: number, py: number) {
    if (this.work) this.placed.set(i, [px, py]);
    else [this.x[i], this.y[i]] = [px, py];
  }

  /**
   * `fn` with the nodes `place` holds back shown where they were put (for drawing and hit
   * tests, which run between a tick's steps, never during one).
   */
  showing<T>(fn: () => T): T {
    if (!this.placed.size) return fn();
    const kept: [number, number, number][] = [];
    for (const [i, [px, py]] of this.placed) {
      kept.push([i, this.x[i], this.y[i]]);
      [this.x[i], this.y[i]] = [px, py];
    }
    try {
      return fn();
    } finally {
      for (const [i, ox, oy] of kept) [this.x[i], this.y[i]] = [ox, oy];
    }
  }

  /** Put a prepared graph in place (`prepareGraph`): one pass over its nodes, and the new ones placed. */
  installGraph(g: SimGraph) {
    // Between ticks only (the view waits for `ticking` to end); a tick under way ends first.
    while (this.work && !this.advance(Infinity));
    const { n, from, given } = g;
    const [ox, oy, ovx, ovy] = [this.x, this.y, this.vx, this.vy];
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.fixed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const j = from[i];
      if (j < 0) continue;
      this.x[i] = ox[j];
      this.y[i] = oy[j];
      this.vx[i] = ovx[j];
      this.vy[i] = ovy[j];
    }
    for (const [i, k] of given) [this.x[i], this.y[i], this.vx[i], this.vy[i]] = k;
    this.ls = g.ls;
    this.lt = g.lt;
    this.bias = g.bias;
    this.strength = g.strength;
    const spacing = Math.max(20, this.forces.distance / 6);
    for (let p = 0; p < g.plan.length; p += 2) {
      const to = g.plan[p];
      const anchor = g.plan[p + 1];
      const angle = this.random() * Math.PI * 2;
      this.x[to] = this.x[anchor] + Math.cos(angle) * spacing;
      this.y[to] = this.y[anchor] + Math.sin(angle) * spacing;
    }
    let k = 0;
    for (const i of g.spiral) {
      const r = spacing * Math.sqrt(0.5 + k);
      const angle = k * Math.PI * (3 - Math.sqrt(5));
      this.x[i] = r * Math.cos(angle);
      this.y[i] = r * Math.sin(angle);
      k++;
    }
  }

  /** Warm the layout up again (after a change, or to restart it). */
  reheat(alpha: number) {
    this.alpha = Math.max(this.alpha, alpha);
  }

  /** One whole tick (the rest of one under way, if `advance` began it). */
  tick() {
    while (!this.advance(Infinity));
  }

  /**
   * Work on the tick under way, or begin the next one, until `performance.now()`
   * reaches `until`. True when a tick ended (the nodes moved); a new tick is
   * begun only by the next call.
   */
  advance(until: number): boolean {
    this.work ??= this.steps();
    for (;;) {
      if (this.work.next().done) {
        this.work = null;
        return true;
      }
      if (performance.now() >= until) return false;
    }
  }

  /**
   * A tick, pausing (yielding) every few thousand links or tree inserts and every
   * few hundred nodes. Alpha and the forces are read when it begins; a node being
   * dragged is moved by the view in between, as between two ticks.
   */
  private *steps(): Generator<void, void> {
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const alpha = this.alpha;
    const { x, y, vx, vy, n } = this;
    const f = { ...this.forces };

    // Link force: each link pulls (or pushes) towards its distance, more on
    // the end with fewer links, as in d3.
    if (f.link > 0) {
      const { ls, lt, bias, strength } = this;
      for (let i = 0; i < ls.length; i++) {
        if ((i & 4095) === 4095) yield;
        const s = ls[i];
        const t = lt[i];
        let dx = x[t] + vx[t] - x[s] - vx[s] || this.jiggle();
        let dy = y[t] + vy[t] - y[s] - vy[s] || this.jiggle();
        let l = Math.sqrt(dx * dx + dy * dy);
        l = ((l - f.distance) / l) * alpha * strength[i] * f.link;
        dx *= l;
        dy *= l;
        const b = bias[i];
        vx[t] -= dx * b;
        vy[t] -= dy * b;
        vx[s] += dx * (1 - b);
        vy[s] += dy * (1 - b);
      }
    }

    // Repel force, Barnes-Hut.
    if (f.repel > 0 && n > 1) {
      const strength = -f.repel * REPEL_SCALE;
      yield* this.tree.build(x, y, n);
      for (let i = 0; i < n; i++) {
        if ((i & 511) === 511) yield;
        this.tree.apply(i, x, y, vx, vy, strength * alpha, () => this.jiggle());
      }
    }

    // Centre force: towards (0, 0), proportional to the distance.
    if (f.center > 0) {
      const k = f.center * CENTER_SCALE * alpha;
      for (let i = 0; i < n; i++) {
        vx[i] -= x[i] * k;
        vy[i] -= y[i] * k;
      }
    }

    // In one step, so a frame never draws a half-moved layout.
    for (let i = 0; i < n; i++) {
      if (this.fixed[i]) {
        vx[i] = vy[i] = 0;
        continue;
      }
      x[i] += vx[i] *= VELOCITY_KEEP;
      y[i] += vy[i] *= VELOCITY_KEEP;
    }
    // Moves made during the tick, at its end.
    for (const [i, [px, py]] of this.placed) [x[i], y[i]] = [px, py];
    this.placed.clear();
  }

  /** Two nodes in exactly the same place push apart in a random direction. */
  private jiggle() {
    return (this.random() - 0.5) * 1e-6;
  }
}

/** A small deterministic random number generator, so a layout is the same every time. */
function lcg(seed: number) {
  let s = seed;
  return () => (s = (1664525 * s + 1013904223) % 4294967296) / 4294967296;
}

/**
 * A Barnes-Hut quadtree over the nodes, rebuilt each tick in flat arrays
 * (no objects per cell). Far-away cells act as one body at their centre of
 * mass; near ones are opened.
 */
class QuadTree {
  private cap = 0;
  private count = 0;
  // Per cell: square bounds, children (4, -1 for none), the body in a leaf
  // (-1 for an inner cell), body count and position sums.
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  private size = new Float64Array(0);
  private kids = new Int32Array(0);
  private body = new Int32Array(0);
  private mass = new Float64Array(0);
  private sx = new Float64Array(0);
  private sy = new Float64Array(0);
  /** Bodies in exactly the same place as a leaf's body, chained. */
  private next = new Int32Array(0);
  private stack = new Int32Array(0);

  private grow(cells: number) {
    if (cells <= this.cap) return;
    const cap = Math.max(cells, this.cap * 2, 64);
    const f64 = (old: Float64Array) => {
      const a = new Float64Array(cap);
      a.set(old);
      return a;
    };
    this.x0 = f64(this.x0);
    this.y0 = f64(this.y0);
    this.size = f64(this.size);
    this.mass = f64(this.mass);
    this.sx = f64(this.sx);
    this.sy = f64(this.sy);
    const kids = new Int32Array(cap * 4);
    kids.set(this.kids);
    this.kids = kids;
    const body = new Int32Array(cap);
    body.set(this.body);
    this.body = body;
    this.stack = new Int32Array(cap * 4);
    this.cap = cap;
  }

  private cell(x0: number, y0: number, size: number) {
    if (this.count >= this.cap) this.grow(this.count + 1);
    const c = this.count++;
    this.x0[c] = x0;
    this.y0[c] = y0;
    this.size[c] = size;
    this.kids.fill(-1, c * 4, c * 4 + 4);
    this.body[c] = -1;
    this.mass[c] = 0;
    this.sx[c] = 0;
    this.sy[c] = 0;
    return c;
  }

  /** Rebuilt over the nodes, pausing (yielding) every few thousand inserts. */
  *build(x: Float64Array, y: Float64Array, n: number): Generator<void, void> {
    if (this.next.length < n) this.next = new Int32Array(n);
    this.next.fill(-1, 0, n);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < minX) minX = x[i];
      if (x[i] > maxX) maxX = x[i];
      if (y[i] < minY) minY = y[i];
      if (y[i] > maxY) maxY = y[i];
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) * 1.0001;
    this.count = 0;
    this.grow(2 * n + 1);
    const root = this.cell(minX, minY, size);
    for (let i = 0; i < n; i++) {
      if ((i & 4095) === 4095) yield;
      this.insert(root, i, x, y);
    }
  }

  private insert(root: number, i: number, x: Float64Array, y: Float64Array) {
    let c = root;
    const px = x[i];
    const py = y[i];
    for (let depth = 0; ; depth++) {
      this.mass[c]++;
      this.sx[c] += px;
      this.sy[c] += py;
      const half = this.size[c] / 2;
      const isLeaf = this.kids[c * 4] === -1 && this.kids[c * 4 + 1] === -1 && this.kids[c * 4 + 2] === -1 && this.kids[c * 4 + 3] === -1;
      if (isLeaf && this.body[c] === -1 && this.mass[c] === 1) {
        this.body[c] = i;
        return;
      }
      if (isLeaf && this.body[c] !== -1) {
        const other = this.body[c];
        // Same place (or too deep to split further): chain it to the leaf.
        if ((x[other] === px && y[other] === py) || depth > 48) {
          this.next[i] = this.next[other];
          this.next[other] = i;
          return;
        }
        // Push the leaf's body down one level.
        this.body[c] = -1;
        const q = this.quadrant(c, x[other], y[other], half);
        const k = this.cell(this.x0[c] + (q & 1 ? half : 0), this.y0[c] + (q & 2 ? half : 0), half);
        this.kids[c * 4 + q] = k;
        this.mass[k] = 0;
        // Re-add `other` (and anything chained to it) into the new cell.
        for (let o = other; o !== -1; o = this.next[o]) {
          this.mass[k]++;
          this.sx[k] += x[o];
          this.sy[k] += y[o];
        }
        this.body[k] = other;
      }
      const q = this.quadrant(c, px, py, half);
      let k = this.kids[c * 4 + q];
      if (k === -1) {
        k = this.cell(this.x0[c] + (q & 1 ? half : 0), this.y0[c] + (q & 2 ? half : 0), half);
        this.kids[c * 4 + q] = k;
      }
      c = k;
    }
  }

  private quadrant(c: number, px: number, py: number, half: number) {
    return (px >= this.x0[c] + half ? 1 : 0) | (py >= this.y0[c] + half ? 2 : 0);
  }

  /** Add the repulsion on node i from every other node (`k` is the strength times alpha). */
  apply(i: number, x: Float64Array, y: Float64Array, vx: Float64Array, vy: Float64Array, k: number, jiggle: () => number) {
    const stack = this.stack;
    let top = 0;
    stack[top++] = 0;
    const px = x[i];
    const py = y[i];
    while (top) {
      const c = stack[--top];
      const mass = this.mass[c];
      if (!mass) continue;
      const leafBody = this.body[c];
      if (leafBody !== -1) {
        for (let o = leafBody; o !== -1; o = this.next[o]) {
          if (o === i) continue;
          let dx = x[o] - px || jiggle();
          let dy = y[o] - py || jiggle();
          let l = dx * dx + dy * dy;
          if (l < DISTANCE_MIN2) l = Math.sqrt(DISTANCE_MIN2 * l);
          vx[i] += (dx * k) / l;
          vy[i] += (dy * k) / l;
        }
        continue;
      }
      const dx = this.sx[c] / mass - px;
      const dy = this.sy[c] / mass - py;
      const l = dx * dx + dy * dy;
      const s = this.size[c];
      if ((s * s) / THETA2 < l) {
        // Far enough: the whole cell acts as one body.
        vx[i] += (dx * k * mass) / l;
        vy[i] += (dy * k * mass) / l;
        continue;
      }
      for (let q = 0; q < 4; q++) {
        const kid = this.kids[c * 4 + q];
        if (kid !== -1) stack[top++] = kid;
      }
    }
  }
}
