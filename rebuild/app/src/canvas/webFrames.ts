// Which link cards may hold a live frame. Runs on the canvas settle path, so it
// stays next to the bodies queue instead of crossing into a command per pan.

/** Each live frame is its own document on the 60 Hz path. Six is the cap. */
export const WEB_FRAME_CAP = 6;

export interface WebFrameCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The setting, a click, and a usable address all say this card wants a page. */
  wants: boolean;
}

export interface WebFrameView {
  x: number;
  y: number;
  width: number;
  height: number;
  focusX: number;
  focusY: number;
  scale: number;
  titles: boolean;
}

/** On-screen size at which a card is a page rather than a box: 50px wide and 26px tall. */
export function webFrameFits(card: { width: number; height: number }, view: { scale: number; titles: boolean }) {
  return !view.titles && view.scale > 0 && card.width * view.scale >= 50 && card.height * view.scale >= 26;
}

function onScreen(card: WebFrameCard, view: WebFrameView) {
  return card.x < view.x + view.width && card.x + card.width > view.x && card.y < view.y + view.height && card.y + card.height > view.y;
}

/**
 * Ids that keep a live frame, oldest first.
 * Title mode, off-screen cards, and cards under the title-size cut get none.
 * A frame already live stays until it leaves that set, so a pan does not reload it.
 * A free slot goes to the nearest card that wants one. At most six.
 * `live` is the previous result, oldest first (the bodies queue order).
 */
export function webFrameSlots(cards: readonly WebFrameCard[], view: WebFrameView, live: readonly string[]): string[] {
  if (view.titles) return [];
  const eligible = cards.filter((card) => card.wants && onScreen(card, view) && webFrameFits(card, view));
  const ids = new Set(eligible.map((card) => card.id));
  const kept = live.filter((id) => ids.has(id));
  const stay = kept.length > WEB_FRAME_CAP ? kept.slice(kept.length - WEB_FRAME_CAP) : kept;
  const have = new Set(stay);
  const out = [...stay];
  const nearest = [...eligible].sort((a, b) => {
    const da = Math.hypot(a.x + a.width / 2 - view.focusX, a.y + a.height / 2 - view.focusY);
    const db = Math.hypot(b.x + b.width / 2 - view.focusX, b.y + b.height / 2 - view.focusY);
    return da - db || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  for (const card of nearest) {
    if (out.length >= WEB_FRAME_CAP) break;
    if (!have.has(card.id)) {
      out.push(card.id);
      have.add(card.id);
    }
  }
  return out;
}
