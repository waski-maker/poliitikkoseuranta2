import { createRoute, z } from '@hono/zod-openapi';
import type { ModuleContext, ModuleRouter } from '@ps/core';
import {
  ListQuerySchema,
  RecordMetaSchema,
  errorResponses,
  json,
  jsonContent,
  requirePermission,
  NotFoundError,
} from '@ps/core';
import { ENTITIES, isEntity, type EntityName, type RegistriesApi } from './api.ts';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const PartyFields = z.object({
  abbreviation: z.string().min(1).max(20),
  nameFi: z.string().min(1),
  nameSv: z.string().nullable(),
  nameEn: z.string().nullable(),
  officialName: z.string().nullable(),
  registeredAt: date,
  deregisteredAt: date,
  parliamentaryGroupName: z.string().nullable(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable(),
  logoPath: z.string().nullable(),
  website: z.string().nullable(),
  chairPersonId: z.string().uuid().nullable(),
  status: z.enum(['active', 'dissolved']),
  notes: z.string().nullable(),
});

const GroupFields = z.object({
  code: z.string().min(1),
  nameFi: z.string().min(1),
  nameSv: z.string().nullable(),
  nameEn: z.string().nullable(),
  partyId: z.string().uuid().nullable(),
  active: z.boolean(),
  validFrom: date,
  validTo: date,
});

const DistrictFields = z.object({
  code: z.string().min(1),
  nameFi: z.string().min(1),
  nameSv: z.string().nullable(),
  validFrom: date,
  validTo: date,
  notes: z.string().nullable(),
});

const TermFields = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: date,
});

const GovernmentFields = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nameSv: z.string().nullable(),
  ordinal: z.number().int().nullable(),
  primeMinisterName: z.string().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: date,
});

const BodyFields = z.object({
  code: z.string().min(1),
  abbreviation: z.string().nullable(),
  nameFi: z.string().min(1),
  nameSv: z.string().nullable(),
  type: z.enum(['committee', 'body', 'other']),
  validFrom: date,
  validTo: date,
});

const PositionTypeFields = z.object({
  code: z.string().min(1),
  nameFi: z.string().min(1),
  nameSv: z.string().nullable(),
  level: z.enum(['municipal', 'regional', 'state', 'eu', 'party', 'other']),
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
});

const EditableMeta = z.object({ visibility: z.enum(['public', 'internal', 'private']) });

const FIELDS: Record<EntityName, { schema: z.ZodObject; name: string; path: string; tag: string }> = {
  parties: { schema: PartyFields, name: 'Party', path: 'parties', tag: 'Puolueet' },
  'parliamentary-groups': {
    schema: GroupFields,
    name: 'ParliamentaryGroup',
    path: 'parliamentary-groups',
    tag: 'Eduskuntaryhmät',
  },
  'electoral-districts': {
    schema: DistrictFields,
    name: 'ElectoralDistrict',
    path: 'electoral-districts',
    tag: 'Vaalipiirit',
  },
  'electoral-terms': {
    schema: TermFields,
    name: 'ElectoralTerm',
    path: 'electoral-terms',
    tag: 'Vaalikaudet',
  },
  governments: { schema: GovernmentFields, name: 'Government', path: 'governments', tag: 'Hallitukset' },
  bodies: { schema: BodyFields, name: 'Body', path: 'bodies', tag: 'Valiokunnat ja toimielimet' },
  'position-types': {
    schema: PositionTypeFields,
    name: 'PositionType',
    path: 'position-types',
    tag: 'Luottamustoimien tyypit',
  },
};

const IdParam = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: 'id', in: 'path' } }),
});

