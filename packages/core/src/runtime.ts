import { loadConfig, readEnv, type AppConfig } from './config.ts';
import { createDb, withActor, type Actor, type Sql, SYSTEM } from './db/client.ts';
import { createLogger, type Logger } from './util/log.ts';
import { ModuleRegistry } from './modules/registry.ts';
import type { ModuleContext, ServerModule } from './modules/types.ts';
import { EventBus } from './events/bus.ts';
import { JobRegistry, enqueueJob, claimJob, executeJob, type Job } from './jobs/queue.ts';
import { SyncRegistry, runSync } from './sync/framework.ts';
import { HttpClient } from './sync/http.ts';
import { SearchTypeRegistry } from './search/service.ts';
import { SettingsStore } from './settings/store.ts';
import { ServiceRegistry } from './services/registry.ts';
import { AiService, AI_SETTINGS_KEY, AI_SETTINGS_SCOPE, defaultAiSettings } from './ai/service.ts';
import type { AiSettings, ProviderConfig } from './ai/types.ts';
import { registerPrompt } from './ai/prompts/index.ts';
import { notify, notifyAdmins } from './notifications/notify.ts';
import { requirePermission } from './auth/permissions.ts';
import { NotFoundError, errorMessage } from './util/errors.ts';
import { runInBackground } from './util/time.ts';
import { registerCoreJobs } from './jobs/core-jobs.ts';

export interface RuntimeOptions {
  env?: Record<string, string | undefined>;
  config?: AppConfig;
  modules: ServerModule[];
  sql?: Sql;
  log?: Logger;
  fetch?: typeof fetch;
  /** Where this runtime runs; inline job execution is only allowed in long-lived processes. */
  host: 'node' | 'edge' | 'worker' | 'test';
  forceMemoryStorage?: boolean;
  aiProviderFactory?: ConstructorParameters<typeof AiService>[0]['providerFactory'];
}

export interface Runtime extends ModuleContext {
  host: RuntimeOptions['host'];
  close(): Promise<void>;
  runJobById(jobId: string): Promise<'succeeded' | 'retry' | 'failed' | 'not-found'>;
  workQueue(opts?: { maxJobs?: number; types?: string[] }): Promise<number>;
  runSyncSource(
    sourceId: string,
    params?: Record<string, unknown>,
    opts?: { jobId?: string; triggeredBy?: string | null },
  ): ReturnType<typeof runSync>;
  aiSettings(): Promise<AiSettings>;
  invalidateAi(): void;
}

/**
 * Builds the shared runtime used by the API (Edge Function / Node), the
 * worker CLI and tests: one DB pool, settings, services, registries and all
 * modules initialised in dependency order.
 */
