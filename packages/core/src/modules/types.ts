import type { AppConfig } from '../config.ts';
import type { Actor, Sql, Tx } from '../db/client.ts';
import type { Logger } from '../util/log.ts';
import type { ModuleManifest } from './manifest.ts';
import type { ModuleRegistry } from './registry.ts';
import type { EventBus, Subscription } from '../events/bus.ts';
import type { JobDefinition, JobRegistry, Job } from '../jobs/queue.ts';
import type { SyncRegistry, SyncRunResult, SyncSourceDefinition } from '../sync/framework.ts';
import type { ServiceRegistry } from '../services/registry.ts';
import type { AiService } from '../ai/service.ts';
import type { SettingsStore } from '../settings/store.ts';
import type { SearchTypeRegistry } from '../search/service.ts';
import type { ModuleRouter } from '../http.ts';
import type { PromptTemplate } from '../ai/prompts/index.ts';
import type { BackupUpgrader } from '../backup/module-backup.ts';
import type { CurrentUser } from '../auth/users.ts';
import type { HttpClient } from '../sync/http.ts';

/** Everything a module gets from the core. Modules never create their own connections or clients. */
export interface ModuleContext {
  config: AppConfig;
  sql: Sql;
  log: Logger;
  registry: ModuleRegistry;
  events: EventBus;
  jobs: JobRegistry;
  sync: SyncRegistry;
  searchTypes: SearchTypeRegistry;
  services: ServiceRegistry;
  settings: SettingsStore;
  ai(): Promise<AiService>;
  /** Runs fn as the given actor (RLS applies for users). */
  withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Queues a job and dispatches it to the configured runner. */
  startJob(input: {
    type: string;
    payload?: Record<string, unknown>;
    user?: CurrentUser | null;
  }): Promise<Job>;
  /** Runs a registered sync source now (with run log). */
  runSync(
    sourceId: string,
    params?: Record<string, unknown>,
    opts?: { jobId?: string; triggeredBy?: string | null },
  ): Promise<SyncRunResult>;
  /** HTTP client for a data source, configured with user agent, rate limit and retries. */
  http(source: 'eduskunta' | string): HttpClient;
}

/** Server-side part of a module (API, sync, jobs, events). */
export interface ServerModule<Api = unknown> {
  manifest: ModuleManifest;
  /** Typed public API other modules call through the registry. */
  createApi(ctx: ModuleContext): Api;
  /** REST endpoints, mounted at /api/v1{manifest.apiBasePath}. */
  registerRoutes?(router: ModuleRouter, ctx: ModuleContext): void;
  subscriptions?(ctx: ModuleContext): Subscription[];
  syncSources?(ctx: ModuleContext): SyncSourceDefinition[];
  jobs?(ctx: ModuleContext): JobDefinition[];
  prompts?: PromptTemplate[];
  /** Initial data (idempotent). Run by `pnpm db:seed` and `pnpm run setup`. */
  seed?(ctx: ModuleContext): Promise<void>;
  /** Converts module backups from older schema versions. */
  upgradeBackup?: BackupUpgrader;
}

export function defineServerModule<Api>(m: ServerModule<Api>): ServerModule<Api> {
  return m;
}
