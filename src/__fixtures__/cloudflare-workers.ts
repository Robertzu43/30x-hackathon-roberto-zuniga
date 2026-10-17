// Vitest stand-in for the workerd-only module 'cloudflare:workers' (alias in vitest.config.ts): just enough to extend.
export class WorkerEntrypoint<Env = unknown> {
  constructor(protected ctx: unknown, protected env: Env) {}
}
