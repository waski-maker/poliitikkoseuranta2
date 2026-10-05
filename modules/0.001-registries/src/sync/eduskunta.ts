import type { Db, SyncContext, SyncSourceDefinition } from '@ps/core';
import { upsertSynced } from '@ps/core';
import { TABLES } from '../schema.ts';
import { PARTIES } from '../seed/data.ts';
import { manifest } from '../manifest.ts';

/**
 * Eduskunta reference data (api.eduskunta.fi/api/v1/reference-data/{name}).
 * Verified structure (see docs/DATA-SOURCES.md): the response is either an
 * array or an object wrapping one array; items carry `tunnus`, a localised
 * `nimi` ({fi, sv, en}) and `aktiivinen`; parliamentary group codes look
 * like "PS01~PERUSSUOMALAISTEN EDUSKUNTARYHMÄ". The adapter validates every
 * item and logs anything unexpected instead of guessing.
 */

export type Localized =
  string | { fi?: string | null; sv?: string | null; en?: string | null } | null | undefined;

export interface ReferenceItem {
  code: string;
  nameFi: string;
  nameSv: string | null;
  nameEn: string | null;
  active: boolean | null;
  validFrom: string | null;
  validTo: string | null;
  raw: Record<string, unknown>;
}

export function localized(v: Localized, lang: 'fi' | 'sv' | 'en' = 'fi'): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return v[lang] ?? null;
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1]! : null;
}

function pickDate(raw: Record<string, unknown>, patterns: RegExp[]): string | null {
  for (const [k, v] of Object.entries(raw)) {
    if (patterns.some((p) => p.test(k))) {
      const d = isoDate(v);
      if (d) return d;
    }
  }
  return null;
}

/** Unwraps the list from a reference-data response. */
export function unwrapList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === 'object') {
    const list = Object.values(payload).find(Array.isArray);
    if (list) return list as Record<string, unknown>[];
  }
  throw new Error('Odottamaton viitetietovastaus: listaa ei löytynyt');
}

/** Normalises one reference item. Returns null (and a reason) for items that do not match the verified shape. */
export function normalizeReferenceItem(raw: Record<string, unknown>): {
  item: ReferenceItem | null;
  problem?: string;
} {
  const rawCode =
    typeof raw.tunnus === 'string' ? raw.tunnus : typeof raw.koodi === 'string' ? raw.koodi : null;
  if (!rawCode) return { item: null, problem: 'tunnus puuttuu' };
  const [codePart, namePart] = rawCode.split('~');
  const nameFi = localized(raw.nimi as Localized) ?? (namePart ? titleCase(namePart) : null);
  if (!nameFi) return { item: null, problem: `nimi puuttuu (${rawCode})` };
  return {
    item: {
      code: codePart!.trim(),
      nameFi: nameFi.trim(),
      nameSv: localized(raw.nimi as Localized, 'sv'),
      nameEn: localized(raw.nimi as Localized, 'en'),
      active: typeof raw.aktiivinen === 'boolean' ? raw.aktiivinen : null,
      validFrom: pickDate(raw, [/^alku/i, /start/i, /^voimassa.*alk/i]),
      validTo: pickDate(raw, [/^loppu/i, /end/i, /paatty/i, /^voimassa.*lop/i]),
      raw,
    },
  };
}

export function titleCase(s: string): string {
  const lower = s.trim().toLocaleLowerCase('fi');
  return lower.charAt(0).toLocaleUpperCase('fi') + lower.slice(1);
}

/** "PS01" → "PS"; matches the parliamentary group to a party by code prefix. */
export function groupPrefix(code: string): string {
  return code.replace(/\d+$/, '').toUpperCase();
}

async function linkExternalId(db: Db, entityType: string, entityId: string, value: string): Promise<void> {
  await db`insert into core.external_ids (entity_type, entity_id, system, value)
           values (${entityType}, ${entityId}, 'eduskunta', ${value})
           on conflict (system, entity_type, value) do update set entity_id = excluded.entity_id`;
}

