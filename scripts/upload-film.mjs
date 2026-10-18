/* global process, console, fetch, URL */ // Node script: eslint.config.js declares no Node globals
// AC-114 (R-169): host the launch film in the PUBLIC Supabase Storage bucket `demo`. Workers Static Assets answer a Range
// request with 200 and the whole file, and Safari and iPhone refuse to play a video without 206; Supabase Storage answers ranges.
//   node scripts/upload-film.mjs
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Creates the bucket if it is missing, uploads web/public/demo/thesaurus-launch.mp4
// as an upsert (idempotent and additive: nothing is ever removed) and prints only the public URL, which is `src` in
// web/public/demo/video.json. Never prints the key.
import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';

const NAME = 'thesaurus-launch.mp4';
const FILM = new URL(`../web/public/demo/${NAME}`, import.meta.url);
const BUCKET = { id: 'demo', name: 'demo', public: true, file_size_limit: 31457280, allowed_mime_types: ['video/mp4'] }; // 30 MB; the film is 19.5 MB

/** Returns the exit code. fetch, log and err are injected so a test never touches the real Storage. */
export async function main({ env, fetch, file = FILM, log, err }) {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (missing.length) { err(`upload-film: missing env: ${missing.join(', ')}`); return 2; }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const api = `${env.SUPABASE_URL}/storage/v1`;
  const call = (path, init) => fetch(`${api}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, ...init?.headers } });
  const must = async (res, step) => { if (!res.ok) throw new Error(`${step}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); };
  try {
    const bucket = await call(`/bucket/${BUCKET.id}`);
    // Supabase answers a missing bucket with 400 (body statusCode "404") or 404; any other failure stops here.
    if (bucket.status === 400 || bucket.status === 404) await must(await call('/bucket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(BUCKET) }), 'create bucket');
    else await must(bucket, 'get bucket');
    await must(await call(`/object/${BUCKET.id}/${NAME}`, { method: 'POST', headers: { 'x-upsert': 'true', 'content-type': 'video/mp4', 'cache-control': 'max-age=3600' }, body: createReadStream(file), duplex: 'half' }), 'upload');
    log(`${api}/object/public/${BUCKET.id}/${NAME}`);
    return 0;
  } catch (e) {
    err(`upload-film: ${[e.message, e.cause?.message].filter(Boolean).join(': ').replaceAll(key, '[key]')}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main({ env: process.env, fetch, log: console.log, err: console.error }));
