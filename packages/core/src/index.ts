// Public surface of @ps/core. Runs on Node, Deno (Supabase Edge) and Bun.
export * from './config.ts';
export * from './db/client.ts';
export * from './db/migrate.ts';
export * from './util/errors.ts';
export * from './util/log.ts';
export * from './util/crypto.ts';
export * from './util/time.ts';
export * from './modules/manifest.ts';
export * from './modules/registry.ts';
export * from './modules/types.ts';
export * from './events/bus.ts';
export * from './jobs/queue.ts';
export * from './sync/framework.ts';
export * from './sync/http.ts';
export * from './sync/upsert.ts';
export * from './search/service.ts';
export * from './settings/store.ts';
export * from './notifications/notify.ts';
export * from './ai/types.ts';
export * from './ai/service.ts';
export * from './ai/pricing.ts';
export * from './ai/chunking.ts';
export * from './ai/prompts/index.ts';
export * from './ai/providers/mock.ts';
export * from './export/index.ts';
export * from './services/types.ts';
export * from './services/registry.ts';
export { verifyFileToken, memoryStorage } from './services/adapters/storage.ts';
export * from './auth/adapters.ts';
export * from './auth/users.ts';
export * from './auth/permissions.ts';
export * from './audit/history.ts';
export * from './backup/retention.ts';
export * from './backup/module-backup.ts';
export * from './http.ts';
export * from './runtime.ts';
export * from './crud.ts';

/**
 * Typed public APIs of modules. Each module augments this interface:
 *   declare module '@ps/core' { interface ModuleApis { '1.001': MpsApi } }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModuleApis {}
