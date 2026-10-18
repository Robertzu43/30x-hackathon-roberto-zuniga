import { describe, expect, it } from 'vitest';
import { cutsText, hole, PAD, placeCard, type Rect } from './components/spotlight';

const vp = { width: 1440, height: 900 };
const r = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });
const gap = (a: Rect, b: Rect) => Math.max(a.left - (b.left + b.width), b.left - (a.left + a.width), a.top - (b.top + b.height), b.top - (a.top + a.height));

describe('hole (AC-117 4.spot)', () => {
  it('grows the target by p on every side, and p is inside 8..12', () => {
    expect(PAD).toBeGreaterThanOrEqual(8);
    expect(PAD).toBeLessThanOrEqual(12);
    expect(hole(r(100, 200, 300, 80), 10, vp)).toEqual(r(90, 190, 320, 100));
  });
  it('is clamped to the viewport', () => {
    expect(hole(r(4, 3, 100, 50), 10, vp)).toEqual(r(0, 0, 114, 63));
    expect(hole(r(1400, 860, 40, 40), 10, vp)).toEqual(r(1390, 850, 50, 50));
  });
  it('has no negative size for a target wholly outside the viewport', () => {
    const h = hole(r(100, 1500, 50, 50), 10, vp);
    expect(h.width).toBeGreaterThanOrEqual(0);
    expect(h.height).toBeGreaterThanOrEqual(0);
  });
});

describe('cutsText (AC-117 4.textcut)', () => {
  const h = r(100, 100, 300, 200); // x 100..400, y 100..300
  it('is false for a line wholly inside or wholly outside', () => {
    expect(cutsText([r(120, 120, 200, 20)], h)).toBe(false);
    expect(cutsText([r(120, 400, 200, 20)], h)).toBe(false);
    expect(cutsText([r(500, 120, 200, 20)], h)).toBe(false);
  });
  it('is true when a line box straddles any edge', () => {
    expect(cutsText([r(350, 120, 200, 20)], h)).toBe(true); // right edge
    expect(cutsText([r(0, 120, 200, 20)], h)).toBe(true); // left edge
    expect(cutsText([r(120, 90, 200, 20)], h)).toBe(true); // top edge
    expect(cutsText([r(120, 290, 200, 20)], h)).toBe(true); // bottom edge
  });
  it('is true when one line among many straddles', () => {
    expect(cutsText([r(120, 120, 200, 20), r(120, 400, 200, 20), r(120, 295, 200, 20)], h)).toBe(true);
  });
  it('allows 1 px of tolerance and no more', () => {
    expect(cutsText([r(120, 299, 200, 20)], h)).toBe(false); // 1 px inside the hole counts as outside
    expect(cutsText([r(120, 298, 200, 20)], h)).toBe(true);
    expect(cutsText([r(120, 80, 200, 21)], h)).toBe(false); // 1 px into the hole
  });
});

describe('placeCard (AC-117 4.cover)', () => {
  const card = { width: 400, height: 200 };
  const bar = 56;
  const ok = (h: Rect, c: Rect) => {
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.top).toBeGreaterThanOrEqual(bar);
    expect(c.left + c.width).toBeLessThanOrEqual(vp.width);
    expect(c.top + c.height).toBeLessThanOrEqual(vp.height);
    expect(gap(c, h)).toBeGreaterThanOrEqual(8);
  };
  it('goes below the hole when it fits', () => {
    const h = r(500, 100, 300, 100);
    expect(placeCard(h, card, vp, bar)).toMatchObject({ side: 'below', top: 208 });
  });
  it('goes above when below does not fit', () => {
    const h = r(500, 600, 300, 200);
    expect(placeCard(h, card, vp, bar)).toMatchObject({ side: 'above', top: 392 });
  });
  it('goes right when neither below nor above fits', () => {
    const h = r(100, 60, 300, 830);
    expect(placeCard(h, card, vp, bar)).toMatchObject({ side: 'right', left: 408 });
  });
  it('goes left when only left fits', () => {
    const h = r(1000, 60, 430, 830);
    expect(placeCard(h, card, vp, bar)).toMatchObject({ side: 'left', left: 592 });
  });
  it('returns null when nothing fits, so the target must be re-anchored', () => {
    expect(placeCard(r(10, 60, 1420, 830), card, vp, bar)).toBeNull();
    expect(placeCard(r(500, 100, 100, 100), { width: 1500, height: 100 }, vp, bar)).toBeNull();
  });
  it('keeps the card below the top bar and inside the viewport sideways', () => {
    const h = r(10, 100, 100, 100);
    const c = placeCard(h, card, vp, bar)!;
    expect(c.left).toBe(0);
    ok(h, { ...c, ...card });
  });
  it('never intersects the hole and keeps 8 px, over a sweep of holes', () => {
    for (let x = 0; x <= 1400; x += 140) for (let y = 56; y <= 880; y += 82) for (const [w, hh] of [[40, 40], [300, 100], [700, 300], [200, 780]] as const) {
      const h = hole(r(x + 10, y + 10, w, hh), 10, vp);
      const c = placeCard(h, card, vp, bar);
      if (c) ok(h, { left: c.left, top: c.top, ...card });
    }
  });
});
