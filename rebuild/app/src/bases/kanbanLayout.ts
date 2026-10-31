// Kanban board geometry (KANBAN_PLAN §5.2): fixed sizes, so every placement is arithmetic.
// Pure, free of the DOM; kanban.ts draws with it and kanban.test.ts checks it.

/** Board geometry (px): padding, column gap, column header, card gap, the column body's side padding. */
export const KANBAN = { pad: 12, gap: 12, head: 36, cardGap: 8, side: 8, width: 272 } as const;
/** A card: border, cover, padding, the title line, then one 20 px line per property. */
export const kanbanCardHeight = (props: number, cover: number) => 2 + cover + 16 + 20 + (props ? 4 + props * 20 : 0);
/** The board's scroll width for `count` columns. */
export const trackWidth = (count: number, width: number) => count ? KANBAN.pad * 2 + count * width + (count - 1) * KANBAN.gap : 0;
/** Columns to mount for a horizontal scroll position: those in view, and `overscan` more each side. */
export function columnSpan(count: number, scrollLeft: number, viewport: number, width: number, overscan = 1) {
  const step = width + KANBAN.gap;
  const first = Math.max(0, Math.floor((scrollLeft - KANBAN.pad) / step) - overscan);
  const end = Math.min(count, Math.floor((scrollLeft + viewport - KANBAN.pad) / step) + 1 + overscan);
  return { first: Math.min(first, count), end: Math.max(end, Math.min(first, count)) };
}
/** Cards to draw in a column for its scroll position: those in view, and `overscan` more each side. */
export function cardSpan(count: number, scrollTop: number, viewport: number, pitch: number, overscan = 3) {
  const first = Math.max(0, Math.min(count, Math.floor(scrollTop / pitch) - overscan));
  return { first, end: Math.max(first, Math.min(count, Math.ceil((scrollTop + viewport) / pitch) + overscan)) };
}
/** The card in another column at the same height on screen (Left/Right). */
export const nearestIndex = (index: number, fromTop: number, toTop: number, toCount: number, pitch: number) =>
  Math.max(0, Math.min(toCount - 1, Math.round((index * pitch - fromTop + toTop) / pitch)));
