import type { Db, ListOptions } from '@ps/core';
import {
  getRow,
  indexDocument,
  insertRow,
  listRows,
  removeDocument,
  restoreRow,
  softDeleteRow,
  updateRow,
  NotFoundError,
  ValidationError,
} from '@ps/core';
import { TABLES } from './schema.ts';
import type {
  Body,
  ElectoralDistrict,
  ElectoralTerm,
  Government,
  GovernmentParty,
  ParliamentaryGroup,
  Party,
  PartyRelation,
  PositionType,
} from './schema.ts';
import { publishPartyEvents, publishRegistryUpdated } from './events.ts';
import { manifest } from './manifest.ts';

export interface EntityRows {
  parties: Party;
  'parliamentary-groups': ParliamentaryGroup;
  'electoral-districts': ElectoralDistrict;
  'electoral-terms': ElectoralTerm;
  governments: Government;
  bodies: Body;
  'position-types': PositionType;
}

export type EntityName = keyof EntityRows;

interface EntityDef<R> {
  table: string;
  label: string;
  orderBy: string;
  searchColumns: string[];
  searchType?: string;
  urlPath?: (r: R) => string;
  title?: (r: R) => string;
  body?: (r: R) => string;
}

export const ENTITIES: { [K in EntityName]: EntityDef<EntityRows[K]> } = {
  parties: {
    table: TABLES.parties,
    label: 'Puolue',
    orderBy: 'nameFi',
    searchColumns: ['nameFi', 'nameSv', 'abbreviation', 'officialName'],
    searchType: 'party',
    urlPath: (r) => `/rekisterit/puolueet/${r.id}`,
    title: (r) => `${r.nameFi} (${r.abbreviation})`,
    body: (r) => [r.officialName, r.nameSv, r.nameEn, r.parliamentaryGroupName].filter(Boolean).join(' · '),
  },
  'parliamentary-groups': {
    table: TABLES.parliamentaryGroups,
    label: 'Eduskuntaryhmä',
    orderBy: 'nameFi',
    searchColumns: ['nameFi', 'code'],
  },
  'electoral-districts': {
    table: TABLES.electoralDistricts,
    label: 'Vaalipiiri',
    orderBy: 'nameFi',
    searchColumns: ['nameFi', 'nameSv', 'code'],
  },
  'electoral-terms': {
    table: TABLES.electoralTerms,
    label: 'Vaalikausi',
    orderBy: 'startDate desc',
    searchColumns: ['name', 'code'],
  },
  governments: {
    table: TABLES.governments,
    label: 'Hallitus',
    orderBy: 'startDate desc',
    searchColumns: ['name', 'primeMinisterName', 'code'],
    searchType: 'government',
    urlPath: (r) => `/rekisterit/hallitukset/${r.id}`,
    title: (r) => r.name,
    body: (r) => `${r.primeMinisterName ?? ''} ${r.startDate}–${r.endDate ?? ''}`,
  },
  bodies: {
    table: TABLES.bodies,
    label: 'Valiokunta tai toimielin',
    orderBy: 'nameFi',
    searchColumns: ['nameFi', 'nameSv', 'abbreviation', 'code'],
    searchType: 'body',
    urlPath: (r) => `/rekisterit/valiokunnat/${r.id}`,
    title: (r) => r.nameFi,
    body: (r) => [r.abbreviation, r.nameSv].filter(Boolean).join(' · '),
  },
  'position-types': {
    table: TABLES.positionTypes,
    label: 'Luottamustoimen tyyppi',
    orderBy: 'sortOrder, nameFi',
    searchColumns: ['nameFi', 'code'],
  },
};

export function isEntity(name: string): name is EntityName {
  return name in ENTITIES;
}

async function reindex<E extends EntityName>(db: Db, entity: E, row: EntityRows[E]): Promise<void> {
  const def = ENTITIES[entity] as EntityDef<EntityRows[E]>;
  if (!def.searchType || !def.title) return;
  if (row.deletedAt) {
    await removeDocument(db, def.searchType, row.id);
    return;
  }
  await indexDocument(db, {
    contentType: def.searchType,
    refId: row.id,
    moduleId: manifest.id,
    title: def.title(row),
    body: def.body?.(row) ?? null,
    urlPath: def.urlPath?.(row) ?? null,
    visibility: row.visibility,
    readPermission: 'registries.read',
    meta: entity === 'parties' ? { color: (row as Party).color } : {},
  });
}

function validateParty(data: Partial<Party>): void {
  if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color))
    throw new ValidationError('Värin on oltava muotoa #RRGGBB');
  if (data.abbreviation !== undefined && !data.abbreviation.trim())
    throw new ValidationError('Lyhenne puuttuu');
}

/**
 * Public API of module 0.001. Every method takes an actor-scoped connection
 * (from ctx.withActor), so permissions and RLS apply to the caller.
 */
