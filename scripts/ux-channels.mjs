/* global document, getComputedStyle, NodeFilter */ // code that runs in the page
// Gate row 1.channels (AC-123). The Canales card's three [data-channel] rows, in order portal, email, telegram:
//   content box >= 600 px: one row of three, equal widths and level tops (+-1 px); below: stacked, each as wide as the content box;
//   and no row's text crosses its box. The threshold is the card's content box, not the viewport.
// ux-gate.mjs registers it on inbox, trial and inbox-empty: `await checkChannels(page)` returns one result row like the gate's own.
const ORDER = 'portal,email,telegram';

// In the page: raw measurements only, judged in Node. Self-contained (it is serialised).
export function measureChannels() {
  const rows = [...document.querySelectorAll('[data-channel]')].filter((el) => el.checkVisibility());
  if (!rows.length) return { content: 0, rows: [] };
  const card = rows[0].closest('[data-block]') ?? rows[0].parentElement;
  const cs = getComputedStyle(card), px = (p) => parseFloat(cs[p]) || 0;
  const content = card.getBoundingClientRect().width - px('paddingLeft') - px('paddingRight') - px('borderLeftWidth') - px('borderRightWidth');
  const srOnly = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.position === 'absolute' && r.width <= 1 && r.height <= 1; };
  return {
    content,
    rows: rows.map((row) => {
      const r = row.getBoundingClientRect(), b = getComputedStyle(row);
      const inner = { left: r.left + (parseFloat(b.borderLeftWidth) || 0) - 1, right: r.right - (parseFloat(b.borderRightWidth) || 0) + 1 };
      const over = [];
      const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !el.checkVisibility()) continue;
        let hidden = false;
        for (let p = el; p && p !== row; p = p.parentElement) hidden ||= srOnly(p);
        if (hidden) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const t = range.getBoundingClientRect();
        if (t.right > inner.right || t.left < inner.left) over.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''}`);
      }
      return { id: row.getAttribute('data-channel'), left: r.left, top: r.top, width: r.width, right: r.right, over };
    }),
  };
}

export function judgeChannels(m) {
  const out = (status, value, measured) => ({ id: '1.channels', status, value, measured });
  const ids = m.rows.map((r) => r.id).join(',');
  if (ids !== ORDER) return out('fail', 1, `rows are ${ids.replaceAll(',', ', ') || 'none'}, want ${ORDER.replaceAll(',', ', ')}`);
  const across = m.content >= 600, [a] = m.rows, bad = [];
  m.rows.forEach((r, i) => {
    if (across) {
      if (Math.abs(r.width - a.width) > 1) bad.push(`${r.id} width ${Math.round(r.width)} vs ${Math.round(a.width)}`);
      if (Math.abs(r.top - a.top) > 1) bad.push(`${r.id} top ${Math.round(r.top)} vs ${Math.round(a.top)}`);
    } else {
      if (Math.abs(r.width - m.content) > 1) bad.push(`${r.id} width ${Math.round(r.width)} vs content ${Math.round(m.content)}`);
      if (Math.abs(r.left - a.left) > 1) bad.push(`${r.id} left ${Math.round(r.left)} vs ${Math.round(a.left)}`);
      if (i && r.top <= m.rows[i - 1].top) bad.push(`${r.id} is not below ${m.rows[i - 1].id}`);
    }
    if (r.over.length) bad.push(`${r.id} text crosses its box: ${r.over.slice(0, 3).join(', ')}`);
  });
  const shape = across ? `three across, ${Math.round(a.width)} px each, content ${Math.round(m.content)} px` : `stacked, ${Math.round(m.content)} px wide each`;
  return bad.length ? out('fail', bad.length, `${shape}: ${bad.join('; ')}`) : out('pass', 0, shape);
}

export const checkChannels = async (page) => judgeChannels(await page.evaluate(measureChannels));
