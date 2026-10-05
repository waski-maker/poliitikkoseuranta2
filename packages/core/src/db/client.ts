import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Either a pool or an open transaction. */
export type Db = Sql | Tx;

export interface DbOptions {
  max?: number;
  /** Disable prepared statements (needed behind Supabase's transaction pooler). */
  prepare?: boolean;
}

export function createDb(url: string, opts: DbOptions = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 5,
    prepare: opts.prepare ?? false,
    onnotice: () => {},
    transform: { ...postgres.camel, undefined: null },
    connection: { application_name: 'poliitikkoseuranta' },
    // Keep SQL `date` values as ISO strings (YYYY-MM-DD) instead of JS Dates.
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}

/**
 * Who is running a database operation.
 *  - user:   an authenticated, allow-listed user. Queries run as the
 *            `authenticated` role with JWT claims set, so RLS applies.
 *  - anon:   unauthenticated. Runs as `anon`; RLS denies everything unless the
 *            public view is enabled.
 *  - system: background jobs and bookkeeping (sync, migrations, queue).
 *            Runs as the connection owner and bypasses RLS.
 */
export type Actor =
  | { kind: 'user'; userId: string; email: string; label?: string }
  | { kind: 'anon' }
  | { kind: 'system'; label: string };

export const SYSTEM: Actor = { kind: 'system', label: 'system' };

export function actorLabel(actor: Actor): string {
  if (actor.kind === 'user') return actor.label ?? actor.email;
  if (actor.kind === 'anon') return 'anon';
  return actor.label;
}

/** Runs fn in a transaction scoped to the actor (role + JWT claims). */
export async function withActor<T>(sql: Sql, actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await applyActor(tx, actor);
    return fn(tx);
  }) as Promise<T>;
}

export async function applyActor(tx: Tx, actor: Actor): Promise<void> {
  const label = actorLabel(actor);
  if (actor.kind === 'system') {
    await tx`select set_config('app.actor_label', ${label}, true)`;
    return;
  }
  const claims =
    actor.kind === 'user'
      ? { sub: actor.userId, email: actor.email, role: 'authenticated' }
      : { role: 'anon' };
  await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
                  set_config('app.actor_label', ${label}, true)`;
  await tx.unsafe(actor.kind === 'user' ? 'set local role authenticated' : 'set local role anon');
}

/** Quotes a SQL identifier (schema/table/column). */
export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return `"${name}"`;
}

export function qualified(table: string): string {
  const parts = table.split('.');
  if (parts.length !== 2) throw new Error(`Expected schema.table, got ${table}`);
  return `${ident(parts[0]!)}.${ident(parts[1]!)}`;
}

export function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The camelCase transform also applies to keys inside json/jsonb values.
 * Raw row snapshots (backups, audit states) are converted back to the
 * database's snake_case column names with this helper.
 */
export function snakeKeys(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toSnake(k), v]));
}