export function createRegistriesApi() {
  const api = {
    entities: ENTITIES,

    list<E extends EntityName>(
      db: Db,
      entity: E,
      opts: ListOptions & { q?: string } = {},
    ): Promise<EntityRows[E][]> {
      const def = ENTITIES[entity];
      return listRows<EntityRows[E]>(db, def.table, {
        ...opts,
        orderBy: opts.orderBy ?? def.orderBy,
        search: opts.q ? { q: opts.q, columns: def.searchColumns } : undefined,
      });
    },

    get<E extends EntityName>(db: Db, entity: E, id: string): Promise<EntityRows[E]> {
      return getRow<EntityRows[E]>(db, ENTITIES[entity].table, id);
    },

    async create<E extends EntityName>(
      db: Db,
      entity: E,
      data: Partial<EntityRows[E]>,
    ): Promise<EntityRows[E]> {
      if (entity === 'parties') validateParty(data as Partial<Party>);
      const row = await insertRow<EntityRows[E]>(db, ENTITIES[entity].table, {
        ...data,
        source: data.source ?? 'manual',
      });
      await reindex(db, entity, row);
      if (entity === 'parties') await publishPartyEvents(db, row.id, (row as Party).abbreviation, null);
      else await publishRegistryUpdated(db, { entity, id: row.id, action: 'created' });
      return row;
    },

    async update<E extends EntityName>(
      db: Db,
      entity: E,
      id: string,
      patch: Partial<EntityRows[E]>,
    ): Promise<EntityRows[E]> {
      if (entity === 'parties') validateParty(patch as Partial<Party>);
      const { after, changed } = await updateRow<EntityRows[E]>(db, ENTITIES[entity].table, id, patch);
      if (changed.length) {
        await reindex(db, entity, after);
        if (entity === 'parties') await publishPartyEvents(db, id, (after as Party).abbreviation, changed);
        else await publishRegistryUpdated(db, { entity, id, action: 'updated' });
      }
      return after;
    },

    async remove(db: Db, entity: EntityName, id: string): Promise<void> {
      await softDeleteRow(db, ENTITIES[entity].table, id);
      const def = ENTITIES[entity];
      if (def.searchType) await removeDocument(db, def.searchType, id);
      await publishRegistryUpdated(db, { entity, id, action: 'deleted' });
    },

    async restore(db: Db, entity: EntityName, id: string): Promise<void> {
      await restoreRow(db, ENTITIES[entity].table, id);
      await reindex(db, entity, await getRow(db, ENTITIES[entity].table, id));
      await publishRegistryUpdated(db, { entity, id, action: 'restored' });
    },

    async getPartyByAbbreviation(db: Db, abbreviation: string): Promise<Party | null> {
      const [p] = await db<Party[]>`select * from m0001_registries.parties
        where upper(abbreviation) = upper(${abbreviation}) and deleted_at is null`;
      return p ?? null;
    },

    /** Resolves an Eduskunta parliamentary group code (e.g. "PS01~…") to a group and its party. */
    async resolveGroup(
      db: Db,
      groupCode: string,
    ): Promise<{ group: ParliamentaryGroup | null; party: Party | null }> {
      const code = groupCode.split('~')[0]!.trim();
      const [group] = await db<ParliamentaryGroup[]>`select * from m0001_registries.parliamentary_groups
        where code = ${code} and deleted_at is null`;
      if (!group?.partyId) return { group: group ?? null, party: null };
      const [party] = await db<Party[]>`select * from m0001_registries.parties where id = ${group.partyId}`;
      return { group, party: party ?? null };
    },

    async termForDate(db: Db, date: string): Promise<ElectoralTerm | null> {
      const [t] = await db<ElectoralTerm[]>`select * from m0001_registries.electoral_terms
        where deleted_at is null and start_date <= ${date}::date and (end_date is null or end_date >= ${date}::date)
        order by start_date desc limit 1`;
      return t ?? null;
    },

    currentTerm(db: Db): Promise<ElectoralTerm | null> {
      return api.termForDate(db, new Date().toISOString().slice(0, 10));
    },

    async governmentForDate(db: Db, date: string): Promise<Government | null> {
      const [g] = await db<Government[]>`select * from m0001_registries.governments
        where deleted_at is null and start_date <= ${date}::date and (end_date is null or end_date > ${date}::date)
        order by start_date desc limit 1`;
      return g ?? null;
    },

    async governmentParties(db: Db, governmentId: string): Promise<(GovernmentParty & { party: Party })[]> {
      const rows = await db<(GovernmentParty & { party: Party })[]>`
        select gp.*, to_jsonb(p) as party
        from m0001_registries.government_parties gp
        join m0001_registries.parties p on p.id = gp.party_id
        where gp.government_id = ${governmentId} and gp.deleted_at is null
        order by p.name_fi`;
      return rows.map((r) => ({
        ...r,
        party: camelize(r.party as unknown as Record<string, unknown>) as unknown as Party,
      }));
    },

    async setGovernmentParties(
      db: Db,
      governmentId: string,
      parties: { partyId: string; joinedAt?: string | null; leftAt?: string | null }[],
    ): Promise<void> {
      await getRow(db, TABLES.governments, governmentId);
      const keep = parties.map((p) => p.partyId);
      await db`update m0001_registries.government_parties set deleted_at = now()
        where government_id = ${governmentId} and deleted_at is null and not (party_id = any(${keep}))`;
      for (const p of parties) {
        await db`insert into m0001_registries.government_parties (government_id, party_id, joined_at, left_at, source)
          values (${governmentId}, ${p.partyId}, ${p.joinedAt ?? null}, ${p.leftAt ?? null}, 'manual')
          on conflict (government_id, party_id) do update set joined_at = excluded.joined_at,
            left_at = excluded.left_at, deleted_at = null`;
      }
      await publishRegistryUpdated(db, { entity: 'governments', id: governmentId, action: 'updated' });
    },

    async partyRelations(db: Db, partyId: string): Promise<(PartyRelation & { relatedParty: Party })[]> {
      const rows = await db<(PartyRelation & { relatedParty: Party })[]>`
        select r.*, to_jsonb(p) as related_party
        from m0001_registries.party_relations r
        join m0001_registries.parties p on p.id = r.related_party_id
        where r.party_id = ${partyId} and r.deleted_at is null
        order by r.relation_date nulls last`;
      return rows.map((r) => ({
        ...r,
        relatedParty: camelize(r.relatedParty as unknown as Record<string, unknown>) as unknown as Party,
      }));
    },

    /** Adds a predecessor/successor link and its mirror relation on the other party. */
    async addPartyRelation(
      db: Db,
      input: {
        partyId: string;
        relatedPartyId: string;
        relation: 'predecessor' | 'successor';
        relationDate?: string | null;
        note?: string | null;
      },
    ): Promise<PartyRelation> {
      if (input.partyId === input.relatedPartyId)
        throw new ValidationError('Puolue ei voi olla oma edeltäjänsä');
      const mirror = input.relation === 'predecessor' ? 'successor' : 'predecessor';
      const [row] = await db<PartyRelation[]>`
        insert into m0001_registries.party_relations (party_id, related_party_id, relation, relation_date, note, source)
        values (${input.partyId}, ${input.relatedPartyId}, ${input.relation}, ${input.relationDate ?? null}, ${input.note ?? null}, 'manual')
        on conflict (party_id, related_party_id, relation) do update set relation_date = excluded.relation_date,
          note = excluded.note, deleted_at = null
        returning *`;
      await db`insert into m0001_registries.party_relations (party_id, related_party_id, relation, relation_date, note, source)
        values (${input.relatedPartyId}, ${input.partyId}, ${mirror}, ${input.relationDate ?? null}, ${input.note ?? null}, 'manual')
        on conflict (party_id, related_party_id, relation) do update set deleted_at = null`;
      return row!;
    },

    async removePartyRelation(db: Db, relationId: string): Promise<void> {
      const [r] = await db<PartyRelation[]>`update m0001_registries.party_relations set deleted_at = now()
        where id = ${relationId} and deleted_at is null returning *`;
      if (!r) throw new NotFoundError();
      const mirror = r.relation === 'predecessor' ? 'successor' : 'predecessor';
      await db`update m0001_registries.party_relations set deleted_at = now()
        where party_id = ${r.relatedPartyId} and related_party_id = ${r.partyId} and relation = ${mirror}`;
    },

    async summary(db: Db) {
      const [row] = await db<
        {
          parties: number;
          activeParties: number;
          groups: number;
          districts: number;
          terms: number;
          governments: number;
          bodies: number;
          positionTypes: number;
        }[]
      >`select
          (select count(*)::int from m0001_registries.parties where deleted_at is null) as parties,
          (select count(*)::int from m0001_registries.parties where deleted_at is null and status = 'active') as active_parties,
          (select count(*)::int from m0001_registries.parliamentary_groups where deleted_at is null) as groups,
          (select count(*)::int from m0001_registries.electoral_districts where deleted_at is null) as districts,
          (select count(*)::int from m0001_registries.electoral_terms where deleted_at is null) as terms,
          (select count(*)::int from m0001_registries.governments where deleted_at is null) as governments,
          (select count(*)::int from m0001_registries.bodies where deleted_at is null) as bodies,
          (select count(*)::int from m0001_registries.position_types where deleted_at is null) as position_types`;
      const term = await api.currentTerm(db);
      const government = await api.governmentForDate(db, new Date().toISOString().slice(0, 10));
      return { ...row!, currentTerm: term, currentGovernment: government };
    },
  };
  return api;
}

export type RegistriesApi = ReturnType<typeof createRegistriesApi>;

function camelize(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), v]),
  );
}

declare module '@ps/core' {
  interface ModuleApis {
    '0.001': RegistriesApi;
  }
}
