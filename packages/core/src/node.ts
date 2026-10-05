/**
 * Node.js-only helpers (filesystem, pg_dump/pg_restore). Used by the worker
 * CLI and the self-hosted Node server; never bundled into the Edge Function.
 */
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { finished, pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { MigrationFile } from './db/migrate.ts';
import type { Runtime } from './runtime.ts';
import { applyRetention, DEFAULT_RETENTION, type RetentionPolicy } from './backup/retention.ts';
import { exportModule } from './backup/module-backup.ts';
import { notifyAdmins } from './notifications/notify.ts';
import { ENVELOPE_MAGIC, encryptBytes, sha256Hex, fromBase64 } from './util/crypto.ts';
import { errorMessage, ValidationError } from './util/errors.ts';
import { zipSync } from 'fflate';

export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export async function loadMigrationFiles(
  dir = join(repoRoot(), 'supabase', 'migrations'),
): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(join(dir, name), 'utf8') })));
}

// --- Streaming encryption (same envelope as util/crypto.ts: magic | iv | ciphertext | tag) ---

export async function encryptFile(src: string, dest: string, keyB64: string): Promise<void> {
  const key = Buffer.from(fromBase64(keyB64));
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes (base64)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(dest);
  out.write(Buffer.from(ENVELOPE_MAGIC));
  out.write(iv);
  await pipeline(
    createReadStream(src),
    cipher,
    new Writable({
      write(chunk: Buffer, _enc, cb) {
        if (out.write(chunk)) cb();
        else out.once('drain', () => cb());
      },
    }),
  );
  out.end(cipher.getAuthTag());
  await finished(out);
}

export async function decryptFile(src: string, dest: string, keyB64: string): Promise<void> {
  const key = Buffer.from(fromBase64(keyB64));
  const { size } = await stat(src);
  const header = await readRange(src, 0, 16);
  if (!header.subarray(0, 4).equals(Buffer.from(ENVELOPE_MAGIC))) throw new Error('Not an encrypted backup');
  const iv = header.subarray(4, 16);
  const tag = await readRange(src, size - 16, 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(src, { start: 16, end: size - 17 }), decipher, createWriteStream(dest));
}

