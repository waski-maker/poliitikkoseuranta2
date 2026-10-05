/**
 * Supabase Edge Function / Deno entry. Bundled by `pnpm build:edge` into
 * supabase/functions/api/_bundle/api.mjs; supabase/functions/api/index.ts is
 * a thin wrapper that serves it. No Supabase-specific code lives here.
 */
import { createRuntime, readEnv } from '@ps/core';
import { createApp } from './app.ts';
import { serverModules } from './modules.ts';

let appPromise: Promise<ReturnType<typeof createApp>> | null = null;

function getApp() {
  appPromise ??= createRuntime({
    modules: serverModules,
    host: 'edge',
    env: { ...readEnv(), DATABASE_POOL_MAX: '1' },
  }).then((rt) => createApp(rt));
  return appPromise;
}

export async function handler(req: Request): Promise<Response> {
  const app = await getApp();
  return app.fetch(req);
}
