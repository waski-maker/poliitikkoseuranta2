import type { Db } from '../db/client.ts';
import { qualified } from '../db/client.ts';
import type { ModuleManifest } from '../modules/manifest.ts';
import { ValidationError } from '../util/errors.ts';

export const MODULE_BACKUP_FORMAT = 'poliitikkoseuranta.module-backup';

export interface ModuleBackup {
  format: typeof MODULE_BACKUP_FORMAT;
  moduleId: string;
  moduleVersion: string;
  schemaVersion: number;
  exportedAt: string;
  includesReproducible: boolean;
  /** Rows as raw JSON (snake_case column names, exactly as stored). */
  tables: Record<string, Record<string, unknown>[]>;
}

/** Provider-neutral JSON export of one module's data. */
export async function exportModule(
  db: Db,
  manifest: ModuleManifest,
  opts: { includeReproducible?: boolean } = {},
): Promise<ModuleBackup> {
  const specs = [
    ...manifest.backup.irreplaceable,
    ...(opts.includeReproducible !== false ? manifest.backup.reproducible : []),
  ];
  const tables: ModuleBackup['tables'] = {};
  for (const { table } of specs) {
    const rows = (await db.unsafe(
      `select to_jsonb(t) as row from ${qualified(table)} t order by 1`,
    )) as unknown as {
      row: Record<string, unknown>;
    }[];
    tables[table] = rows.map((r) => r.row);
  }
  return {
    format: MODULE_BACKUP_FORMAT,
    moduleId: manifest.id,
    moduleVersion: manifest.version,
    schemaVersion: manifest.backup.schemaVersion,
    exportedAt: new Date().toISOString(),
    includesReproducible: opts.includeReproducible !== false,
    tables,
  };
}

export type BackupUpgrader = (backup: ModuleBackup) => ModuleBackup;

/**
 * Restores a module backup by upserting rows (by id) in manifest order, so
 * parent tables come before children. Older backup schema versions are first
 * converted with the module's upgrader. Rows not in the backup are kept.
 */
export async function importModule(
  db: Db,
  manifest: ModuleManifest,
  backup: ModuleBackup,
  upgrade?: BackupUpgrader,
): Promise<{ table: string; rows: number }[]> {
  if (backup.format !== MODULE_BACKUP_FORMAT)
    throw new ValidationError('Tiedosto ei ole moduulin varmuuskopio');
  if (backup.moduleId !== manifest.id) {
    throw new ValidationError(`Varmuuskopio kuuluu moduulille ${backup.moduleId}, ei ${manifest.id}`);
  }
  let data = backup;
  if (data.schemaVersion > manifest.backup.schemaVersion) {
    throw new ValidationError('Varmuuskopio on uudemmasta ohjelmaversiosta; päivitä ohjelma ensin');
  }
  if (data.schemaVersion < manifest.backup.schemaVersion) {
    if (!upgrade) throw new ValidationError('Moduuli ei osaa muuntaa vanhaa varmuuskopiota');
    data = upgrade(data);
  }
  const order = [...manifest.backup.irreplaceable, ...manifest.backup.reproducible].map((t) => t.table);
  const result: { table: string; rows: number }[] = [];
  for (const table of order) {
    const rows = data.tables[table];
    if (!rows?.length) continue;
    const q = qualified(table);
    const cols = (await db`
      select column_name from information_schema.columns
      where table_schema = ${table.split('.')[0]!} and table_name = ${table.split('.')[1]!}
        and is_generated = 'NEVER' and column_name <> 'id'`) as unknown as { columnName: string }[];
    const setList = cols.map((c) => `"${c.columnName}" = excluded."${c.columnName}"`).join(', ');
    for (const row of rows) {
      await db.unsafe(
        `insert into ${q} select * from jsonb_populate_record(null::${q}, $1::jsonb)
         on conflict (id) do update set ${setList}`,
        [JSON.stringify(row)],
      );
    }
    result.push({ table, rows: rows.length });
  }
  return result;
}

/** Stores a point-in-time copy of selected rows before a risky operation (merge, import, bulk edit). */
export async function takeSnapshot(
  db: Db,
  input: { reason: string; moduleId: string; table: string; ids?: string[]; retainDays?: number },
): Promise<string> {
  const q = qualified(input.table);
  const rows = (await db.unsafe(
    input.ids?.length
      ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]') as data from ${q} t where id = any($1::uuid[])`
      : `select coalesce(jsonb_agg(to_jsonb(t)), '[]') as data from ${q} t`,
    input.ids?.length ? [input.ids] : [],
  )) as unknown as { data: unknown[] }[];
  const [snap] = await db<{ id: string }[]>`
    insert into core.snapshots (reason, module_id, scope, data, created_by, expires_at)
    values (${input.reason}, ${input.moduleId}, ${db.json({ table: input.table, ids: input.ids ?? null } as never)},
            ${db.json(rows[0]!.data as never)}, core.actor_id(), now() + make_interval(days => ${input.retainDays ?? 90}))
    returning id`;
  return snap!.id;
}

/** Puts the rows of a snapshot back (upsert by id). */
export async function restoreSnapshot(db: Db, snapshotId: string): Promise<number> {
  const [snap] = await db<{ scope: { table: string }; data: Record<string, unknown>[] }[]>`
    select scope, data from core.snapshots where id = ${snapshotId}`;
  if (!snap) throw new ValidationError('Tilannekuvaa ei löytynyt');
  const q = qualified(snap.scope.table);
  const [schema, name] = snap.scope.table.split('.');
  const cols = (await db`select column_name from information_schema.columns
    where table_schema = ${schema!} and table_name = ${name!} and is_generated = 'NEVER' and column_name <> 'id'`) as unknown as {
    columnName: string;
  }[];
  const setList = cols.map((c) => `"${c.columnName}" = excluded."${c.columnName}"`).join(', ');
  for (const row of snap.data) {
    await db.unsafe(
      `insert into ${q} select * from jsonb_populate_record(null::${q}, $1::jsonb) on conflict (id) do update set ${setList}`,
      [JSON.stringify(row)],
    );
  }
  return snap.data.length;
}