/** REST endpoints of module 0.001, mounted at /api/v1/registries. */
export function registerRegistryRoutes(router: ModuleRouter, ctx: ModuleContext): void {
  const api = () => ctx.registry.get('0.001').api as RegistriesApi;

  for (const entity of Object.keys(FIELDS) as EntityName[]) {
    const f = FIELDS[entity];
    const Row = RecordMetaSchema.merge(f.schema).openapi(f.name);
    const Create = f.schema.partial().merge(EditableMeta.partial()).openapi(`${f.name}Create`);
    const Patch = f.schema.partial().merge(EditableMeta.partial()).openapi(`${f.name}Patch`);
    const label = ENTITIES[entity].label;

    router.openapi(
      createRoute({
        method: 'get',
        path: `/${f.path}`,
        tags: [f.tag],
        summary: `Listaa: ${label}`,
        request: { query: ListQuerySchema.extend({ q: z.string().optional() }) },
        responses: { 200: jsonContent(z.object({ items: z.array(Row) }), 'Lista'), ...errorResponses },
      }),
      async (c) => {
        const user = requirePermission(c.get('user'), 'registries.read');
        const q = c.req.valid('query');
        const items = await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
          api().list(tx, entity, {
            q: q.q,
            updatedSince: q.updated_since,
            includeDeleted: q.include_deleted === 'true',
            limit: q.limit,
            offset: q.offset,
          }),
        );
        return c.json({ items: json(items) }, 200);
      },
    );

    router.openapi(
      createRoute({
        method: 'get',
        path: `/${f.path}/{id}`,
        tags: [f.tag],
        summary: `Hae: ${label}`,
        request: { params: IdParam },
        responses: { 200: jsonContent(Row, label), ...errorResponses },
      }),
      async (c) => {
        const user = requirePermission(c.get('user'), 'registries.read');
        const row = await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
          api().get(tx, entity, c.req.valid('param').id),
        );
        return c.json(json(row), 200);
      },
    );

    router.openapi(
      createRoute({
        method: 'post',
        path: `/${f.path}`,
        tags: [f.tag],
        summary: `Lisää: ${label}`,
        request: { body: { content: { 'application/json': { schema: Create } }, required: true } },
        responses: { 201: jsonContent(Row, 'Luotu'), ...errorResponses },
      }),
      async (c) => {
        const user = requirePermission(c.get('user'), 'registries.edit');
        const body = c.req.valid('json') as Record<string, unknown>;
        const row = await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
          api().create(tx, entity, body as never),
        );
        return c.json(json(row), 201);
      },
    );

    router.openapi(
      createRoute({
        method: 'patch',
        path: `/${f.path}/{id}`,
        tags: [f.tag],
        summary: `Muokkaa: ${label}`,
        description: 'Muokatut kentät merkitään käsin muokatuiksi, eikä synkronointi ylikirjoita niitä.',
        request: {
          params: IdParam,
          body: { content: { 'application/json': { schema: Patch } }, required: true },
        },
        responses: { 200: jsonContent(Row, 'Päivitetty'), ...errorResponses },
      }),
      async (c) => {
        const user = requirePermission(c.get('user'), 'registries.edit');
        const row = await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
          api().update(tx, entity, c.req.valid('param').id, c.req.valid('json') as never),
        );
        return c.json(json(row), 200);
      },
    );

    router.openapi(
      createRoute({
        method: 'delete',
        path: `/${f.path}/{id}`,
        tags: [f.tag],
        summary: `Poista (roskakoriin): ${label}`,
        request: { params: IdParam },
        responses: { 204: { description: 'Poistettu' }, ...errorResponses },
      }),
      async (c) => {
        const user = requirePermission(c.get('user'), 'registries.edit');
        await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
          api().remove(tx, entity, c.req.valid('param').id),
        );
        return c.body(null, 204);
      },
    );

    router.openapi(
      createRoute({
        method: 'post',
        path: `/${f.path}/{id}/restore`,
        tags: [f.tag],
        summary: `Palauta roskakorista: ${label}`,
        request: { params: IdParam },
        responses: { 204: { description: 'Palautettu' }, ...errorResponses },
      }),
      async (c) => {
        const user = requirePermission(c.get('user'), 'registries.edit');
        await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
          api().restore(tx, entity, c.req.valid('param').id),
        );
        return c.body(null, 204);
      },
    );
  }

  const PartyRow = RecordMetaSchema.merge(PartyFields);
  const GovernmentPartyRow = z
    .object({
      id: z.string().uuid(),
      governmentId: z.string().uuid(),
      partyId: z.string().uuid(),
      joinedAt: date,
      leftAt: date,
      party: PartyRow,
    })
    .openapi('GovernmentParty');

  router.openapi(
    createRoute({
      method: 'get',
      path: '/governments/{id}/parties',
      tags: ['Hallitukset'],
      summary: 'Hallituspuolueet',
      request: { params: IdParam },
      responses: {
        200: jsonContent(z.object({ items: z.array(GovernmentPartyRow) }), 'Hallituspuolueet'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'registries.read');
      const items = await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
        api().governmentParties(tx, c.req.valid('param').id),
      );
      return c.json({ items: json(items) }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: 'put',
      path: '/governments/{id}/parties',
      tags: ['Hallitukset'],
      summary: 'Aseta hallituspuolueet',
      request: {
        params: IdParam,
        body: {
          content: {
            'application/json': {
              schema: z.object({
                parties: z.array(
                  z.object({
                    partyId: z.string().uuid(),
                    joinedAt: date.optional(),
                    leftAt: date.optional(),
                  }),
                ),
              }),
            },
          },
          required: true,
        },
      },
      responses: { 204: { description: 'Tallennettu' }, ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'registries.edit');
      await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
        api().setGovernmentParties(tx, c.req.valid('param').id, c.req.valid('json').parties),
      );
      return c.body(null, 204);
    },
  );

  const RelationRow = z
    .object({
      id: z.string().uuid(),
      partyId: z.string().uuid(),
      relatedPartyId: z.string().uuid(),
      relation: z.enum(['predecessor', 'successor']),
      relationDate: date,
      note: z.string().nullable(),
      relatedParty: PartyRow,
    })
    .openapi('PartyRelation');

  router.openapi(
    createRoute({
      method: 'get',
      path: '/parties/{id}/relations',
      tags: ['Puolueet'],
      summary: 'Edeltäjä- ja seuraajapuolueet',
      request: { params: IdParam },
      responses: {
        200: jsonContent(z.object({ items: z.array(RelationRow) }), 'Suhteet'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'registries.read');
      const items = await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
        api().partyRelations(tx, c.req.valid('param').id),
      );
      return c.json({ items: json(items) }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: 'post',
      path: '/parties/{id}/relations',
      tags: ['Puolueet'],
      summary: 'Lisää edeltäjä- tai seuraajapuolue',
      request: {
        params: IdParam,
        body: {
          content: {
            'application/json': {
              schema: z.object({
                relatedPartyId: z.string().uuid(),
                relation: z.enum(['predecessor', 'successor']),
                relationDate: date.optional(),
                note: z.string().nullable().optional(),
              }),
            },
          },
          required: true,
        },
      },
      responses: { 201: { description: 'Lisätty' }, ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'registries.edit');
      await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
        api().addPartyRelation(tx, { partyId: c.req.valid('param').id, ...c.req.valid('json') }),
      );
      return c.body(null, 201);
    },
  );

  router.openapi(
    createRoute({
      method: 'delete',
      path: '/relations/{id}',
      tags: ['Puolueet'],
      summary: 'Poista puoluesuhde',
      request: { params: IdParam },
      responses: { 204: { description: 'Poistettu' }, ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'registries.edit');
      await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
        api().removePartyRelation(tx, c.req.valid('param').id),
      );
      return c.body(null, 204);
    },
  );

  router.openapi(
    createRoute({
      method: 'get',
      path: '/summary',
      tags: ['Perusrekisterit'],
      summary: 'Kojelautakortin yhteenveto',
      responses: {
        200: jsonContent(
          z
            .object({
              parties: z.number(),
              activeParties: z.number(),
              groups: z.number(),
              districts: z.number(),
              terms: z.number(),
              governments: z.number(),
              bodies: z.number(),
              positionTypes: z.number(),
              currentTerm: RecordMetaSchema.merge(TermFields).nullable(),
              currentGovernment: RecordMetaSchema.merge(GovernmentFields).nullable(),
            })
            .openapi('RegistriesSummary'),
          'Yhteenveto',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'registries.read');
      const s = await ctx.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
        api().summary(tx),
      );
      return c.json(json(s), 200);
    },
  );

  router.openapi(
    createRoute({
      method: 'post',
      path: '/sync',
      tags: ['Perusrekisterit'],
      summary: 'Päivitä perusrekisterit eduskunnan avoimesta datasta',
      responses: {
        202: jsonContent(z.object({ jobId: z.string().uuid() }), 'Työ käynnistetty'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'registries.sync');
      const job = await ctx.startJob({
        type: 'sync:registries',
        payload: {},
        user,
      });
      return c.json({ jobId: job.id }, 202);
    },
  );

  // Guard against unknown entity paths producing confusing 404s.
  router.get('/:entity/*', (c) => {
    if (!isEntity(c.req.param('entity'))) throw new NotFoundError('Tuntematon rekisteri');
    throw new NotFoundError();
  });
}
