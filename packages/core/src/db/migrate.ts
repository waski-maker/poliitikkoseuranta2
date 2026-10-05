import type { Sql } from './client.ts';
import { sha256Hex } from '../util/crypto.ts';

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies SQL migrations in lexical order, each in its own transaction, and
 * records them in core_meta.schema_migrations. The file naming
 * (<timestamp>_<name>.sql) is compatible with `supabase db push`.
 */
export async function pendingMigrations(sql: Sql, files: MigrationFile[]): Promise<MigrationFile[]> {
  await ensureMigrationTable(sql);
  const rows = await sql<{ name: string }[]>`select name from core_meta.schema_migrations`;
  const done = new Set(rows.map((r) => r.name));
  return [...files].sort((a, b) => a.name.localeCompare(b.name)).filter((f) => !done.has(f.name));
}

export async function runMigrations(
  sql: Sql,
  files: MigrationFile[],
  opts: { onApply?: (name: string) => void } = {},
): Promise<MigrationResult> {
  const pending = await pendingMigrations(sql, files);
  const applied: string[] = [];
  for (const file of pending) {
    const checksum = await sha256Hex(file.sql);
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(727274)`;
      const exists = await tx`select 1 from core_meta.schema_migrations where name = ${file.name}`;
      if (exists.length) return;
      await tx.unsafe(`set local client_min_messages = warning;\n${file.sql}`);
      await tx`insert into core_meta.schema_migrations (name, checksum) values (${file.name}, ${checksum})`;
    });
    applied.push(file.name);
    opts.onApply?.(file.name);
  }
  return { applied, skipped: files.map((f) => f.name).filter((n) => !applied.includes(n)) };
}

async function ensureMigrationTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    set client_min_messages = warning;
    create schema if not exists core_meta;
    create table if not exists core_meta.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
  `);
}
