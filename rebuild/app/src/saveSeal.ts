// A vault switch seals every save so a timer cannot write the old vault's
// text after the backend root has changed. Rename and delete use a per-file
// hold instead; this flag is only the whole-window barrier.

let sealed = false;

export function sealWrites(): void {
  sealed = true;
}

export function unsealWrites(): void {
  sealed = false;
}

export function writesSealed(): boolean {
  return sealed;
}
