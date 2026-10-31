// Edge and group labels share one temporary plain-text editor.
export function editCanvasLabel(label: HTMLElement, finished: (value: string | undefined, save: boolean) => void) {
  const events = new AbortController();
  // The board hides its selection menu meanwhile; a class, since a :has() over the
  // board would be searched every time the menu restyles, i.e. every zoom frame.
  const world = label.closest(".canvas-world");
  let stopped = false;
  const stop = (save = true) => {
    if (stopped) return;
    stopped = true; events.abort(); label.contentEditable = "false"; label.classList.remove("is-editing"); world?.classList.remove("is-editing-label");
    finished(label.textContent || undefined, save);
  };
  label.contentEditable = "plaintext-only"; label.classList.add("is-editing"); world?.classList.add("is-editing-label");
  label.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation(); const board = label.closest<HTMLElement>(".canvas-view"); stop(); board?.focus({ preventScroll: true });
  }, { signal: events.signal });
  label.addEventListener("blur", () => stop(), { signal: events.signal });
  document.addEventListener("pointerdown", e => { if (!label.contains(e.target as Node)) stop(); }, { capture: true, signal: events.signal });
  label.focus(); getSelection()?.selectAllChildren(label);
  return stop;
}
