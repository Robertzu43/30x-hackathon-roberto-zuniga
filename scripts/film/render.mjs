/* global process, console, document, URL */ // Node + page code; eslint.config.js declares no globals
// Renders docs/film/storyboard.html at 1920x1080 into a raw video for assemble.sh (AC-111, R-155).
//   node scripts/film/render.mjs <out-dir> [--captures <dir>] [--frames]
// Default: Playwright recordVideo -> <out-dir>/raw.webm, plus <out-dir>/raw.trim (seconds of blank lead-in to cut).
// --frames: the R-155 fallback; every CSS animation is paused and stepped by currentTime at 1/30 s, one screenshot per
// frame, piped to ffmpeg -> <out-dir>/raw.mp4 (near-lossless, trim 0). Deterministic, slower.
// --captures: serve that directory as docs/film/captures/ (phase A placeholders); default is the committed captures.
import { execSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SIZE = { width: 1920, height: 1080 };
const FPS = 30;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : null;
if (!out) { console.error('usage: render.mjs <out-dir> [--captures <dir>] [--frames]'); process.exit(2); }
const capIdx = args.indexOf('--captures');
const captures = capIdx > 0 ? resolve(args[capIdx + 1]) : join(ROOT, 'docs/film/captures');
const frames = args.includes('--frames');
mkdirSync(out, { recursive: true });

// Static server: the repository root, with docs/film/captures/ mapped to --captures. Read-only, local, GET only.
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = path.startsWith('/docs/film/captures/') ? join(captures, path.slice('/docs/film/captures/'.length)) : join(ROOT, path);
  if (req.method !== 'GET' || !(file.startsWith(ROOT) || file.startsWith(captures)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/docs/film/storyboard.html`;

const { chromium } = await import('playwright').catch(() => createRequire(join(execSync('npm root -g').toString().trim(), '_'))('playwright'));
const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, ...(frames ? {} : { recordVideo: { dir: out, size: SIZE } }) });
  const opened = Date.now();
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`${r.url()} failed`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.url()} ${r.status()}`); });
  await page.goto(url);
  const ready = await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60_000 }).catch((e) => { errors.push(e.message); return null; });
  if (!ready) throw new Error(`storyboard never became ready:\n${errors.join('\n')}`);
  const length = Number(await ready.jsonValue());
  if (errors.length) throw new Error(`storyboard errors (R-158 wants 0):\n${errors.join('\n')}`);

  if (frames) {
    const total = Math.round(length * FPS);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', join(out, 'raw.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error(`ffmpeg exited ${c}`)) : r())));
    for (let i = 0; i < total; i++) {
      await page.evaluate((ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }, (i * 1000) / FPS);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % (FPS * 10) === 0) console.log(`frame ${i}/${total}`);
    }
    ff.stdin.end();
    await done;
    writeFileSync(join(out, 'raw.trim'), '0\n');
  } else {
    const lead = (Date.now() - opened) / 1000; // the video starts with the page; the film starts with .play
    await page.evaluate(() => document.body.classList.add('play'));
    await page.waitForTimeout(length * 1000 + 500);
    await context.close();
    const webm = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'raw.webm');
    renameSync(join(out, webm), join(out, 'raw.webm'));
    writeFileSync(join(out, 'raw.trim'), `${lead.toFixed(3)}\n`);
  }
  if (errors.length) throw new Error(`storyboard errors while playing:\n${errors.join('\n')}`);
  console.log(`rendered ${length} s into ${out} (${frames ? 'frame by frame' : 'recordVideo'}), 0 console errors`);
} finally {
  await browser.close();
  server.close();
}
