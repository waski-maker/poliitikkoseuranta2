/** Node.js / Docker entry point: `pnpm dev:api` or `node dist/server.mjs`. */
import { serve } from '@hono/node-server';
import { createRuntime } from '@ps/core';
import { registerNodeJobs } from '@ps/core/node';
import { createApp } from './app.ts';
import { serverModules } from './modules.ts';

const rt = await createRuntime({ modules: serverModules, host: 'node' });
registerNodeJobs(rt);
const app = createApp(rt);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  rt.log.info(`API käynnissä: http://localhost:${info.port}/api/v1 (OpenAPI: /api/v1/openapi.json)`);
});

const shutdown = async () => {
  await rt.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
