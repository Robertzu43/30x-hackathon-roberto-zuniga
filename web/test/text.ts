// getByText matches an element's own text nodes only; a sentence with a `data-user` span inside is split in two. This matches the
// element whose whole text is `s` and that holds some of it directly (so a wrapper with the same textContent does not match too).
export const sentence = (s: string | RegExp) => (_: string, el: Element | null) =>
  !!el && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim() !== '') && (typeof s === 'string' ? el.textContent === s : s.test(el.textContent ?? ''));
