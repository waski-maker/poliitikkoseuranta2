import type { Db } from '@ps/core';
import { indexDocument, upsertSynced } from '@ps/core';
import { TABLES } from '../schema.ts';
import { BODIES, DISTRICTS, GOVERNMENTS, PARTIES, POSITION_TYPES, TERMS } from './data.ts';
import { ENTITIES, type EntityName } from '../api.ts';
import { manifest } from '../manifest.ts';

const SEED_SOURCE = 'https://github.com/ (docs/DATA-SOURCES.md: Perusrekisterien alkudata)';

/**
 * Idempotent seed of module 0.001. Uses the same "never overwrite manual
 * edits" upsert as synchronisation, so running it again is always safe.
 */
export async function seedRegistries(db: Db): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const bump = (k: string, outcome: string) => {
    if (outcome !== 'unchanged') counts[k] = (counts[k] ?? 0) + 1;
  };
  const opts = (key: string[]) => ({
    key,
    source: 'seed' as const,
    sourceUrl: SEED_SOURCE,
    overwriteSources: ['seed' as const],
  });

  for (const p of PARTIES) {
    const existing = await db<{ id: string }[]>`select id from m0001_registries.parties
      where upper(abbreviation) = ${p.abbreviation} and deleted_at is null`;
    const data = {
      abbreviation: p.abbreviation,
      nameFi: p.nameFi,
      nameSv: p.nameSv,
      nameEn: p.nameEn,
      officialName: p.officialName,
      parliamentaryGroupName: p.parliamentaryGroupName,
      color: p.color,
      website: p.website,
      status: p.status,
      visibility: 'public',
    };
    const r = existing[0]
      ? await upsertSynced(db, TABLES.parties, { id: existing[0].id, ...data }, opts(['id']))
      : await upsertSynced(db, TABLES.parties, data, opts(['abbreviation']));
    bump('parties', r.outcome);
  }
  for (const d of DISTRICTS) {
    const r = await upsertSynced(
      db,
      TABLES.electoralDistricts,
      {
        code: d.code,
        nameFi: d.nameFi,
        nameSv: d.nameSv,
        validFrom: d.validFrom,
        validTo: d.validTo,
        notes: d.notes ?? null,
        visibility: 'public',
      },
      opts(['code']),
    );
    bump('electoralDistricts', r.outcome);
  }
  for (const t of TERMS) {
    const r = await upsertSynced(
      db,
      TABLES.electoralTerms,
      { code: t.code, name: t.name, startDate: t.startDate, endDate: t.endDate, visibility: 'public' },
      opts(['code']),
    );
    bump('electoralTerms', r.outcome);
  }
  for (const g of GOVERNMENTS) {
    const r = await upsertSynced(
      db,
      TABLES.governments,
      {
        code: g.code,
        name: g.name,
        nameSv: g.nameSv,
        ordinal: g.ordinal,
        primeMinisterName: g.primeMinister,
        startDate: g.startDate,
        endDate: g.endDate,
        visibility: 'public',
      },
      opts(['code']),
    );
    bump('governments', r.outcome);
    for (const gp of g.parties) {
      const [party] = await db<{ id: string }[]>`select id from m0001_registries.parties
        where upper(abbreviation) = ${gp.abbreviation} and deleted_at is null`;
      if (!party) continue;
      await db`insert into m0001_registries.government_parties (government_id, party_id, joined_at, left_at, source, visibility)
        values (${r.id}, ${party.id}, ${gp.joinedAt ?? null}, ${gp.leftAt ?? null}, 'seed', 'public')
        on conflict (government_id, party_id) do nothing`;
    }
  }
  for (const b of BODIES) {
    const r = await upsertSynced(
      db,
      TABLES.bodies,
      {
        code: b.code,
        abbreviation: b.abbreviation,
        nameFi: b.nameFi,
        nameSv: b.nameSv,
        type: b.type,
        validFrom: b.validFrom ?? null,
        visibility: 'public',
      },
      opts(['code']),
    );
    bump('bodies', r.outcome);
  }
  for (const pt of POSITION_TYPES) {
    const r = await upsertSynced(
      db,
      TABLES.positionTypes,
      {
        code: pt.code,
        nameFi: pt.nameFi,
        nameSv: pt.nameSv,
        level: pt.level,
        isSystem: true,
        sortOrder: pt.sortOrder,
        visibility: 'public',
      },
      opts(['code']),
    );
    bump('positionTypes', r.outcome);
  }
  await reindexRegistries(db);
  return counts;
}

/** Rebuilds the search index entries of searchable registry entities. */
export async function reindexRegistries(db: Db): Promise<number> {
  let n = 0;
  for (const entity of Object.keys(ENTITIES) as EntityName[]) {
    const def = ENTITIES[entity] as (typeof ENTITIES)[EntityName] & {
      title?: (r: never) => string;
      body?: (r: never) => string;
      urlPath?: (r: never) => string;
      searchType?: string;
    };
    if (!def.searchType || !def.title) continue;
    const rows = (await db.unsafe(
      `select * from ${def.table} where deleted_at is null`,
    )) as unknown as never[];
    for (const row of rows) {
      const r = row as { id: string; visibility: 'public' | 'internal' | 'private'; color?: string };
      await indexDocument(db, {
        contentType: def.searchType,
        refId: r.id,
        moduleId: manifest.id,
        title: def.title(row),
        body: def.body?.(row) ?? null,
        urlPath: def.urlPath?.(row) ?? null,
        visibility: r.visibility,
        readPermission: 'registries.read',
        meta: entity === 'parties' ? { color: r.color ?? null } : {},
      });
      n++;
    }
  }
  return n;
}
