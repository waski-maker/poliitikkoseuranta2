import type { Db } from '../db/client.ts';
import { ident, qualified, toSnake } from '../db/client.ts';

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged';

export interface UpsertOptions {
  /** Columns (camelCase) that identify the record, e.g. ["code"]. */
  key: string[];
  source: 'eduskunta' | 'seed' | 'other';
  sourceUrl?: string | null;
  /** Lower-priority sources never overwrite rows that came from a higher one. */
  overwriteSources?: Array<'eduskunta' | 'seed' | 'other' | 'manual'>;
}

const SYSTEM_COLUMNS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'deletedAt',
  'manualFields',
]);

/**
 * Idempotent upsert for synced data that never overwrites manually edited
 * fields: every module table has `manual_fields text[]`; columns listed there
 * are left untouched by sync. Returns what happened.
 */
export async function upsertSynced(
  db: Db,
  table: string,
  data: Record<string, unknown>,
  opts: UpsertOptions,
): Promise<{ outcome: UpsertOutcome; id: string; conflicts: string[] }> {
  const where = opts.key.map((k) => `${ident(toSnake(k))} = $${opts.key.indexOf(k) + 1}`).join(' and ');
  const keyValues = opts.key.map((k) => data[k]);
  const existing = (await db.unsafe(
    `select * from ${qualified(table)} where ${where} limit 1`,
    keyValues as never[],
  )) as unknown as Record<string, unknown>[];
  const row = existing[0];
  const now = new Date();

  if (!row) {
    const record: Record<string, unknown> = {
      ...data,
      source: opts.source,
      sourceUrl: opts.sourceUrl ?? null,
      fetchedAt: now,
    };
    const cols = Object.keys(record);
    const inserted = (await db.unsafe(
      `insert into ${qualified(table)} (${cols.map((c) => ident(toSnake(c))).join(', ')})
       values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      cols.map((c) => toDbValue(record[c])) as never[],
    )) as unknown as { id: string }[];
    return { outcome: 'inserted', id: inserted[0]!.id, conflicts: [] };
  }

  const manual = new Set((row.manualFields as string[] | null) ?? []);
  const allowed = opts.overwriteSources ?? ['eduskunta', 'seed', 'other'];
  const rowSource = row.source as string;
  // A row that was created manually is never touched by sync except for
  // fields it does not have yet; seed data may be replaced by authoritative data.
  const conflicts: string[] = [];
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SYSTEM_COLUMNS.has(k) || opts.key.includes(k)) continue;
    const current = row[k];
    if (sameValue(current, v)) continue;
    if (manual.has(toSnake(k)) || manual.has(k)) {
      conflicts.push(k);
      continue;
    }
    if (!allowed.includes(rowSource as never) && current !== null && current !== undefined) {
      conflicts.push(k);
      continue;
    }
    changes[k] = v;
  }
  const meta: Record<string, unknown> = { fetchedAt: now };
  if (Object.keys(changes).length && allowed.includes(rowSource as never)) {
    meta.source = opts.source;
    if (opts.sourceUrl !== undefined) meta.sourceUrl = opts.sourceUrl;
  }
  const all = { ...changes, ...meta };
  const cols = Object.keys(all);
  await db.unsafe(
    `update ${qualified(table)} set ${cols.map((c, i) => `${ident(toSnake(c))} = $${i + 1}`).join(', ')}
     where id = $${cols.length + 1}`,
    [...cols.map((c) => toDbValue(all[c])), row.id] as never[],
  );
  return {
    outcome: Object.keys(changes).length ? 'updated' : 'unchanged',
    id: row.id as string,
    conflicts,
  };
}

function toDbValue(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v))
    return JSON.stringify(v);
  return v ?? null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const da = a instanceof Date ? a : a ? new Date(String(a)) : null;
    const dbb = b instanceof Date ? b : b ? new Date(String(b)) : null;
    return (da?.getTime() ?? null) === (dbb?.getTime() ?? null);
  }
  if (typeof a === 'object' || typeof b === 'object')
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return (a ?? null) === (b ?? null);
}