export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
  const config = opts.config ?? loadConfig(opts.env ?? readEnv());
  const log = opts.log ?? createLogger(config.LOG_LEVEL, opts.host);
  const sql = opts.sql ?? createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
  const settings = new SettingsStore(sql, config.SETTINGS_ENCRYPTION_KEY);
  const registry = new ModuleRegistry(opts.modules);
  const events = new EventBus();
  const jobs = new JobRegistry();
  const sync = new SyncRegistry();
  const searchTypes = new SearchTypeRegistry();

  // Assigned once below; closures created earlier reference it lazily.
  // eslint-disable-next-line prefer-const
  let runtime!: Runtime;
  const canRunInline = opts.host === 'node' || opts.host === 'worker' || opts.host === 'test';

  const services = await ServiceRegistry.createSafe({
    db: sql,
    config,
    settings,
    log: log.child('services'),
    manifests: registry.manifests(),
    fetch: opts.fetch,
    forceMemory: opts.forceMemoryStorage,
    runJobInline: canRunInline ? (id) => runInBackground(runtime.runJobById(id)) : undefined,
  });

  let aiCache: { at: number; service: AiService; settings: AiSettings } | null = null;
  const aiSettings = async (): Promise<AiSettings> => {
    const stored = await settings.get<AiSettings | null>(AI_SETTINGS_SCOPE, AI_SETTINGS_KEY, null);
    return stored ?? defaultAiSettings(config);
  };
  const apiKey = async (p: ProviderConfig): Promise<string | null> => {
    const stored = await settings.getSecret(AI_SETTINGS_SCOPE, `${p.name}.apiKey`).catch(() => null);
    if (stored) return stored;
    if (p.kind === 'anthropic') return config.ANTHROPIC_API_KEY ?? null;
    if (p.kind === 'openai') return config.OPENAI_API_KEY ?? null;
    if (p.kind === 'openai-compatible') return config.AI_API_KEY ?? null;
    return null;
  };
  const ai = async (): Promise<AiService> => {
    if (aiCache && Date.now() - aiCache.at < 30_000) return aiCache.service;
    const s = await aiSettings();
    const service = new AiService({
      db: sql,
      settings: s,
      apiKey,
      log: log.child('ai'),
      fetch: opts.fetch,
      providerFactory: opts.aiProviderFactory,
    });
    aiCache = { at: Date.now(), service, settings: s };
    return service;
  };

  const httpClients = new Map<string, HttpClient>();
  const http = (source: string): HttpClient => {
    const existing = httpClients.get(source);
    if (existing) return existing;
    const client =
      source === 'eduskunta'
        ? new HttpClient({
            baseUrl: config.EDUSKUNTA_API_URL,
            userAgent: config.EDUSKUNTA_USER_AGENT,
            minIntervalMs: config.EDUSKUNTA_MIN_INTERVAL_MS,
            // api.eduskunta.fi: 450 POST requests / 3000 s / IP; stay below it.
            window: { max: 430, perMs: 3_000_000 },
            fetch: opts.fetch,
            onWarning: (m) => log.warn(m),
          })
        : new HttpClient({ userAgent: config.EDUSKUNTA_USER_AGENT, fetch: opts.fetch });
    httpClients.set(source, client);
    return client;
  };

  const onJobFinished = async (job: Job, outcome: string, error?: string) => {
    if (outcome === 'retry') return;
    const def = jobs.get(job.type);
    const title =
      outcome === 'succeeded'
        ? `Valmis: ${def?.description ?? job.type}`
        : `Epäonnistui: ${def?.description ?? job.type}`;
    if (job.createdBy) {
      await notify(sql, {
        userId: job.createdBy,
        kind: outcome === 'succeeded' ? 'success' : 'error',
        title,
        body: error ?? null,
        link: `/tyot/${job.id}`,
      });
    } else if (outcome === 'failed') {
      await notifyAdmins(sql, { kind: 'error', title, body: error ?? null, link: `/tyot/${job.id}` });
    }
  };

  const runSyncNow: ModuleContext['runSync'] = async (sourceId, params = {}, o = {}) => {
    const def = sync.get(sourceId);
    if (!def) throw new NotFoundError(`Tuntematon synkronointi ${sourceId}`);
    return runSync(sql, def, log, {
      params,
      jobId: o.jobId ?? null,
      triggeredBy: o.triggeredBy ?? null,
      createHttp: () => http(def.dataSource),
      progress: o.jobId
        ? (done, total, message) =>
            sql`update core.jobs set progress_done = ${done}, progress_total = coalesce(${total ?? null}, progress_total),
                  message = coalesce(${message ?? null}, message), updated_at = now() where id = ${o.jobId!}`.then(
              () => {},
            )
        : undefined,
      alert: (title, body) =>
        notifyAdmins(sql, { kind: 'warning', title, body, link: '/yllapito/synkronoinnit' }),
    });
  };

  const ctx: ModuleContext = {
    config,
    sql,
    log,
    registry,
    events,
    jobs,
    sync,
    searchTypes,
    services,
    settings,
    ai,
    withActor: <T>(actor: Actor, fn: Parameters<typeof withActor<T>>[2]) => withActor<T>(sql, actor, fn),
    http,
    runSync: runSyncNow,
    async startJob({ type, payload, user }) {
      const def = jobs.get(type);
      if (!def) throw new NotFoundError(`Tuntematon työ ${type}`);
      if (user !== undefined) requirePermission(user, def.permission);
      const job = await enqueueJob(sql, {
        type,
        moduleId: def.moduleId,
        payload: payload ?? {},
        createdBy: user?.id ?? null,
        maxAttempts: def.maxAttempts,
      });
      if (def.placement === 'inline' && canRunInline) {
        runInBackground(runtime.runJobById(job.id));
      } else if (def.placement === 'inline' && opts.host === 'edge') {
        runInBackground(runtime.runJobById(job.id));
      } else {
        try {
          const r = await services.jobs.dispatch({ id: job.id, type });
          await sql`update core.jobs set runner = ${services.jobs.provider}, message = ${r.message} where id = ${job.id}`;
          if (!r.dispatched) {
            await sql`update core.jobs set message = ${`Käynnistys epäonnistui: ${r.message}`} where id = ${job.id}`;
          }
        } catch (err) {
          await sql`update core.jobs set message = ${`Käynnistys epäonnistui: ${errorMessage(err)}`} where id = ${job.id}`;
        }
      }
      return job;
    },
  };

  registerCoreJobs(ctx);
  registry.init(ctx);
  for (const m of registry.list()) {
    for (const p of m.prompts ?? []) registerPrompt(p);
    for (const s of m.subscriptions?.(ctx) ?? []) events.subscribe(s);
    for (const s of m.syncSources?.(ctx) ?? []) sync.register(s);
    for (const j of m.jobs?.(ctx) ?? []) jobs.register(j);
    for (const t of m.manifest.searchTypes) searchTypes.register({ ...t, moduleId: m.manifest.id });
  }

  const workerId = `${opts.host}-${Math.random().toString(36).slice(2, 8)}`;

  runtime = {
    ...ctx,
    host: opts.host,
    async close() {
      if (!opts.sql) await sql.end({ timeout: 5 });
    },
    async runJobById(jobId) {
      const job = await claimJob(sql, workerId, { id: jobId });
      if (!job) return 'not-found';
      return executeJob(sql, jobs, job, log, onJobFinished);
    },
    async workQueue({ maxJobs = 50, types } = {}) {
      let n = 0;
      while (n < maxJobs) {
        const job = await claimJob(sql, workerId, { types });
        if (!job) break;
        await executeJob(sql, jobs, job, log, onJobFinished);
        n++;
      }
      return n;
    },
    runSyncSource: runSyncNow,
    aiSettings,
    invalidateAi() {
      aiCache = null;
    },
  };
  return runtime;
}

export { SYSTEM };
