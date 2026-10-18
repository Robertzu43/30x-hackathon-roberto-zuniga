/* global document, navigator, localStorage, location, fetch, FormData, URLSearchParams, setTimeout, addEventListener */
// The vendor portal page (AC-83, AC-84, AC-90). Every value, vendor text and read field included, is set as text
// (textContent, setAttribute), never as HTML (AC-85 item 4). The words come from the boot data the facturas Worker embeds.
const boot = JSON.parse(document.getElementById('boot')?.textContent || '{"view":"unavailable","t":{"es":{},"en":{}}}');
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 20000;
const FILE_TYPES = /\.(pdf|png|jpe?g)$/i;
const MESSAGE_VIEWS = { not_found: 'portal.not_found', invalid: 'portal.status_invalid', rate_status: 'portal.error.rate_status', unavailable: 'portal.error.unavailable' };
const SEND_ERRORS = { not_found: 'portal.not_found', file: 'portal.error.file', text: 'portal.error.text', rate_ip: 'portal.error.rate_ip', rate_company: 'portal.error.rate_company' };

const stored = () => { try { return localStorage.getItem('portal.lang'); } catch { return null; } };
const remember = (l) => { try { localStorage.setItem('portal.lang', l); } catch { /* private mode: the choice lasts this page only */ } };
// Spanish unless the vendor chose English (?lang=en or the switch, remembered on this device).
const queried = new URLSearchParams(location.search).get('lang');
let lang = [queried, stored()].find((l) => l === 'es' || l === 'en') || 'es';
if (queried === lang) remember(lang);
// {company}. after «Andina Labs Inc.» keeps one period.
const tr = (key, vars = {}) => (boot.t[lang][key] ?? '').replace(/\{(\w+)\}(\.?)/g, (m, k, dot) => {
  const v = String(vars[k] ?? `{${k}}`);
  return v.endsWith('.') ? v : v + dot;
});

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  e.append(...children);
  return e;
}

const main = document.getElementById('main');
const company = boot.company ?? '';
const messages = [{ from: 'agent', keys: ['portal.greeting', 'portal.hint'] }];
let file = null;
let ui = null; // the chat page's lasting nodes, built once so a typed message survives a language switch

// R-102: copy the status URL; «Copiado» for 2 s, or the press-and-hold fallback, announced politely.
function copyButton(link) {
  const b = el('button', { type: 'button', class: 'copy', text: tr('portal.copy') });
  b.addEventListener('click', async () => {
    let key = 'portal.copied';
    try { await navigator.clipboard.writeText(link); } catch { key = 'portal.copy_failed'; } // no clipboard API counts as refused
    b.textContent = ui.live.textContent = tr(key);
    if (key === 'portal.copied') setTimeout(() => { b.textContent = tr('portal.copy'); ui.live.textContent = ''; }, 2000);
  });
  return b;
}

// R-131: the payee and the number the vendor sent are data (data-user); the label before them, the amount the page formats and the status words are copy.
const DATA_LINES = ['portal.reply.payee', 'portal.reply.number'];
function parts(text) {
  const t = boot.t[lang];
  const prefix = DATA_LINES.map((k) => (t[k] ?? '').split('{value}')[0]).find((p) => p && text.startsWith(p));
  const value = prefix ? text.slice(prefix.length) : '';
  return value && value !== t['portal.reply.unknown'] ? [prefix, el('span', { 'data-user': '', text: value })] : [text];
}

function line(text, reply) {
  const prefix = (boot.t[lang]['portal.reply.status'] ?? '').split('{status}')[0];
  return reply && prefix && text.startsWith(prefix) ? el('p', {}, prefix, el('strong', { text: text.slice(prefix.length) })) : el('p', {}, ...parts(text));
}

