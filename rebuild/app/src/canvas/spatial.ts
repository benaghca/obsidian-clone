export interface Box { x: number; y: number; width: number; height: number }
const intersects = (a: Box, b: Box) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
/** Large groups use the overflow set instead of occupying thousands of buckets. */
export class CanvasSpatial<T extends Box> {
  private buckets = new Map<string, Set<T>>();
  private keys = new Map<T, string[]>();
  private large = new Set<T>();
  update(item: T) {
    this.remove(item);
    const x = Math.floor(item.x / 1000), y = Math.floor(item.y / 1000), right = Math.floor((item.x + item.width) / 1000), bottom = Math.floor((item.y + item.height) / 1000);
    if (![x,y,right,bottom].every(Number.isSafeInteger) || (right - x + 1) * (bottom - y + 1) > 256) { this.large.add(item); return; }
    const keys = [];
    for (let a = x; a <= right; a++) for (let b = y; b <= bottom; b++) {
      const key = `${a},${b}`; keys.push(key);
      if (!this.buckets.has(key)) this.buckets.set(key, new Set());
      this.buckets.get(key)!.add(item);
    }
    this.keys.set(item, keys);
  }
  remove(item: T) {
    for (const key of this.keys.get(item) ?? []) { const bucket = this.buckets.get(key)!; bucket.delete(item); if (!bucket.size) this.buckets.delete(key); }
    this.keys.delete(item); this.large.delete(item);
  }
  query(box: Box) {
    const found = new Set<T>(this.large);
    const x = Math.floor(box.x / 1000), y = Math.floor(box.y / 1000), right = Math.floor((box.x + box.width) / 1000), bottom = Math.floor((box.y + box.height) / 1000);
    // Fit can cover an arbitrarily sparse canvas. Iterate occupied buckets in
    // that case, rather than the empty world between distant nodes.
    if (![x,y,right,bottom].every(Number.isSafeInteger) || (right - x + 1) * (bottom - y + 1) > this.buckets.size * 2) for (const bucket of this.buckets.values()) for (const item of bucket) found.add(item);
    else for (let a = x; a <= right; a++) for (let b = y; b <= bottom; b++) for (const item of this.buckets.get(`${a},${b}`) ?? []) found.add(item);
    return [...found].filter(item => intersects(item, box));
  }
}