async function readRange(file: string, start: number, n: number): Promise<Buffer> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function run(cmd: string, args: string[], env: Record<string, string | undefined> = {}): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stderr = '';
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += String(d)));
    p.stderr.on('data', (d) => (stderr += String(d)));
    p.on('error', rej);
    p.on('close', (code) =>
      code === 0 ? res(stdout) : rej(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`)),
    );
  });
}

export async function hasBinary(bin: string): Promise<boolean> {
  try {
    await run(bin, ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Schemas owned by the application (Supabase's own schemas are not dumped). */
async function appSchemas(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ nspname: string }[]>`
    select nspname from pg_namespace where nspname in ('core', 'core_meta') or nspname ~ '^m[0-9]{4}_' order by 1`;
  return rows.map((r) => r.nspname);
}

export interface FullBackupResult {
  backupId: string;
  location: string;
  sizeBytes: number;
  filesBackupLocation: string | null;
}

/**
 * Full encrypted backup: pg_dump of all application schemas (custom format)
 * plus a ZIP of stored files, both AES-256-GCM encrypted before upload to the
 * configured backup target. Afterwards applies the retention policy.
 */
export async function runFullBackup(
  rt: Runtime,
  opts: { includeReproducible?: boolean; kind?: 'full' | 'pre_migration'; createdBy?: string | null } = {},
): Promise<FullBackupResult> {
  const key = rt.config.BACKUP_ENCRYPTION_KEY;
  if (!key) throw new ValidationError('BACKUP_ENCRYPTION_KEY puuttuu');
  const [row] = await rt.sql<{ id: string }[]>`
    insert into core.backups (kind, target, include_reproducible, created_by)
    values (${opts.kind ?? 'full'}, ${rt.services.backup.provider}, ${opts.includeReproducible ?? false}, ${opts.createdBy ?? null})
    returning id`;
  const id = row!.id;
  const dir = await mkdtemp(join(tmpdir(), 'ps-backup-'));
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dump = join(dir, 'db.dump');
    const enc = join(dir, 'db.dump.enc');
    const schemas = await appSchemas(rt.sql);
    const excludeData = opts.includeReproducible
      ? []
      : rt.registry
          .manifests()
          .flatMap((m) => m.backup.reproducible.map((t) => t.table))
          .concat(['core.embeddings', 'core.search_index', 'core.ai_cache'])
          .flatMap((t) => ['--exclude-table-data', t]);
    if (await hasBinary('pg_dump')) {
      await run('pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        ...schemas.flatMap((s) => ['--schema', s]),
        ...excludeData,
        '--file',
        dump,
        rt.config.DATABASE_URL,
      ]);
    } else {
      // Fallback without pg_dump: provider-neutral JSON export of every module.
      const all: Record<string, unknown> = {
        format: 'poliitikkoseuranta.json-backup',
        exportedAt: new Date().toISOString(),
        modules: {},
      };
      for (const m of rt.registry.manifests()) {
        (all.modules as Record<string, unknown>)[m.id] = await exportModule(rt.sql, m, {
          includeReproducible: opts.includeReproducible ?? false,
        });
      }
      await writeFile(dump, JSON.stringify(all));
    }
    await encryptFile(dump, enc, key);
    const bytes = new Uint8Array(await readFile(enc));
    const location = `full/${stamp}-${id.slice(0, 8)}.dump.enc`;
    await rt.services.backup.put(location, bytes, 'application/octet-stream');

    // Files from the storage service (logos, manually added images, exports).
    let filesLocation: string | null = null;
    const files = (await rt.services.storage.list('')).filter((f) => !f.key.startsWith('_healthcheck/'));
    if (files.length) {
      const entries: Record<string, Uint8Array> = {};
      for (const f of files) {
        const b = await rt.services.storage.get(f.key);
        if (b) entries[f.key] = b;
      }
      const zipped = await encryptBytes(zipSync(entries), key);
      filesLocation = `files/${stamp}-${id.slice(0, 8)}.zip.enc`;
      await rt.services.backup.put(filesLocation, zipped, 'application/octet-stream');
    }

    await rt.sql`update core.backups set status = 'succeeded', location = ${location}, size_bytes = ${bytes.length},
      sha256 = ${await sha256Hex(bytes)}, finished_at = now() where id = ${id}`;
    if (filesLocation) {
      await rt.sql`insert into core.backups (kind, status, target, location, finished_at, created_by)
        values ('files', 'succeeded', ${rt.services.backup.provider}, ${filesLocation}, now(), ${opts.createdBy ?? null})`;
    }
    await applyBackupRetention(rt);
    return { backupId: id, location, sizeBytes: bytes.length, filesBackupLocation: filesLocation };
  } catch (err) {
    await rt.sql`update core.backups set status = 'failed', error = ${errorMessage(err)}, finished_at = now() where id = ${id}`;
    await notifyAdmins(rt.sql, {
      kind: 'error',
      title: 'Varmuuskopiointi epäonnistui',
      body: errorMessage(err),
      link: '/yllapito/varmuuskopiot',
    });
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function retentionPolicy(rt: Runtime): Promise<RetentionPolicy> {
  return rt.settings.get<RetentionPolicy>('backup', 'retention', DEFAULT_RETENTION);
}

export async function applyBackupRetention(rt: Runtime): Promise<string[]> {
  const policy = await retentionPolicy(rt);
  const rows = await rt.sql<{ id: string; startedAt: Date; location: string | null; kind: string }[]>`
    select id, started_at, location, kind from core.backups where status = 'succeeded' and kind in ('full', 'files')`;
  const removed: string[] = [];
  for (const kind of ['full', 'files']) {
    const set = rows.filter((r) => r.kind === kind);
    const { keep, remove } = applyRetention(
      set.map((r) => ({ id: r.id, startedAt: new Date(r.startedAt) })),
      policy,
    );
    for (const [bid, cls] of keep)
      await rt.sql`update core.backups set retention_class = ${cls} where id = ${bid}`;
    for (const bid of remove) {
      const r = set.find((x) => x.id === bid)!;
      if (r.location) await rt.services.backup.delete(r.location).catch(() => {});
      await rt.sql`update core.backups set status = 'deleted' where id = ${bid}`;
      removed.push(bid);
    }
  }
  return removed;
}

async function downloadAndDecrypt(rt: Runtime, location: string, dir: string): Promise<string> {
  const key = rt.config.BACKUP_ENCRYPTION_KEY;
  if (!key) throw new ValidationError('BACKUP_ENCRYPTION_KEY puuttuu');
  const bytes = await rt.services.backup.get(location);
  if (!bytes) throw new Error(`Varmuuskopiota ei löytynyt kohteesta: ${location}`);
  const enc = join(dir, 'backup.enc');
  const plain = join(dir, 'backup.dump');
  await writeFile(enc, bytes);
  await decryptFile(enc, plain, key);
  return plain;
}

async function prepareTargetDb(url: string, vectorSchema: string): Promise<void> {
  const db = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
      end $$;
      create schema if not exists auth;
      create schema if not exists ${vectorSchema === 'public' ? 'public' : `"${vectorSchema}"`};
      create extension if not exists pgcrypto;
      create extension if not exists pg_trgm;
      create extension if not exists vector schema ${vectorSchema === 'public' ? 'public' : `"${vectorSchema}"`};
    `);
    const fns =
      await db`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid'`;
    if (!fns.length) {
      await db.unsafe(`create function auth.uid() returns uuid language sql stable as $b$
        select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid $b$`);
      await db.unsafe(`create function auth.jwt() returns jsonb language sql stable as $b$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $b$`);
    }
  } finally {
    await db.end();
  }
}