async function findByExternalOrName(db: Db, table: string, entityType: string, item: ReferenceItem) {
  const [byExt] = await db<{ entityId: string }[]>`
    select entity_id from core.external_ids where system = 'eduskunta' and entity_type = ${entityType} and value = ${item.code}`;
  if (byExt) return byExt.entityId;
  const rows = (await db.unsafe(
    `select id from ${table} where lower(name_fi) = lower($1) and deleted_at is null limit 1`,
    [item.nameFi],
  )) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

const SOURCE_URL = (name: string, base: string) => `${base.replace(/\/$/, '')}/reference-data/${name}`;

export function referenceSync(baseUrl: () => string): SyncSourceDefinition {
  return {
    id: '0.001:eduskunta-reference',
    moduleId: manifest.id,
    name: 'Perusrekisterit: eduskunnan viitetiedot',
    description: 'Eduskuntaryhmät, vaalipiirit, vaalikaudet ja valiokunnat api.eduskunta.fi:n viitetiedoista',
    dataSource: 'eduskunta',
    schedule: '15 3 * * *',
    async run(ctx: SyncContext) {
      const http = ctx.createHttp();
      const kinds = ['eduskuntaryhmat', 'vaalipiirit', 'vaalikaudet', 'valiokunnat'] as const;
      let step = 0;
      const failures: string[] = [];
      for (const kind of kinds) {
        await ctx.progress(step++, kinds.length, `Haetaan ${kind}`);
        let list: Record<string, unknown>[];
        try {
          list = unwrapList(await http.json(`reference-data/${kind}`));
        } catch (err) {
          const msg = `${kind}: ${err instanceof Error ? err.message : String(err)}`;
          failures.push(msg);
          ctx.itemError(msg);
          continue;
        }
        ctx.counters.fetched += list.length;
        for (const raw of list) {
          const { item, problem } = normalizeReferenceItem(raw);
          if (!item) {
            ctx.counters.skipped++;
            ctx.itemError(`${kind}: ${problem}`, raw);
            continue;
          }
          await ctx.sql.begin(async (tx) => {
            await tx`select set_config('app.actor_label', 'sync:eduskunta', true)`;
            const outcome = await applyItem(tx, kind, item, SOURCE_URL(kind, baseUrl()));
            if (outcome === 'inserted') ctx.counters.inserted++;
            else if (outcome === 'updated') ctx.counters.updated++;
            else ctx.counters.skipped++;
          });
        }
        ctx.log.info(`${kind}: ${list.length} riviä`);
      }
      if (failures.length === kinds.length) {
        throw new Error(`Eduskunnan rajapintaan ei saatu yhteyttä (${failures[0]})`);
      }
      await ctx.progress(kinds.length, kinds.length, 'Valmis');
    },
  };
}

async function applyItem(db: Db, kind: string, item: ReferenceItem, sourceUrl: string): Promise<string> {
  switch (kind) {
    case 'eduskuntaryhmat': {
      const prefix = groupPrefix(item.code);
      const seed = PARTIES.find((p) => p.groupPrefix === prefix);
      let partyId: string | null = null;
      if (seed) {
        const [p] = await db<{ id: string }[]>`select id from m0001_registries.parties
          where upper(abbreviation) = ${seed.abbreviation} and deleted_at is null`;
        partyId = p?.id ?? null;
      }
      const r = await upsertSynced(
        db,
        TABLES.parliamentaryGroups,
        {
          code: item.code,
          nameFi: item.nameFi,
          nameSv: item.nameSv,
          nameEn: item.nameEn,
          active: item.active ?? true,
          validFrom: item.validFrom,
          validTo: item.validTo,
          ...(partyId ? { partyId } : {}),
        },
        { key: ['code'], source: 'eduskunta', sourceUrl },
      );
      await linkExternalId(db, 'parliamentary_group', r.id, item.code);
      return r.outcome;
    }
    case 'vaalipiirit': {
      const existing = await findByExternalOrName(db, TABLES.electoralDistricts, 'electoral_district', item);
      const data = {
        nameFi: item.nameFi,
        nameSv: item.nameSv,
        validFrom: item.validFrom,
        validTo: item.validTo,
      };
      const r = existing
        ? await upsertSynced(
            db,
            TABLES.electoralDistricts,
            { id: existing, ...data },
            { key: ['id'], source: 'eduskunta', sourceUrl },
          )
        : await upsertSynced(
            db,
            TABLES.electoralDistricts,
            { code: item.code, ...data },
            { key: ['code'], source: 'eduskunta', sourceUrl },
          );
      await linkExternalId(db, 'electoral_district', r.id, item.code);
      return r.outcome;
    }
    case 'vaalikaudet': {
      if (!item.validFrom) return 'skipped';
      const [existing] = await db<{ id: string }[]>`select id from m0001_registries.electoral_terms
        where (start_date = ${item.validFrom}::date or code = ${item.code}) and deleted_at is null limit 1`;
      const data = { startDate: item.validFrom, endDate: item.validTo };
      const r = existing
        ? await upsertSynced(
            db,
            TABLES.electoralTerms,
            { id: existing.id, ...data },
            { key: ['id'], source: 'eduskunta', sourceUrl },
          )
        : await upsertSynced(
            db,
            TABLES.electoralTerms,
            { code: item.code, name: `Vaalikausi ${item.code.replace('-', '–')}`, ...data },
            { key: ['code'], source: 'eduskunta', sourceUrl },
          );
      await linkExternalId(db, 'electoral_term', r.id, item.code);
      return r.outcome;
    }
    case 'valiokunnat': {
      const existing = await findByExternalOrName(db, TABLES.bodies, 'body', item);
      const data = {
        nameFi: item.nameFi,
        nameSv: item.nameSv,
        validFrom: item.validFrom,
        validTo: item.validTo,
      };
      const r = existing
        ? await upsertSynced(
            db,
            TABLES.bodies,
            { id: existing, ...data },
            { key: ['id'], source: 'eduskunta', sourceUrl },
          )
        : await upsertSynced(
            db,
            TABLES.bodies,
            { code: item.code, abbreviation: item.code, type: 'committee', ...data },
            { key: ['code'], source: 'eduskunta', sourceUrl },
          );
      await linkExternalId(db, 'body', r.id, item.code);
      return r.outcome;
    }
    default:
      return 'skipped';
  }
}
