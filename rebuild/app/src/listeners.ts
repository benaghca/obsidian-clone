// A list of callbacks: `on` adds one (and returns a function that removes
// it), `emit` calls them all in the order they were added.

export function listeners<A extends unknown[] = []>() {
  const fns = new Set<(...args: A) => void>();
  return {
    on(fn: (...args: A) => void): () => void {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    emit(...args: A) {
      for (const fn of fns) fn(...args);
    },
  };
}
