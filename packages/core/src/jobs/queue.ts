import type { Db, Sql } from '../db/client.ts';
import type { Logger } from '../util/log.ts';
import { errorMessage } from '../util/errors.ts';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Job<P = Record<string, unknown>> {
  id: string;
  type: string;
  moduleId: string;
  payload: P;
  status: JobStatus;
  runner: string;
  progressDone: number;
  progressTotal: number | null;
  message: string | null;
  result: unknown;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface JobContext<P = Record<string, unknown>> {
  job: Job<P>;
  sql: Sql;
  log: Logger;
  /** Reports progress; visible in the UI in real time. */
  progress(done: number, total?: number | null, message?: string): Promise<void>;
}

/**
 * Where a job may run:
 *  - inline: short work; may run inside the API process (Edge Function / Node).
 *  - worker: long work; dispatched to the jobs runner (GitHub Actions, cron, Docker).
 */
export type JobPlacement = 'inline' | 'worker';

export interface JobDefinition<P = Record<string, unknown>> {
  type: string;
  moduleId: string;
  description: string;
  /** Permission needed to start the job from the API. */
  permission: string;
  placement: JobPlacement;
  maxAttempts?: number;
  run(ctx: JobContext<P>, payload: P): Promise<unknown>;
}

export class JobRegistry {
  private defs = new Map<string, JobDefinition>();

  register<P>(def: JobDefinition<P>): void {
    if (this.defs.has(def.type)) throw new Error(`Duplicate job type ${def.type}`);
    this.defs.set(def.type, def as unknown as JobDefinition);
  }

  /** Replaces a definition (the worker swaps placeholders for Node-only implementations). */
  override<P>(def: JobDefinition<P>): void {
    this.defs.set(def.type, def as unknown as JobDefinition);
  }

  get(type: string): JobDefinition | undefined {
    return this.defs.get(type);
  }

  list(): JobDefinition[] {
    return [...this.defs.values()];
  }
}

export async function enqueueJob(
  db: Db,
  input: {
    type: string;
    moduleId: string;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
    runner?: string;
    maxAttempts?: number;
    runAfter?: Date;
  },
): Promise<Job> {
  const [job] = await db<Job[]>`
    insert into core.jobs (type, module_id, payload, created_by, runner, max_attempts, run_after)
    values (${input.type}, ${input.moduleId}, ${db.json((input.payload ?? {}) as never)}, ${input.createdBy ?? null},
            ${input.runner ?? 'auto'}, ${input.maxAttempts ?? 3}, ${input.runAfter ?? new Date()})
    returning *`;
  return job!;
}

export async function getJob(db: Db, id: string): Promise<Job | null> {
  const [job] = await db<Job[]>`select * from core.jobs where id = ${id}`;
  return job ?? null;
}

/** Atomically claims the next queued job (SKIP LOCKED makes parallel workers safe). */
export async function claimJob(sql: Sql, workerId: string, opts: { id?: string; types?: string[] } = {}) {
  const [job] = await sql<Job[]>`
    update core.jobs set status = 'running', locked_at = now(), locked_by = ${workerId},
      attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
    where id = (
      select id from core.jobs
      where status = 'queued' and run_after <= now()
        ${opts.id ? sql`and id = ${opts.id}` : sql``}
        ${opts.types?.length ? sql`and type = any(${opts.types})` : sql``}
      order by created_at
      for update skip locked
      limit 1
    )
    returning *`;
  return job ?? null;
}

export async function updateProgress(
  db: Db,
  id: string,
  done: number,
  total?: number | null,
  message?: string,
): Promise<void> {
  await db`update core.jobs set progress_done = ${done},
             progress_total = coalesce(${total ?? null}, progress_total),
             message = coalesce(${message ?? null}, message), updated_at = now()
           where id = ${id}`;
}

export async function completeJob(db: Db, id: string, result: unknown): Promise<void> {
  await db`update core.jobs set status = 'succeeded', result = ${db.json((result ?? null) as never)},
             finished_at = now(), updated_at = now(), locked_by = null
           where id = ${id}`;
}

export async function failJob(db: Db, job: Job, error: string): Promise<'retry' | 'failed'> {
  if (job.attempts < job.maxAttempts) {
    const backoffSec = 30 * 2 ** (job.attempts - 1);
    await db`update core.jobs set status = 'queued', error = ${error}, locked_by = null,
               run_after = now() + make_interval(secs => ${backoffSec}), updated_at = now()
             where id = ${job.id}`;
    return 'retry';
  }
  await db`update core.jobs set status = 'failed', error = ${error}, finished_at = now(),
             updated_at = now(), locked_by = null
           where id = ${job.id}`;
  return 'failed';
}

export async function cancelJob(db: Db, id: string): Promise<void> {
  await db`update core.jobs set status = 'cancelled', finished_at = now(), updated_at = now()
           where id = ${id} and status in ('queued', 'running')`;
}

/** Re-queues jobs whose worker died (locked for too long). */
export async function requeueStaleJobs(sql: Sql, olderThanMinutes = 60): Promise<number> {
  const rows = await sql`update core.jobs set status = 'queued', locked_by = null, updated_at = now()
    where status = 'running' and locked_at < now() - make_interval(mins => ${olderThanMinutes})
    returning id`;
  return rows.length;
}

/**
 * Executes one claimed job with its registered handler and records the outcome.
 * `onFinished` lets the caller send notifications.
 */
export async function executeJob(
  sql: Sql,
  registry: JobRegistry,
  job: Job,
  log: Logger,
  onFinished?: (job: Job, outcome: 'succeeded' | 'retry' | 'failed', error?: string) => Promise<void>,
): Promise<'succeeded' | 'retry' | 'failed'> {
  const def = registry.get(job.type);
  if (!def) {
    const outcome = await failJob(
      sql,
      { ...job, attempts: job.maxAttempts },
      `Tuntematon työtyyppi ${job.type}`,
    );
    await onFinished?.(job, outcome, `Tuntematon työtyyppi ${job.type}`);
    return outcome;
  }
  const ctx: JobContext = {
    job,
    sql,
    log: log.child(job.type),
    progress: (done, total, message) => updateProgress(sql, job.id, done, total, message),
  };
  try {
    const result = await def.run(ctx, job.payload);
    await completeJob(sql, job.id, result ?? null);
    await onFinished?.(job, 'succeeded');
    return 'succeeded';
  } catch (err) {
    const msg = errorMessage(err);
    log.error('job failed', { jobId: job.id, type: job.type, error: msg });
    const outcome = await failJob(sql, job, msg);
    await onFinished?.(job, outcome, msg);
    return outcome;
  }
}
