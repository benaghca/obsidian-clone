// One file's debounced write. The dirty flag is separate from the timer: a
// failed write stays dirty and retries with backoff, and flush() reports
// whether the latest text reached disk. Notes, canvases and drawings each
// keep their own call site; this only shares the wait and the retry.

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 8_000;

/** Delay before retry number `attempt` (0 is the first retry). */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
}

export interface FileSave {
  /** The text changed. Write it after `delay`, unless flush runs first. */
  touch(): void;
  /** Write now. False means the write failed and the text is still dirty. */
  flush(): Promise<boolean>;
  /** Forget a pending write. An in-flight write may still finish, but it is not a success. */
  drop(): void;
  readonly dirty: boolean;
}

/**
 * `text` is read when the write starts, so a keystroke during the debounce
 * is included. `postpone` reschedules instead of writing (a drawing gesture
 * still holds live frames). `onSaved` runs only after the snapshot that was
 * written is still the current text.
 */
export function fileSave(opts: {
  delay: number;
  text: () => string;
  write: (text: string) => Promise<void>;
  onSaved?: () => void;
  onError?: (err: unknown) => void;
  postpone?: () => boolean;
}): FileSave {
  let timer = 0;
  let retry = 0;
  let attempt = 0;
  let dirty = false;
  let generation = 0;
  let chain: Promise<boolean> = Promise.resolve(true);

  const clear = () => {
    clearTimeout(timer);
    clearTimeout(retry);
    timer = 0;
    retry = 0;
  };
  const arm = (ms: number, kind: "save" | "retry") => {
    clear();
    // A debounce or a backoff writes once. A flush keeps going until the latest text lands.
    const id = window.setTimeout(() => { void start(false); }, ms);
    if (kind === "save") timer = id;
    else retry = id;
  };

  function touch() {
    dirty = true;
    attempt = 0;
    arm(opts.delay, "save");
  }

  function drop() {
    generation += 1;
    dirty = false;
    attempt = 0;
    clear();
  }

  function start(eager: boolean): Promise<boolean> {
    clear();
    if (!dirty) return chain;
    const gen = generation;
    const run = chain.then(async (): Promise<boolean> => {
      // flush() writes a newer keystroke that arrived during the write. A timer does not: it waits out the debounce.
      let left = eager ? 8 : 1;
      while (left-- > 0) {
        if (gen !== generation || !dirty) return true;
        if (opts.postpone?.()) {
          arm(opts.delay, "save");
          return false;
        }
        const snapshot = opts.text();
        try {
          await opts.write(snapshot);
        } catch (err) {
          if (gen !== generation) return true;
          opts.onError?.(err);
          dirty = true;
          attempt += 1;
          arm(retryDelay(attempt - 1), "retry");
          return false;
        }
        if (gen !== generation) return true;
        if (opts.text() !== snapshot) {
          dirty = true;
          if (left > 0) continue;
          arm(opts.delay, "save");
          return false;
        }
        dirty = false;
        attempt = 0;
        opts.onSaved?.();
        return true;
      }
      return !dirty;
    });
    chain = run.then((ok) => ok, () => false);
    return run;
  }

  function flush(): Promise<boolean> {
    return start(true);
  }

  return { touch, flush, drop, get dirty() { return dirty; } };
}
