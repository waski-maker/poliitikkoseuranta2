import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRuntime,
  syncPermissions,
  withActor,
  type Runtime,
  type Sql,
  type ServerModule,
} from '@ps/core';
import { databaseAvailable, resetDatabase, testConfig } from '@ps/core/testing';
import { groupPrefix, normalizeReferenceItem, unwrapList } from '../src/sync/eduskunta.ts';
import { registriesModule } from '../src/index.ts';

// Shapes as returned by api.eduskunta.fi (see docs/DATA-SOURCES.md): localised
// names, `tunnus` with "CODE~NAME" for parliamentary groups, `aktiivinen`.
const fixtures: Record<string, unknown> = {
  'reference-data/eduskuntaryhmat': {
    eduskuntaryhmat: [
      {
        tunnus: 'PS01~PERUSSUOMALAISTEN EDUSKUNTARYHMÄ',
        nimi: {
          fi: 'Perussuomalaisten eduskuntaryhmä',
          sv: 'Sannfinländarnas riksdagsgrupp',
          en: 'The Finns Party Parliamentary Group',
        },
        aktiivinen: true,
      },
      {
        tunnus: 'VAS01~VASEMMISTOLIITON EDUSKUNTARYHMÄ',
        nimi: { fi: 'Vasemmistoliiton eduskuntaryhmä' },
        aktiivinen: true,
      },
      { tunnus: 'XYZ01~KADONNUT RYHMÄ', aktiivinen: false },
      { nimi: { fi: 'Ei tunnusta' } },
    ],
  },
  'reference-data/vaalipiirit': [
    { tunnus: 'UUS02', nimi: { fi: 'Uudenmaan vaalipiiri', sv: 'Nylands valkrets' }, aktiivinen: true },
  ],
  'reference-data/vaalikaudet': [
    { tunnus: '2023-2027', nimi: { fi: 'Vaalikausi 2023–2027' }, alkupvm: '2023-04-05', loppupvm: null },
  ],
  'reference-data/valiokunnat': [
    { tunnus: 'PeV', nimi: { fi: 'Perustuslakivaliokunta', sv: 'Grundlagsutskottet' }, aktiivinen: true },
  ],
};

const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  const key = Object.keys(fixtures).find((k) => url.endsWith(k));
  if (!key) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(fixtures[key]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

describe('reference data adapter', () => {
  it('normalises items and rejects unexpected shapes', () => {
    const list = unwrapList(fixtures['reference-data/eduskuntaryhmat']);
    expect(list).toHaveLength(4);
    expect(normalizeReferenceItem(list[0]!).item).toMatchObject({
      code: 'PS01',
      nameFi: 'Perussuomalaisten eduskuntaryhmä',
      active: true,
    });
    expect(normalizeReferenceItem(list[2]!).item?.nameFi).toBe('Kadonnut ryhmä');
    expect(normalizeReferenceItem(list[3]!).problem).toMatch(/tunnus/);
    expect(groupPrefix('KESK01')).toBe('KESK');
    expect(() => unwrapList('x')).toThrow();
  });
});

const available = await databaseAvailable();

describe.skipIf(!available)('registries sync', () => {
  let sql: Sql;
  let rt: Runtime;
  beforeAll(async () => {
    sql = await resetDatabase();
    rt = await createRuntime({
      config: testConfig({ EDUSKUNTA_MIN_INTERVAL_MS: '0' }),
      sql,
      modules: [registriesModule as ServerModule],
      host: 'test',
      forceMemoryStorage: true,
      fetch: fakeFetch,
    });
    await syncPermissions(sql, rt.registry.manifests());
    await registriesModule.seed!(rt);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('imports groups linked to parties, merges districts and committees with seed data, and is idempotent', async () => {
    const r1 = await rt.runSync('0.001:eduskunta-reference');
    expect(r1.status).toBe('partial'); // one item without tunnus
    expect(r1.counters.inserted).toBeGreaterThanOrEqual(3);
    const [ps] = await sql`select g.code, p.abbreviation from m0001_registries.parliamentary_groups g
      left join m0001_registries.parties p on p.id = g.party_id where g.code = 'PS01'`;
    expect(ps).toMatchObject({ code: 'PS01', abbreviation: 'PS' });
    // Seeded district matched by name; Eduskunta code stored as external id.
    const districts =
      await sql`select code, source from m0001_registries.electoral_districts where name_fi = 'Uudenmaan vaalipiiri'`;
    expect(districts).toHaveLength(1);
    expect(districts[0]).toMatchObject({ code: 'UUS', source: 'eduskunta' });
    const [ext] =
      await sql`select value from core.external_ids where entity_type = 'electoral_district' and system = 'eduskunta'`;
    expect(ext?.value).toBe('UUS02');
    const pev = await sql`select code from m0001_registries.bodies where name_fi = 'Perustuslakivaliokunta'`;
    expect(pev).toHaveLength(1);

    const r2 = await rt.runSync('0.001:eduskunta-reference');
    expect(r2.counters.inserted).toBe(0);
    expect(r2.counters.updated).toBe(0);
    const runs = await sql`select status from core.sync_runs order by started_at`;
    expect(runs).toHaveLength(2);
  });

  it('keeps manual edits on re-sync', async () => {
    const admin = { kind: 'system' as const, label: 'test' };
    await withActor(
      sql,
      admin,
      (tx) =>
        tx`update m0001_registries.parliamentary_groups set name_fi = 'Oma nimi', manual_fields = '{name_fi}' where code = 'VAS01'`,
    );
    await rt.runSync('0.001:eduskunta-reference');
    const [g] = await sql`select name_fi from m0001_registries.parliamentary_groups where code = 'VAS01'`;
    expect(g?.nameFi).toBe('Oma nimi');
  });

  it('reports a failed run when the source is unreachable', async () => {
    const offline = await createRuntime({
      config: testConfig({ EDUSKUNTA_MIN_INTERVAL_MS: '0' }),
      sql,
      modules: [registriesModule as ServerModule],
      host: 'test',
      forceMemoryStorage: true,
      fetch: async () => new Response('forbidden', { status: 403 }),
    });
    const r = await offline.runSync('0.001:eduskunta-reference');
    expect(r.status).toBe('failed');
    const [src] =
      await sql`select consecutive_failures from core.sync_sources where id = '0.001:eduskunta-reference'`;
    expect(src?.consecutiveFailures).toBe(1);
  });
});
