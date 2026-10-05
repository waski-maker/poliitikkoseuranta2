import type { Db } from '../db/client.ts';
import { qualified } from '../db/client.ts';
import { NotFoundError, ValidationError } from '../util/errors.ts';

export interface AuditEntry {
  id: number;
  at: Date;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  tableSchema: string;
  tableName: string;
  recordId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  changedFields: string[] | null;
}

export async function recordHistory(
  db: Db,
  table: string,
  recordId: string,
  limit = 100,
): Promise<AuditEntry[]> {
  const [schema, name] = table.split('.');
  const rows = await db<AuditEntry[]>`
    select id, at, actor_id, actor_label, action, table_schema, table_name, record_id, old_data, new_data, changed_fields
    from core.audit_log
    where table_schema = ${schema!} and table_name = ${name!} and record_id = ${recordId}
    order by at desc, id desc
    limit ${limit}`;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function recentChanges(
  db: Db,
  opts: { tables?: string[]; limit?: number } = {},
): Promise<AuditEntry[]> {
  const rows = await db<AuditEntry[]>`
    select id, at, actor_id, actor_label, action, table_schema, table_name, record_id, null::jsonb as old_data,
      new_data, changed_fields
    from core.audit_log
    ${opts.tables?.length ? db`where (table_schema || '.' || table_name) = any(${opts.tables})` : db``}
    order by id desc
    limit ${Math.min(opts.limit ?? 50, 500)}`;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/** Records an export (or other non-row action) in the audit log. */
export async function auditAction(
  db: Db,
  input: {
    action: 'export' | 'merge' | 'import';
    table: string;
    recordId?: string | null;
    context: Record<string, unknown>;
  },
): Promise<void> {
  const [schema, name] = input.table.split('.');
  await db`insert into core.audit_log (actor_id, actor_label, action, table_schema, table_name, record_id, context)
           values (core.actor_id(), nullif(current_setting('app.actor_label', true), ''), ${input.action},
                   ${schema!}, ${name!}, ${input.recordId ?? null}, ${db.json(input.context as never)})`;
}

const NEVER_RESTORE = ['created_at', 'created_by', 'updated_at', 'updated_by'];

/**
 * Restores a record to the state stored in an audit entry ("after" = the
 * version written by that change, "before" = the version it replaced).
 * Works for updates, soft deletes and hard deletes. Runs as the caller, so
 * write permission is enforced by RLS; the table must belong to a module.
 */
export async function restoreFromAudit(
  db: Db,
  auditId: number,
  allowedTables: string[],
  which: 'after' | 'before' = 'after',
): Promise<{ table: string; recordId: string }> {
  const [entry] = await db<AuditEntry[]>`
    select id, table_schema, table_name, record_id, old_data, new_data, action from core.audit_log where id = ${auditId}`;
  if (!entry) throw new NotFoundError('Muutoshistorian riviä ei löytynyt');
  const table = `${entry.tableSchema}.${entry.tableName}`;
  if (!allowedTables.includes(table)) throw new ValidationError(`Taulua ${table} ei voi palauttaa`);
  const state = which === 'after' ? (entry.newData ?? entry.oldData) : (entry.oldData ?? entry.newData);
  if (!state || !entry.recordId) throw new ValidationError('Muutoshistoriassa ei ole palautettavaa tilaa');
  const cols = Object.keys(state).filter(
    (c) => !NEVER_RESTORE.includes(c) && c !== 'id' && /^[a-z_][a-z0-9_]*$/.test(c),
  );
  const q = qualified(table);
  const json = JSON.stringify(state);
  const exists = await db.unsafe(`select 1 from ${q} where id = $1`, [entry.recordId]);
  if (exists.length) {
    await db.unsafe(
      `update ${q} t set (${cols.map((c) => `"${c}"`).join(', ')}) =
         (select ${cols.map((c) => `r."${c}"`).join(', ')} from jsonb_populate_record(null::${q}, $1::jsonb) r)
       where t.id = $2`,
      [json, entry.recordId],
    );
  } else {
    await db.unsafe(`insert into ${q} select * from jsonb_populate_record(null::${q}, $1::jsonb)`, [json]);
  }
  return { table, recordId: entry.recordId };
}

/** Soft-deleted rows across the given module tables (the 30-day trash). */
export async function listTrash(db: Db, tables: string[]) {
  const out: { table: string; id: string; label: string; deletedAt: Date; data: Record<string, unknown> }[] =
    [];
  for (const t of tables) {
    const rows = (await db.unsafe(
      `select id, deleted_at, to_jsonb(x) as data from ${qualified(t)} x where deleted_at is not null
       order by deleted_at desc limit 200`,
    )) as unknown as { id: string; deletedAt: Date; data: Record<string, unknown> }[];
    for (const r of rows) {
      const d = r.data;
      const label = String(d.name_fi ?? d.name ?? d.title ?? d.abbreviation ?? d.code ?? r.id);
      out.push({ table: t, id: r.id, label, deletedAt: r.deletedAt, data: d });
    }
  }
  return out.sort((a, b) => +new Date(b.deletedAt) - +new Date(a.deletedAt));
}

export async function restoreFromTrash(
  db: Db,
  table: string,
  id: string,
  allowedTables: string[],
): Promise<void> {
  if (!allowedTables.includes(table)) throw new ValidationError(`Taulua ${table} ei voi palauttaa`);
  const r = await db.unsafe(`update ${qualified(table)} set deleted_at = null where id = $1 returning id`, [
    id,
  ]);
  if (!r.length) throw new NotFoundError();
}

/** Permanently removes rows that have been in the trash longer than `days`. */
export async function purgeTrash(db: Db, tables: string[], days = 30): Promise<number> {
  let n = 0;
  for (const t of tables) {
    const r = await db.unsafe(
      `delete from ${qualified(t)} where deleted_at is not null and deleted_at < now() - make_interval(days => $1) returning id`,
      [days],
    );
    n += r.length;
  }
  return n;
}
