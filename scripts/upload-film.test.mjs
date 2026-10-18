/* global URL, process, Response, Headers, Buffer */
// AC-114 (R-169): scripts/upload-film.mjs against a fake fetch. A test never touches the real Storage.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from './upload-film.mjs';

const SCRIPT = fileURLToPath(new URL('./upload-film.mjs', import.meta.url));
const KEY = 'not-a-real-key-SENTINEL-4f9c'; // must never reach stdout or stderr
const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY };
const API = '/storage/v1';
const GET_BUCKET = `GET ${API}/bucket/demo`;
const POST_BUCKET = `POST ${API}/bucket`;
const POST_FILM = `POST ${API}/object/demo/thesaurus-launch.mp4`;
const PUBLIC_URL = 'https://proj.supabase.co/storage/v1/object/public/demo/thesaurus-launch.mp4';
const BYTES = Buffer.from('ftypisom-fake-mp4-bytes-'.repeat(5000)); // 120 kB: several stream chunks
const film = join(mkdtempSync(join(tmpdir(), 'upload-film-')), 'film.mp4');
writeFileSync(film, BYTES);

// A fake Storage. `bucket`: the HTTP status of GET /bucket/demo. `upload`: the Response to the object POST.
// Every call is recorded; a streamed body is drained into `bytes`. Any other call answers 500, so a stray one shows.
async function run({ env = ENV, bucket = 200, upload = () => new Response('{"Key":"demo/thesaurus-launch.mp4"}'), fail } = {}) {
  const calls = [];
  const log = [];
  const err = [];
  const fetch = async (url, init = {}) => {
    if (fail) throw fail;
    const call = { id: `${init.method ?? 'GET'} ${new URL(url).pathname}`, headers: Object.fromEntries(new Headers(init.headers)), body: init.body, duplex: init.duplex };
    if (call.body && typeof call.body !== 'string') {
      const chunks = [];
      for await (const c of call.body) chunks.push(c);
      call.bytes = Buffer.concat(chunks);
    }
    calls.push(call);
    if (call.id === GET_BUCKET) return new Response(bucket === 200 ? '{"id":"demo"}' : '{"error":"no bucket"}', { status: bucket });
    if (call.id === POST_BUCKET) return new Response('{"name":"demo"}');
    if (call.id === POST_FILM) return upload();
    return new Response(`unexpected ${call.id}`, { status: 500 });
  };
  const code = await main({ env, fetch, file: film, log: (l) => log.push(l), err: (l) => err.push(l) });
  return { code, calls, ids: calls.map((c) => c.id), log, err, out: [...log, ...err].join('\n') };
}

describe('upload-film (AC-114, R-169)', () => {
  it('bucket present: no create call, the film is uploaded, only the public URL is printed', async () => {
    const r = await run({ bucket: 200 });
    expect(r.ids).toEqual([GET_BUCKET, POST_FILM]);
    expect(r.code).toBe(0);
    expect(r.log).toEqual([PUBLIC_URL]);
    expect(r.err).toEqual([]);
  });

  it.each([404, 400])('bucket missing (HTTP %i; Supabase answers 400 for a missing bucket): created public, video/mp4 only, 30 MB, then uploaded', async (status) => {
    const r = await run({ bucket: status });
    expect(r.ids).toEqual([GET_BUCKET, POST_BUCKET, POST_FILM]);
    expect(r.calls[1].headers['content-type']).toBe('application/json');
    expect(JSON.parse(r.calls[1].body)).toEqual({ id: 'demo', name: 'demo', public: true, file_size_limit: 31457280, allowed_mime_types: ['video/mp4'] });
    expect(r.code).toBe(0);
    expect(r.log).toEqual([PUBLIC_URL]);
  });

  it('the upload is an upsert of video/mp4, authorised by the service key, and streams the file bytes', async () => {
    const r = await run();
    const up = r.calls.at(-1);
    expect(up.headers).toMatchObject({ 'x-upsert': 'true', 'content-type': 'video/mp4', 'cache-control': 'max-age=3600' });
    expect(typeof up.body).not.toBe('string'); // streamed, never read into a string or a buffer
    expect(Buffer.isBuffer(up.body)).toBe(false);
    expect(up.duplex).toBe('half');
    expect(up.bytes.equals(BYTES)).toBe(true);
    for (const c of r.calls) expect(c.headers).toMatchObject({ apikey: KEY, authorization: `Bearer ${KEY}` });
  });

  it('the service key does not reach stdout or stderr on success', async () => {
    expect((await run()).out).not.toContain(KEY);
  });

  it('a failed upload exits 1 naming the step and the status, and hides a key the server echoes back', async () => {
    const r = await run({ upload: () => new Response(`bad token ${KEY}`, { status: 403 }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toMatch(/upload.*403/);
    expect(r.out).not.toContain(KEY);
    expect(r.log).toEqual([]);
  });

  it('a bucket lookup that answers neither 200 nor missing (401) stops: exit 1, nothing created, nothing uploaded', async () => {
    const r = await run({ bucket: 401 });
    expect(r.code).toBe(1);
    expect(r.ids).toEqual([GET_BUCKET]);
    expect(r.err.join('\n')).toMatch(/401/);
  });

  it('a network failure says why, not just «fetch failed»', async () => {
    const r = await run({ fail: Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND proj.supabase.co') }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('ENOTFOUND');
  });

  it('missing env: exit 2 naming the variable, no fetch call, no value printed', async () => {
    const r = await run({ env: { SUPABASE_SERVICE_ROLE_KEY: KEY } });
    expect(r.code).toBe(2);
    expect(r.ids).toEqual([]);
    expect(r.err.join('\n')).toContain('SUPABASE_URL');
    expect(r.out).not.toContain(KEY);
  });

  it('the CLI exits non-zero without SUPABASE_URL and prints no value', () => {
    const p = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, SUPABASE_SERVICE_ROLE_KEY: KEY }, encoding: 'utf8' });
    expect(p.status).toBe(2);
    expect(p.stderr).toContain('SUPABASE_URL');
    expect(p.stdout + p.stderr).not.toContain(KEY);
  });

  it('the script has no delete anywhere: upsert only', () => {
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/delete/i);
  });
});
