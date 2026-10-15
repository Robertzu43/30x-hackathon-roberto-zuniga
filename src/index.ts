// Dry run only (branch dryrun/deploy): proves deploy, assets, vars and Supabase REST under RLS.
export default {
  async fetch(req: Request, env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }): Promise<Response> {
    if (new URL(req.url).pathname !== "/api/health") return new Response("not found", { status: 404 });
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/dryrun_ping?select=id`, { headers: { apikey: env.SUPABASE_ANON_KEY } });
    const body: unknown = await res.json();
    return Response.json({ ok: res.ok, rows: Array.isArray(body) ? body.length : null });
  },
};
