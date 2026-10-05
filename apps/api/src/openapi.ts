import type { Runtime } from '@ps/core';
import { createRuntime, devAuth, generateKeyB64 } from '@ps/core';
import postgres from 'postgres';
import { createApp } from './app.ts';
import { serverModules } from './modules.ts';

/**
 * Builds the OpenAPI document from the route definitions. Uses a lazy
 * database handle that is never connected, so it runs in CI without Postgres.
 */
export async function buildOpenApiDocument() {
  const sql = postgres('postgres://openapi:openapi@127.0.0.1:1/none', { max: 1, connect_timeout: 1 });
  const rt: Runtime = await createRuntime({
    modules: serverModules,
    host: 'test',
    sql,
    env: {
      DATABASE_URL: 'postgres://openapi:openapi@127.0.0.1:1/none',
      AUTH_PROVIDER: 'dev',
      AUTH_JWT_SECRET: 'openapi-dump-openapi-dump-openapi-dump',
      SETTINGS_ENCRYPTION_KEY: generateKeyB64(),
      LOG_LEVEL: 'error',
      API_PUBLIC_URL: 'http://localhost:8787',
    },
    forceMemoryStorage: true,
  });
  const app = createApp(rt, { auth: devAuth({ secret: 'openapi-dump-openapi-dump-openapi-dump' }) });
  const res = await app.request('/api/v1/openapi.json');
  const doc = (await res.json()) as { paths?: Record<string, unknown>; servers?: unknown };
  doc.servers = [{ url: '/api/v1' }];
  await sql.end({ timeout: 0 }).catch(() => {});
  return doc;
}