/**
 * Monthly restore test: restores the newest full backup into a scratch
 * database (BACKUP_VERIFY_DATABASE_URL) and checks integrity (migration
 * history and row counts of irreplaceable tables). Failures notify admins.
 */
export async function verifyLatestBackup(
  rt: Runtime,
): Promise<{ backupId: string; ok: boolean; message: string }> {
  const verifyUrl = rt.config.BACKUP_VERIFY_DATABASE_URL;
  if (!verifyUrl)
    throw new ValidationError('BACKUP_VERIFY_DATABASE_URL puuttuu (väliaikainen testitietokanta)');
  const [latest] = await rt.sql<{ id: string; location: string }[]>`
    select id, location from core.backups where kind = 'full' and status = 'succeeded' order by started_at desc limit 1`;
  if (!latest) throw new ValidationError('Yhtään onnistunutta täyttä varmuuskopiota ei löytynyt');
  const dir = await mkdtemp(join(tmpdir(), 'ps-verify-'));
  let ok = false;
  let message = '';
  try {
    const plain = await downloadAndDecrypt(rt, latest.location, dir);
    const head = (await readRange(plain, 0, 5)).toString();
    if (head !== 'PGDMP')
      throw new Error(
        'Varmuuskopio ei ole pg_dump-muotoinen (JSON-varmuuskopio tarkistetaan moduulipalautuksella)',
      );
    const [ext] = await rt.sql<{ nspname: string }[]>`
      select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`;
    // Clean scratch database: drop application schemas from a previous test.
    const scratch = postgres(verifyUrl, { max: 1, onnotice: () => {} });
    try {
      for (const s of await appSchemas(scratch)) await scratch.unsafe(`drop schema if exists "${s}" cascade`);
    } finally {
      await scratch.end();
    }
    await prepareTargetDb(verifyUrl, ext?.nspname ?? 'public');
    await run('pg_restore', [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--dbname',
      verifyUrl,
      plain,
    ]);
    const check = postgres(verifyUrl, { max: 1, onnotice: () => {} });
    try {
      const [{ n }] = (await check<
        { n: number }[]
      >`select count(*)::int as n from core_meta.schema_migrations`) as unknown as [{ n: number }];
      const [{ n: prodN }] = (await rt.sql<
        { n: number }[]
      >`select count(*)::int as n from core_meta.schema_migrations`) as unknown as [{ n: number }];
      const counts: string[] = [];
      for (const m of rt.registry.manifests()) {
        for (const t of m.backup.irreplaceable) {
          const [{ c }] = (await check.unsafe(`select count(*)::int as c from ${t.table}`)) as unknown as [
            { c: number },
          ];
          counts.push(`${t.table}=${c}`);
        }
      }
      if (n === 0) throw new Error('Palautetussa kannassa ei ole migraatiohistoriaa');
      ok = true;
      message = `Palautus onnistui: ${n}/${prodN} migraatiota, ${counts.join(', ')}`;
    } finally {
      await check.end();
    }
  } catch (err) {
    message = errorMessage(err);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await rt.sql`update core.backups set verified_at = now(), verify_status = ${ok ? 'ok' : 'failed'}, verify_message = ${message}
    where id = ${latest.id}`;
  if (!ok) {
    await notifyAdmins(rt.sql, {
      kind: 'error',
      title: 'Varmuuskopion palautustesti epäonnistui',
      body: message,
      link: '/yllapito/varmuuskopiot',
    });
  }
  return { backupId: latest.id, ok, message };
}

/** Full restore into the production database. Destructive: callers must require explicit confirmation. */
export async function restoreFullBackup(
  rt: Runtime,
  backupId: string,
  targetUrl = rt.config.DATABASE_URL,
): Promise<string> {
  const [b] = await rt.sql<
    { location: string }[]
  >`select location from core.backups where id = ${backupId} and kind = 'full'`;
  if (!b) throw new ValidationError('Varmuuskopiota ei löytynyt');
  // Safety net: snapshot of the current state before replacing it.
  await runFullBackup(rt, { kind: 'pre_migration', includeReproducible: false }).catch(() => null);
  const dir = await mkdtemp(join(tmpdir(), 'ps-restore-'));
  try {
    const plain = await downloadAndDecrypt(rt, b.location, dir);
    await run('pg_restore', [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      targetUrl,
      plain,
    ]);
    return 'Palautus valmis';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function resolveFromRoot(...p: string[]): string {
  return resolve(repoRoot(), ...p);
}

/** Replaces the worker-only job placeholders with the Node.js implementations. */
export function registerNodeJobs(rt: Runtime): void {
  rt.jobs.override<{ includeReproducible?: boolean }>({
    type: 'backup:full',
    moduleId: '0.000',
    description: 'Täysi varmuuskopio (tietokanta + tiedostot)',
    permission: 'core.backup',
    placement: 'worker',
    maxAttempts: 2,
    run: (jc, p) =>
      runFullBackup(rt, { includeReproducible: p.includeReproducible, createdBy: jc.job.createdBy }),
  });
  rt.jobs.override({
    type: 'backup:verify',
    moduleId: '0.000',
    description: 'Varmuuskopion palautustesti',
    permission: 'core.backup',
    placement: 'worker',
    maxAttempts: 1,
    async run() {
      const r = await verifyLatestBackup(rt);
      if (!r.ok) throw new Error(r.message);
      return r;
    },
  });
  rt.jobs.override<{ backupId: string }>({
    type: 'backup:restore',
    moduleId: '0.000',
    description: 'Palautus varmuuskopiosta',
    permission: 'core.backup',
    placement: 'worker',
    maxAttempts: 1,
    run: (_jc, p) => restoreFullBackup(rt, p.backupId),
  });
}