function bubble(m) {
  const b = el('article', { class: `bubble ${m.from}` });
  if (m.from === 'me') b.append(el('span', { class: 'sr-only', text: `${tr('portal.you')}: ` }));
  const lines = m.lines ? m.lines[lang] : m.keys ? m.keys.map((k) => tr(k, { company })) : [m.text];
  b.append(...lines.filter(Boolean).map((text) => (m.from === 'me' ? el('p', { 'data-user': '', text }) : line(text, !!m.lines))));
  if (m.file) b.append(el('p', { class: 'file', 'data-user': '', text: m.file }));
  if (m.link) b.append(el('p', { text: tr('portal.reply.link') }), el('p', {}, el('a', { href: m.link, text: m.link })), copyButton(m.link));
  if (m.pending) b.classList.add('pending');
  return b;
}

const renderLog = () => {
  ui.log.replaceChildren(...messages.map(bubble));
  ui.log.lastElementChild?.scrollIntoView?.({ block: 'end' });
};
const add = (m) => { messages.push(m); renderLog(); };

function setFile(f) {
  file = f;
  ui.chip.hidden = !f;
  ui.chipName.textContent = f ? f.name : '';
  ui.chipName.toggleAttribute('data-user', !!f); // R-131: the file name is data; the remove button beside it is not
  if (!f) ui.fileInput.value = '';
}

function invalid(text, f) {
  if (f && (!FILE_TYPES.test(f.name) || !f.size || f.size > MAX_BYTES)) return 'portal.error.file';
  if (text.length > MAX_TEXT || (!f && !text.trim())) return 'portal.error.text';
  return null;
}

async function send(event) {
  event.preventDefault();
  if (ui.send.disabled) return;
  const text = ui.text.value;
  const f = file;
  const bad = invalid(text, f);
  if (bad) return add({ from: 'error', keys: [bad] });
  const wait = { from: 'agent', keys: ['portal.received'], pending: true };
  messages.push({ from: 'me', text: text.trim() ? text : '', file: f?.name }, wait);
  renderLog();
  ui.text.value = '';
  setFile(null);
  ui.send.disabled = true;
  ui.form.setAttribute('aria-busy', 'true');
  let answer;
  try {
    if (navigator.onLine === false) throw new TypeError('offline');
    const body = new FormData();
    if (text) body.append('text', text);
    if (f) body.append('file', f);
    const data = await (await fetch(location.pathname, { method: 'POST', body })).json().catch(() => ({}));
    answer = data.ok && /^\/estado\/[\w-]+$/.test(data.status_path)
      ? { from: 'agent', lines: data.reply, link: location.origin + data.status_path }
      : { from: 'error', keys: [SEND_ERRORS[data.error] || 'portal.error.failed'] };
  } catch {
    answer = { from: 'error', keys: ['portal.error.offline'] };
  }
  if (answer.from === 'error') { ui.text.value = text; if (f) setFile(f); } // nothing is lost: send it again
  messages.splice(messages.indexOf(wait), 1, answer);
  renderLog();
  ui.send.disabled = false;
  ui.form.removeAttribute('aria-busy');
}

const ICON_NS = 'http://www.w3.org/2000/svg';
function clip() {
  const svg = document.createElementNS(ICON_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ICON_NS, 'path');
  path.setAttribute('d', 'M20 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4');
  svg.append(path);
  return svg;
}

