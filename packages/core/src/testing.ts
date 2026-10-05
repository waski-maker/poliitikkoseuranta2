/** Test helpers: a freshly migrated PostgreSQL database per test file. */
import postgres from 'postgres';
import { createDb, type Sql } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { loadMigrationFiles } from './node.ts';
import { generateKeyB64 } from './util/crypto.ts';
import type { AppConfig } from './config.ts';
import { loadConfig } from './config.ts';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ps_test';

export async function databaseAvailable(url = TEST_DATABASE_URL): Promise<boolean> {
  const probe = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 });
  }
}

/** Drops all application schemas and re-applies every migration. */
export async function resetDatabase(url = TEST_DATABASE_URL): Promise<Sql> {
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const schemas = await admin<{ nspname: string }[]>`
      select nspname from pg_namespace where nspname in ('core', 'core_meta') or nspname ~ '^m[0-9]{4}_'`;
    for (const s of schemas) await admin.unsafe(`drop schema if exists "${s.nspname}" cascade`);
  } finally {
    await admin.end();
  }
  const sql = createDb(url, { max: 4 });
  await runMigrations(sql, await loadMigrationFiles());
  return sql;
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_PROVIDER: 'dev',
    AUTH_JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    ALLOWED_EMAILS: 'admin@example.com,reader@example.com',
    SETTINGS_ENCRYPTION_KEY: generateKeyB64(),
    BACKUP_ENCRYPTION_KEY: generateKeyB64(),
    STORAGE_PROVIDER: 'memory',
    BACKUP_TARGET: 'memory',
    JOBS_RUNNER: 'inline',
    LOG_LEVEL: 'error',
    ...overrides,
  });
}
