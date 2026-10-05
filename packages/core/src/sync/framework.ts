import type { Sql } from '../db/client.ts';
import type { Logger } from '../util/log.ts';
import { errorMessage } from '../util/errors.ts';
import type { HttpClient } from './http.ts';

export interface SyncCounters {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export interface SyncContext<P = Record<string, unknown>> {
  sql: Sql;
  log: Logger;
  params: P;
  runId: string;
  counters: SyncCounters;
  /** Persistent per-source state, e.g. an incremental cursor. */
  state: Record<string, unknown>;
  setState(patch: Record<string, unknown>): Promise<void>;
  /** Records a non-fatal error for one item; the run ends as "partial". */
  itemError(message: string, item?: unknown): void;
  progress(done: number, total?: number | null, message?: string): Promise<void>;
  warn(message: string): void;
  createHttp(): HttpClient;
}

export interface SyncSourceDefinition<P = Record<string, unknown>> {
  /** Unique id, e.g. "0.001:eduskunta-reference". */
  id: string;
  moduleId: string;
  name: string;
  description: string;
  /** Data source id from the module manifest. */
  dataSource: string;
  /** Cron expression for documentation/UI; GitHub Actions or cron triggers it. */
  schedule?: string;
  run(ctx: SyncContext<P>): Promise<void>;
}

export class SyncRegistry {
  private defs = new Map<string, SyncSourceDefinition>();

  register<P>(def: SyncSourceDefinition<P>): void {
    if (this.defs.has(def.id)) throw new Error(`Duplicate sync source ${def.id}`);
    this.defs.set(def.id, def as unknown as SyncSourceDefinition);
  }

  get(id: string): SyncSourceDefinition | undefined {
    return this.defs.get(id);
  }

  list(): SyncSourceDefinition[] {
    return [...this.defs.values()];
  }

  /** Ensures every registered source has a row in core.sync_sources. */
  async persist(sql: Sql): Promise<void> {
    for (const d of this.defs.values()) {
      await sql`
        insert into core.sync_sources (id, module_id, name, description, schedule)
        values (${d.id}, ${d.moduleId}, ${d.name}, ${d.description}, ${d.schedule ?? null})
        on conflict (id) do update set module_id = excluded.module_id, name = excluded.name,
          description = excluded.description, schedule = excluded.schedule, updated_at = now()`;
    }
  }
}

export interface SyncRunResult {
  runId: string;
  status: 'succeeded' | 'failed' | 'partial';
  counters: SyncCounters;
  errors: { message: string; item?: unknown }[];
  warnings: string[];
}

export interface RunSyncOptions {
  params?: Record<string, unknown>;
  jobId?: string | null;
  triggeredBy?: string | null;
  progress?: (done: number, total?: number | null, message?: string) => Promise<void>;
  createHttp: () => HttpClient;
  /** Called when a source has failed repeatedly or reports deprecation. */
  alert?: (title: string, body: string) => Promise<void>;
}

const ALERT_AFTER_FAILURES = 3;

/** Runs one sync source with full run logging (start, end, row counts, errors). */
export async function runSync(
  sql: Sql,
  def: SyncSourceDefinition,
  log: Logger,
  opts: RunSyncOptions,
): Promise<SyncRunResult> {
  await sql`insert into core.sync_sources (id, module_id, name, description, schedule)
            values (${def.id}, ${def.moduleId}, ${def.name}, ${def.description}, ${def.schedule ?? null})
            on conflict (id) do nothing`;
  const [source] = await sql<{ state: Record<string, unknown>; enabled: boolean }[]>`
    select state, enabled from core.sync_sources where id = ${def.id}`;
  const [run] = await sql<{ id: string }[]>`
    insert into core.sync_runs (source_id, job_id, params, triggered_by)
    values (${def.id}, ${opts.jobId ?? null}, ${sql.json((opts.params ?? {}) as never)}, ${opts.triggeredBy ?? null})
    returning id`;
  const runId = run!.id;
  const counters: SyncCounters = { fetched: 0, inserted: 0, updated: 0, skipped: 0 };
  const errors: { message: string; item?: unknown }[] = [];
  const warnings: string[] = [];
  const logLines: string[] = [];
  const state = { ...(source?.state ?? {}) };
  const slog = log.child(def.id);

  const ctx: SyncContext = {
    sql,
    log: {
      ...slog,
      info: (m, d) => {
        logLines.push(`${new Date().toISOString()} ${m}`);
        slog.info(m, d);
      },
    },
    params: opts.params ?? {},
    runId,
    counters,
    state,
    async setState(patch) {
      Object.assign(state, patch);
      await sql`update core.sync_sources set state = ${sql.json(state as never)}, updated_at = now() where id = ${def.id}`;
    },
    itemError(message, item) {
      errors.push({ message, item });
    },
    progress: async (done, total, message) => {
      await opts.progress?.(done, total, message);
    },
    warn(message) {
      warnings.push(message);
      logLines.push(`WARN ${message}`);
    },
    createHttp: opts.createHttp,
  };

  let status: SyncRunResult['status'] = 'succeeded';
  let fatal: string | null = null;
  try {
    await def.run(ctx);
    if (errors.length) status = 'partial';
  } catch (err) {
    status = 'failed';
    fatal = errorMessage(err);
    errors.push({ message: fatal });
    slog.error('sync failed', { error: fatal });
  }

  await sql`update core.sync_runs set status = ${status}, finished_at = now(),
      rows_fetched = ${counters.fetched}, rows_inserted = ${counters.inserted},
      rows_updated = ${counters.updated}, rows_skipped = ${counters.skipped},
      errors = ${sql.json(errors.slice(0, 200) as never)}, log = ${logLines.slice(-500)}
    where id = ${runId}`;

  const [after] = await sql<{ consecutiveFailures: number }[]>`
    update core.sync_sources set last_run_id = ${runId},
      last_success_at = case when ${status} <> 'failed' then now() else last_success_at end,
      last_error = ${fatal},
      consecutive_failures = case when ${status} = 'failed' then consecutive_failures + 1 else 0 end,
      updated_at = now()
    where id = ${def.id}
    returning consecutive_failures`;

  if (opts.alert) {
    if ((after?.consecutiveFailures ?? 0) >= ALERT_AFTER_FAILURES) {
      await opts.alert(
        `Synkronointi epäonnistuu toistuvasti: ${def.name}`,
        `${after!.consecutiveFailures} peräkkäistä epäonnistumista. Viimeisin virhe: ${fatal}`,
      );
    }
    for (const w of warnings.filter((w) => /vanhentu/i.test(w))) {
      await opts.alert(`Tietolähteen varoitus: ${def.name}`, w);
    }
  }

  return { runId, status, counters, errors, warnings };
}
