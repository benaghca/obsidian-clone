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
    const n = ids.length;
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.fixed = new Uint8Array(n);
    const placed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const k = known(ids[i]);
      if (!k) continue;
      [this.x[i], this.y[i], this.vx[i], this.vy[i]] = k;
      placed[i] = 1;
    }
    const m = links.length;
    this.ls = new Int32Array(m);
    this.lt = new Int32Array(m);
    this.bias = new Float64Array(m);
    this.strength = new Float64Array(m);
    const degree = new Int32Array(n);
    links.forEach((l, i) => {
      this.ls[i] = l.source;
      this.lt[i] = l.target;
      degree[l.source]++;
      degree[l.target]++;
    });
    for (let i = 0; i < m; i++) {
      const s = degree[this.ls[i]];
      const t = degree[this.lt[i]];
      this.bias[i] = s / (s + t);
      this.strength[i] = 1 / Math.min(s, t);
    }
    // New nodes: beside an already placed neighbour (a note just linked
    // appears by its note), else on the spiral.
    const spacing = Math.max(20, this.forces.distance / 6);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < m; i++) {
        const a = this.ls[i];
        const b = this.lt[i];
        if (placed[a] === placed[b]) continue;
        const [from, to] = placed[a] ? [a, b] : [b, a];
        const angle = this.random() * Math.PI * 2;
        this.x[to] = this.x[from] + Math.cos(angle) * spacing;
        this.y[to] = this.y[from] + Math.sin(angle) * spacing;
        placed[to] = 1;
      }
      if (pass === 0 && placed.every((p) => !p)) break;
    }
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (placed[i]) continue;
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

  tick() {
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const alpha = this.alpha;
    const { x, y, vx, vy, n } = this;
    const f = this.forces;

    // Link force: each link pulls (or pushes) towards its distance, more on
    // the end with fewer links, as in d3.
    if (f.link > 0) {
      const { ls, lt, bias, strength } = this;
      for (let i = 0; i < ls.length; i++) {
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
      this.tree.build(x, y, n);
      for (let i = 0; i < n; i++) this.tree.apply(i, x, y, vx, vy, strength * alpha, () => this.jiggle());
    }

    // Centre force: towards (0, 0), proportional to the distance.
    if (f.center > 0) {
      const k = f.center * CENTER_SCALE * alpha;
      for (let i = 0; i < n; i++) {
        vx[i] -= x[i] * k;
        vy[i] -= y[i] * k;
      }
    }

    for (let i = 0; i < n; i++) {
      if (this.fixed[i]) {
        vx[i] = vy[i] = 0;
        continue;
      }
      x[i] += vx[i] *= VELOCITY_KEEP;
      y[i] += vy[i] *= VELOCITY_KEEP;
    }
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

  build(x: Float64Array, y: Float64Array, n: number) {
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
    for (let i = 0; i < n; i++) this.insert(root, i, x, y);
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
