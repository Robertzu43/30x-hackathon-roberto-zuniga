// AC-117: the tour's geometry as pure functions (no DOM reads, no writes), so the placement is a test, not a judgement.
export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Placed = { side: 'below' | 'above' | 'right' | 'left'; left: number; top: number };

export const PAD = 10; // p: the lit area is the target grown by this much (AC-117 4.spot: 8 to 12)
const GAP = 8; // AC-117 4.cover: the card is at least this far from the lit area
const TOL = 1; // AC-117 4.textcut: line boxes are measured to ± 1 px

/** The lit area H: the target grown by p on every side, clamped to the viewport. */
export function hole(t: Rect, p: number, vp: Size): Rect {
  const left = Math.max(0, t.left - p), top = Math.max(0, t.top - p);
  const right = Math.min(vp.width, t.left + t.width + p), bottom = Math.min(vp.height, t.top + t.height + p);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** True when a text line box straddles an edge of H (each line must be wholly inside or wholly outside, ± 1 px). */
export const cutsText = (lines: Rect[], h: Rect): boolean => lines.some((l) => {
  const inside = l.left >= h.left - TOL && l.left + l.width <= h.left + h.width + TOL && l.top >= h.top - TOL && l.top + l.height <= h.top + h.height + TOL;
  const outside = l.left + l.width <= h.left + TOL || l.left >= h.left + h.width - TOL || l.top + l.height <= h.top + TOL || l.top >= h.top + h.height - TOL;
  return !inside && !outside;
});

/** The card's place: below H, else above, else right, else left; whole inside the viewport and under the top bar, 8 px from H. null: re-anchor the target. */
export function placeCard(h: Rect, c: Size, vp: Size, topBar: number): Placed | null {
  const x = Math.min(Math.max(h.left + (h.width - c.width) / 2, 0), vp.width - c.width);
  const y = Math.min(Math.max(h.top + (h.height - c.height) / 2, topBar), vp.height - c.height);
  const tries: Placed[] = [
    { side: 'below', left: x, top: h.top + h.height + GAP },
    { side: 'above', left: x, top: h.top - GAP - c.height },
    { side: 'right', left: h.left + h.width + GAP, top: y },
    { side: 'left', left: h.left - GAP - c.width, top: y },
  ];
  return tries.find((t) => t.left >= 0 && t.top >= topBar && t.left + c.width <= vp.width && t.top + c.height <= vp.height) ?? null;
}
