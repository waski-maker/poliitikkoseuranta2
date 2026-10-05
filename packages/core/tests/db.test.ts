import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRuntime,
  enqueueJob,
  ensureUser,
  exportModule,
  importModule,
  listTrash,
  recordHistory,
  restoreFromAudit,
  restoreFromTrash,
  syncPermissions,
  upsertSynced,
  withActor,
  type Runtime,
  type Sql,
} from '../src/index.ts';
import { databaseAvailable, resetDatabase, testConfig } from '../src/testing.ts';
import { registriesModule } from '@ps/m0001-registries';
import type { ServerModule } from '../src/index.ts';

const available = await databaseAvailable();

describe.skipIf(!available)('database: RLS, auth, audit, backup', () => {
  let sql: Sql;
  let rt: Runtime;
  const admin = { sub: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com' };
  const reader = { sub: '00000000-0000-4000-8000-000000000002', email: 'reader@example.com' };
  const outsider = { sub: '00000000-0000-4000-8000-000000000003', email: 'outsider@example.com' };
  const allow = ['admin@example.com', 'reader@example.com'];

  beforeAll(async () => {
    sql = await resetDatabase();
    rt = await createRuntime({
      config: testConfig(),
      sql,
      modules: [registriesModule as ServerModule],
      host: 'test',
      forceMemoryStorage: true,
    });
    await syncPermissions(sql, rt.registry.manifests());
    await registriesModule.seed!(rt);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('first allowed user becomes admin, the next one reader, others are rejected', async () => {
    const a = await ensureUser(sql, admin, allow);
    expect(a?.isAdmin).toBe(true);
    const r = await ensureUser(sql, reader, allow);
    expect(r?.roles).toEqual(['reader']);
    expect(r?.permissions).toContain('registries.read');
    expect(r?.permissions).not.toContain('registries.edit');
    expect(await ensureUser(sql, outsider, allow)).toBeNull();
  });

  it('anonymous users see nothing (RLS)', async () => {
    const parties = await withActor(
      sql,
      { kind: 'anon' },
      (tx) => tx`select * from m0001_registries.parties`,
    );
    expect(parties).toHaveLength(0);
    await expect(withActor(sql, { kind: 'anon' }, (tx) => tx`select * from core.users`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(withActor(sql, { kind: 'anon' }, (tx) => tx`select * from core.secrets`)).rejects.toThrow(
      /permission denied/,
    );
    const search = await withActor(sql, { kind: 'anon' }, (tx) => tx`select * from core.search_index`);
    expect(search).toHaveLength(0);
  });

  it('a signed-in user who is not on the allow-list sees nothing (RLS)', async () => {
    const actor = { kind: 'user' as const, userId: outsider.sub, email: outsider.email };
    for (const table of [
      'm0001_registries.parties',
      'm0001_registries.governments',
      'core.search_index',
      'core.notifications',
      'core.jobs',
    ]) {
      const rows = await withActor(sql, actor, (tx) => tx.unsafe(`select * from ${table}`));
      expect(rows, table).toHaveLength(0);
    }
    await expect(
      withActor(
        sql,
        actor,
        (tx) => tx`insert into m0001_registries.parties (abbreviation, name_fi) values ('X', 'X')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(withActor(sql, actor, (tx) => tx`select * from core.secrets`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('reader can read but not write; admin can write', async () => {
    const asReader = { kind: 'user' as const, userId: reader.sub, email: reader.email };
    const rows = await withActor(
      sql,
      asReader,
      (tx) => tx`select abbreviation from m0001_registries.parties`,
    );
    expect(rows.length).toBe(9);
    await expect(
      withActor(
        sql,
        asReader,
        (tx) => tx`insert into m0001_registries.parties (abbreviation, name_fi) values ('X', 'X')`,
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withActor(
      sql,
      asReader,
      (tx) => tx`update m0001_registries.parties set notes = 'x' returning id`,
    );
    expect(updated).toHaveLength(0);
    const asAdmin = { kind: 'user' as const, userId: admin.sub, email: admin.email };
    const api = rt.registry.get('0.001').api;
    const p = await withActor(sql, asAdmin, (tx) =>
      api.create(tx, 'parties', { abbreviation: 'TST', nameFi: 'Testipuolue', status: 'active' }),
    );
    expect(p.source).toBe('manual');
    expect(p.createdBy).toBe(admin.sub);
  });

  it('public read policy exists but is off until enabled', async () => {
    const before = await withActor(sql, { kind: 'anon' }, (tx) => tx`select * from m0001_registries.parties`);
    expect(before).toHaveLength(0);
    await sql`insert into core.settings (scope, key, value) values ('core', 'public_access_enabled', 'true'::jsonb)`;
    const after = await withActor(
      sql,
      { kind: 'anon' },
      (tx) => tx`select abbreviation, visibility from m0001_registries.parties`,
    );
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((r) => r.visibility === 'public')).toBe(true);
    await sql`delete from core.settings where scope = 'core' and key = 'public_access_enabled'`;
  });

  it('sync never overwrites manually edited fields', async () => {
    const asAdmin = { kind: 'user' as const, userId: admin.sub, email: admin.email };
    const api = rt.registry.get('0.001').api;
    const kok = await withActor(sql, asAdmin, (tx) => api.getPartyByAbbreviation(tx, 'KOK'));
    await withActor(sql, asAdmin, (tx) =>
      api.update(tx, 'parties', kok!.id, { color: '#123456', website: 'https://kokoomus.example' }),
    );
    const r = await withActor(sql, { kind: 'system', label: 'test-sync' }, (tx) =>
      upsertSynced(
        tx,
        'm0001_registries.parties',
        { id: kok!.id, color: '#006288', nameEn: 'NCP (from source)', website: 'https://www.kokoomus.fi' },
        { key: ['id'], source: 'seed', overwriteSources: ['seed'] },
      ),
    );
    expect(r.conflicts.sort()).toEqual(['color', 'website']);
    const after = await withActor(sql, asAdmin, (tx) => api.get(tx, 'parties', kok!.id));
    expect(after.color).toBe('#123456');
    expect(after.website).toBe('https://kokoomus.example');
    expect(after.nameEn).toBe('NCP (from source)');
    expect(after.manualFields).toEqual(['color', 'website']);
  });

  it('audit log records changes and restores an earlier version; trash restores deletes', async () => {
    const asAdmin = { kind: 'user' as const, userId: admin.sub, email: admin.email };
    const api = rt.registry.get('0.001').api;
    const sdp = await withActor(sql, asAdmin, (tx) => api.getPartyByAbbreviation(tx, 'SDP'));
    await withActor(sql, asAdmin, (tx) => api.update(tx, 'parties', sdp!.id, { notes: 'eka' }));
    await withActor(sql, asAdmin, (tx) => api.update(tx, 'parties', sdp!.id, { notes: 'toka' }));
    const history = await withActor(sql, asAdmin, (tx) =>
      recordHistory(tx, 'm0001_registries.parties', sdp!.id),
    );
    const first = history.find((h) => h.newData?.notes === 'eka')!;
    expect(first.actorId).toBe(admin.sub);
    expect(first.changedFields).toContain('notes');
    await withActor(sql, asAdmin, (tx) => restoreFromAudit(tx, first.id, rt.registry.tables()));
    expect((await withActor(sql, asAdmin, (tx) => api.get(tx, 'parties', sdp!.id))).notes).toBe('eka');

    await withActor(sql, asAdmin, (tx) => api.remove(tx, 'parties', sdp!.id));
    const visible = await withActor(
      sql,
      { kind: 'user', userId: reader.sub, email: reader.email },
      (tx) => tx`select id from m0001_registries.parties where id = ${sdp!.id}`,
    );
    expect(visible).toHaveLength(0);
    const trash = await withActor(sql, asAdmin, (tx) => listTrash(tx, rt.registry.tables()));
    expect(trash.some((t) => t.id === sdp!.id)).toBe(true);
    await withActor(sql, asAdmin, (tx) =>
      restoreFromTrash(tx, 'm0001_registries.parties', sdp!.id, rt.registry.tables()),
    );
    expect((await withActor(sql, asAdmin, (tx) => api.get(tx, 'parties', sdp!.id))).deletedAt).toBeNull();
  });

  it('outbox events are published with the data change and delivered to subscribers', async () => {
    const [ev] =
      await sql`select type, source_module, payload from core.outbox where type = 'party.created' order by id desc limit 1`;
    expect(ev?.sourceModule).toBe('0.001');
    const seen: string[] = [];
    rt.events.subscribe({
      consumer: 'test:parties',
      types: ['party.updated'],
      handler: async (e) => void seen.push(e.type),
    });
    const n = await rt.events.dispatch(sql, rt.log);
    expect(n).toBeGreaterThan(0);
    expect(seen.every((t) => t === 'party.updated')).toBe(true);
    expect(await rt.events.dispatch(sql, rt.log)).toBe(0);
  });

  it('job queue runs a job with progress and records the result', async () => {
    rt.jobs.register({
      type: 'test:count',
      moduleId: '0.000',
      description: 'Testi',
      permission: 'core.admin',
      placement: 'worker',
      async run(jc) {
        await jc.progress(5, 10, 'puolessa välissä');
        return { ok: true };
      },
    });
    const job = await enqueueJob(sql, { type: 'test:count', moduleId: '0.000' });
    expect(await rt.runJobById(job.id)).toBe('succeeded');
    const [done] = await sql`select status, progress_done, result from core.jobs where id = ${job.id}`;
    expect(done).toMatchObject({ status: 'succeeded', progressDone: 5, result: { ok: true } });
  });

  it('module backup round-trips as provider-neutral JSON', async () => {
    const m = registriesModule.manifest;
    const backup = await exportModule(sql, m);
    expect(backup.tables['m0001_registries.parties']!.length).toBeGreaterThanOrEqual(10);
    await sql`update m0001_registries.parties set name_fi = 'RIKOTTU' where abbreviation = 'VAS'`;
    await withActor(sql, { kind: 'system', label: 'test' }, (tx) => importModule(tx, m, backup));
    const [vas] = await sql`select name_fi from m0001_registries.parties where abbreviation = 'VAS'`;
    expect(vas?.nameFi).toBe('Vasemmistoliitto');
    await expect(importModule(sql, m, { ...backup, schemaVersion: 99 })).rejects.toThrow(/uudemmasta/);
  });

  it('module backup job encrypts to the backup target', async () => {
    const job = await enqueueJob(sql, {
      type: 'backup:module',
      moduleId: '0.000',
      payload: { moduleId: '0.001' },
    });
    expect(await rt.runJobById(job.id)).toBe('succeeded');
    const files = await rt.services.backup.list('modules/0.001/');
    expect(files).toHaveLength(1);
  });
});
