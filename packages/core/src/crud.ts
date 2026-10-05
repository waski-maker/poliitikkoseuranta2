import type { Db } from './db/client.ts';
import { ident, qualified, toSnake } from './db/client.ts';
import { NotFoundError, ValidationError } from './util/errors.ts';

/**
 * Generic data access for module tables that follow the core conventions
 * (uuid id + standard columns from core.setup_table). Every call runs on an
 * actor-scoped connection, so RLS applies.
 */

export interface ListOptions {
  updatedSince?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: string;
  /** Simple equality filters (camelCase column → value). */
  where?: Record<string, unknown>;
  /** Case-insensitive text search over these columns. */
  search?: { q: string; columns: string[] };
}

export async function listRows<T>(db: Db, table: string, opts: ListOptions = {}): Promise<T[]> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.updatedSince) {
    params.push(opts.updatedSince);
    // Changed rows including soft deletes, so clients can sync deletions.
    conds.push(`updated_at > $${params.length}`);
  } else if (!opts.includeDeleted) {
    conds.push('deleted_at is null');
  }
  for (const [k, v] of Object.entries(opts.where ?? {})) {
    if (v === undefined) continue;
    params.push(v);
    conds.push(`${ident(toSnake(k))} = $${params.length}`);
  }
  if (opts.search?.q.trim()) {
    params.push(`%${opts.search.q.trim()}%`);
    conds.push(
      `(${opts.search.columns.map((c) => `${ident(toSnake(c))}::text ilike $${params.length}`).join(' or ')})`,
    );
  }
  const order = (opts.orderBy ?? 'created_at')
    .split(',')
    .map((part) => {
      const [col, dir] = part.trim().split(/\s+/);
      return `${ident(toSnake(col!))} ${dir?.toLowerCase() === 'desc' ? 'desc' : 'asc'}`;
    })
    .join(', ');
  params.push(Math.min(opts.limit ?? 500, 1000), opts.offset ?? 0);
  const rows = await db.unsafe(
    `select * from ${qualified(table)} ${conds.length ? `where ${conds.join(' and ')}` : ''}
     order by ${order} limit $${params.length - 1} offset $${params.length}`,
    params as never[],
  );
  return rows as unknown as T[];
}

export async function getRow<T>(db: Db, table: string, id: string): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError();
  const rows = await db.unsafe(`select * from ${qualified(table)} where id = $1`, [id]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0] as unknown as T;
}

function toDb(v: unknown): unknown {
  // Objects go to jsonb columns; postgres.js serialises them by the column type.
  return v === undefined ? null : v;
}

export async function insertRow<T>(db: Db, table: string, data: Record<string, unknown>): Promise<T> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) throw new ValidationError('Ei tallennettavia kenttiä');
  const rows = await db.unsafe(
    `insert into ${qualified(table)} (${entries.map(([k]) => ident(toSnake(k))).join(', ')})
     values (${entries.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    entries.map(([, v]) => toDb(v)) as never[],
  );
  return rows[0] as unknown as T;
}

/**
 * Updates fields. For records that came from an external source, edited
 * fields are added to manual_fields, so synchronisation never overwrites them.
 */
export async function updateRow<T>(
  db: Db,
  table: string,
  id: string,
  patch: Record<string, unknown>,
  opts: { trackManual?: boolean } = {},
): Promise<{ before: T; after: T; changed: string[] }> {
  const before = (await getRow<Record<string, unknown>>(db, table, id)) as Record<string, unknown>;
  const entries = Object.entries(patch).filter(
    ([k, v]) => v !== undefined && JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null),
  );
  if (!entries.length) return { before: before as T, after: before as T, changed: [] };
  const sets = entries.map(([k], i) => `${ident(toSnake(k))} = $${i + 1}`);
  const params = entries.map(([, v]) => toDb(v));
  if (opts.trackManual !== false && before.source !== 'manual') {
    params.push(entries.map(([k]) => toSnake(k)));
    sets.push(
      `manual_fields = (select array(select distinct unnest(manual_fields || $${params.length}::text[]) order by 1))`,
    );
  }
  params.push(id);
  const rows = await db.unsafe(
    `update ${qualified(table)} set ${sets.join(', ')} where id = $${params.length} returning *`,
    params as never[],
  );
  if (!rows[0]) throw new NotFoundError();
  return { before: before as T, after: rows[0] as unknown as T, changed: entries.map(([k]) => k) };
}

export async function softDeleteRow(db: Db, table: string, id: string): Promise<void> {
  const r = await db.unsafe(
    `update ${qualified(table)} set deleted_at = now() where id = $1 and deleted_at is null returning id`,
    [id],
  );
  if (!r.length) throw new NotFoundError();
}

export async function restoreRow(db: Db, table: string, id: string): Promise<void> {
  const r = await db.unsafe(`update ${qualified(table)} set deleted_at = null where id = $1 returning id`, [
    id,
  ]);
  if (!r.length) throw new NotFoundError();
}