function buildChat() {
  const fileInput = el('input', { type: 'file', id: 'file', accept: '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', hidden: '' });
  const u = {
    title: el('h1'), log: el('div', { class: 'log', role: 'log', 'aria-live': 'polite' }), live: el('p', { class: 'sr-only', 'aria-live': 'polite' }), fileInput,
    attach: el('button', { type: 'button', class: 'attach' }, clip()),
    label: el('label', { for: 'msg', class: 'sr-only' }), text: el('textarea', { id: 'msg', rows: '1' }),
    send: el('button', { type: 'submit', class: 'primary' }), chipName: el('span'), remove: el('button', { type: 'button', class: 'remove', text: '×' }),
  };
  u.chip = el('p', { class: 'chip', hidden: '' }, u.chipName, u.remove);
  u.form = el('form', { class: 'composer', novalidate: '' }, u.chip, el('div', { class: 'row' }, u.attach, fileInput, u.label, u.text, u.send));
  u.attach.addEventListener('click', () => fileInput.click());
  u.remove.addEventListener('click', () => setFile(null));
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0] ?? null;
    const bad = f && invalid('', f);
    if (bad) { setFile(null); add({ from: 'error', keys: [bad] }); } else setFile(f);
  });
  u.text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) u.form.requestSubmit(); });
  u.form.addEventListener('submit', send);
  main.append(u.title, u.log, u.live, u.form);
  return u;
}

function paintChat() {
  ui.title.textContent = tr('portal.title', { company });
  ui.attach.setAttribute('aria-label', tr('portal.attach'));
  ui.fileInput.setAttribute('aria-label', tr('portal.attach'));
  ui.remove.setAttribute('aria-label', tr('portal.remove_file'));
  ui.label.textContent = tr('portal.message_label');
  ui.text.setAttribute('placeholder', tr('portal.message_label'));
  ui.send.textContent = tr('portal.send');
  renderLog();
}

// UX-08: offline, the page keeps what it showed and says how to get a fresh status.
const offline = el('p', { class: 'state', role: 'status' });
const paintOffline = () => {
  offline.textContent = tr('portal.status_offline');
  offline.hidden = navigator.onLine !== false;
};

// The status words' meaning picks the outcome colours (approved palette): the words come from these same templates.
const TONES = { approved: 'pay', needs_approval: 'escalate', duplicate: 'stop', terms: 'stop', rejected: 'stop' };
const tone = (s) => Object.entries(TONES).find(([k]) => (boot.t.es[`portal.status.${k}`] ?? '').replace('{company}', s.company) === s.status.es)?.[1];

function paintStatus() {
  const s = boot.status;
  paintOffline();
  const when = new Intl.DateTimeFormat(lang === 'es' ? 'es-CO' : 'en-US', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(s.updated_at));
  const head = el('header', { class: 'status-head' }, el('h1', { text: s.status[lang] }), el('p', { class: 'company', text: tr('portal.status_title', { company: s.company }) }));
  if (tone(s)) head.dataset.tone = tone(s);
  main.replaceChildren(offline, el('article', { class: 'card' },
    head,
    el('h2', { text: tr('portal.status_read') }),
    el('ul', {}, ...s.read[lang].map((text) => el('li', {}, ...parts(text)))),
    el('p', { class: 'meta', text: tr('portal.updated', { date: when }) })));
}

function paint() {
  document.documentElement.lang = lang;
  for (const b of document.querySelectorAll('button[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  document.querySelector('.lang')?.setAttribute('aria-label', tr('portal.lang_label'));
  if (boot.view === 'chat') {
    document.title = `${tr('portal.title', { company })} · Thesaurus`;
    paintChat();
  } else if (boot.view === 'status') {
    document.title = `${boot.status.status[lang]} · Thesaurus`;
    paintStatus();
  } else {
    // The first sentence is the heading; the next step («Pídele…», «Revisa…») reads as text under it.
    const [first, ...next] = tr(MESSAGE_VIEWS[boot.view] || 'portal.error.unavailable').split(/(?<=\.) /);
    document.title = 'Thesaurus';
    main.replaceChildren(el('article', { class: 'message' }, el('h1', { text: first }), ...(next.length ? [el('p', { text: next.join(' ') })] : [])));
  }
}

for (const b of document.querySelectorAll('button[data-lang]')) {
  b.addEventListener('click', () => {
    lang = b.dataset.lang;
    remember(lang);
    paint();
  });
}
if (boot.view === 'chat') ui = buildChat();
if (boot.view === 'status') for (const e of ['online', 'offline']) addEventListener(e, paintOffline);
paint();
