import { createRoute, z } from '@hono/zod-openapi';
import type { ModuleRouter, Runtime, ServiceType, SwitchableService } from '@ps/core';
import {
  PROVIDER_OPTIONS,
  ValidationError,
  errorResponses,
  json,
  jsonContent,
  listTrash,
  recentChanges,
  recordHistory,
  requirePermission,
  restoreFromAudit,
  restoreFromTrash,
  serialize,
} from '@ps/core';

const ServiceSchema = z
  .object({
    type: z.string(),
    label: z.string(),
    provider: z.string(),
    providerLabel: z.string(),
    switchable: z.boolean(),
    options: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        fields: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            secret: z.boolean().optional(),
            placeholder: z.string().optional(),
          }),
        ),
      }),
    ),
    config: z.record(z.string(), z.string()),
    secretsSet: z.array(z.string()),
    status: z.enum(['ok', 'error', 'unknown', 'disabled']),
    message: z.string().nullable(),
    lastOkAt: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
    usedBy: z.array(z.object({ id: z.string(), name: z.string() })),
    note: z.string().optional(),
  })
  .openapi('Service');

const AuditEntrySchema = z
  .object({
    id: z.number(),
    at: z.string(),
    actorId: z.string().nullable(),
    actorLabel: z.string().nullable(),
    action: z.string(),
    tableSchema: z.string(),
    tableName: z.string(),
    recordId: z.string().nullable(),
    oldData: z.record(z.string(), z.unknown()).nullable(),
    newData: z.record(z.string(), z.unknown()).nullable(),
    changedFields: z.array(z.string()).nullable(),
  })
  .openapi('AuditEntry');

const asUser = (u: { id: string; email: string }) => ({
  kind: 'user' as const,
  userId: u.id,
  email: u.email,
});

export function registerAdminRoutes(r: ModuleRouter, rt: Runtime): void {
  // --- Services ---------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/services',
      tags: ['Palvelut'],
      summary: 'Palvelut: nykyinen tarjoaja, tila ja vaihtoehdot',
      responses: {
        200: jsonContent(z.object({ items: z.array(ServiceSchema) }), 'Palvelut'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.services');
      const ai = await rt.aiSettings();
      const host = rt.host === 'edge' ? 'supabase-edge-functions' : rt.host === 'node' ? 'node' : rt.host;
      const items = await rt.services.describe({
        ai: {
          provider: `${ai.tasks.default.provider} (${ai.tasks.default.model})`,
          note: 'Vaihto Tekoäly-asetuksista',
        },
        embeddings: {
          provider: ai.embedding ? `${ai.embedding.provider} (${ai.embedding.model})` : 'ei käytössä',
          note: 'Vaihto Tekoäly-asetuksista',
        },
        auth: {
          provider: rt.config.AUTH_PROVIDER,
          note: 'Vaihdetaan ympäristömuuttujalla AUTH_PROVIDER (ks. docs/SERVICES.md)',
        },
        database: {
          provider: rt.services.providerOf('database'),
          note: 'Vaihdetaan ympäristömuuttujalla DATABASE_URL (ks. docs/SERVICES.md)',
        },
        hosting: {
          provider: 'staattinen (GitHub Pages oletuksena)',
          note: 'Käyttöliittymä on staattinen; julkaisu docs/DEPLOYMENT.md',
        },
        'api-runtime': { provider: host },
      });
      return c.json({ items }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/services/{type}/test',
      tags: ['Palvelut'],
      summary: 'Testaa yhteys',
      request: { params: z.object({ type: z.string() }) },
      responses: {
        200: jsonContent(z.object({ ok: z.boolean(), message: z.string() }), 'Tulos'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.services');
      const type = c.req.valid('param').type as ServiceType;
      if (type === 'ai' || type === 'embeddings') {
        const ai = await rt.ai();
        const route = type === 'ai' ? ai.route('default') : ai.settings.embedding;
        if (!route) return c.json({ ok: false, message: 'Ei määritetty' }, 200);
        const t = await ai.testProvider(route.provider, route.model);
        return c.json({ ok: t.ok, message: t.message }, 200);
      }
      return c.json(await rt.services.test(type), 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'put',
      path: '/services/{type}',
      tags: ['Palvelut'],
      summary: 'Vaihda palveluntarjoaja',
      description:
        'Salaiset kentät tallennetaan salattuina, eikä niitä palauteta. Jos uudet asetukset eivät toimi, vanhat palautetaan.',
      request: {
        params: z.object({ type: z.enum(['storage', 'mail', 'jobs', 'realtime', 'backup']) }),
        body: {
          content: {
            'application/json': {
              schema: z.object({
                provider: z.string(),
                config: z.record(z.string(), z.string()).optional(),
                secrets: z.record(z.string(), z.string()).optional(),
              }),
            },
          },
          required: true,
        },
      },
      responses: {
        200: jsonContent(z.object({ ok: z.boolean(), message: z.string() }), 'Testattu'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.services');
      const type = c.req.valid('param').type as SwitchableService;
      const body = c.req.valid('json');
      if (!PROVIDER_OPTIONS[type].some((o) => o.id === body.provider))
        throw new ValidationError('Tuntematon tarjoaja');
      await rt.services.configure(type, body.provider, body.config ?? {}, body.secrets ?? {}, user.id);
      return c.json(await rt.services.test(type), 200);
    },
  );

  // --- Audit log ---------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/audit',
      tags: ['Muutoshistoria'],
      summary: 'Tietueen muutoshistoria tai viimeisimmät muutokset',
      request: {
        query: z.object({
          table: z.string().optional(),
          recordId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      },
      responses: {
        200: jsonContent(z.object({ items: z.array(AuditEntrySchema) }), 'Muutokset'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.audit');
      const q = c.req.valid('query');
      const items = await rt.withActor(asUser(user), (tx) =>
        q.table && q.recordId
          ? recordHistory(tx, q.table, q.recordId, q.limit)
          : recentChanges(tx, { tables: q.table ? [q.table] : undefined, limit: q.limit }),
      );
      return c.json({ items: json(items) }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/audit/{id}/restore',
      tags: ['Muutoshistoria'],
      summary: 'Palauta tietue tähän versioon',
      request: {
        params: z.object({ id: z.coerce.number().int() }),
        body: {
          content: {
            'application/json': { schema: z.object({ which: z.enum(['after', 'before']).optional() }) },
          },
          required: false,
        },
      },
      responses: {
        200: jsonContent(z.object({ table: z.string(), recordId: z.string() }), 'Palautettu'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.audit');
      const body = await c.req.json().catch(() => ({}));
      const result = await rt.withActor(asUser(user), (tx) =>
        restoreFromAudit(
          tx,
          c.req.valid('param').id,
          rt.registry.tables(),
          body?.which === 'before' ? 'before' : 'after',
        ),
      );
      return c.json(result, 200);
    },
  );

  // --- Trash ------------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/trash',
      tags: ['Roskakori'],
      summary: 'Roskakori (poistetut 30 päivän ajan)',
      responses: {
        200: jsonContent(
          z.object({
            items: z.array(
              z.object({
                table: z.string(),
                id: z.string(),
                label: z.string(),
                deletedAt: z.string(),
                data: z.record(z.string(), z.unknown()),
              }),
            ),
          }),
          'Poistetut',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.trash');
      const items = await rt.withActor(asUser(user), (tx) => listTrash(tx, rt.registry.tables()));
      return c.json({ items: json(items) }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/trash/restore',
      tags: ['Roskakori'],
      summary: 'Palauta roskakorista',
      request: {
        body: {
          content: { 'application/json': { schema: z.object({ table: z.string(), id: z.string().uuid() }) } },
          required: true,
        },
      },
      responses: { 204: { description: 'Palautettu' }, ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.trash');
      const { table, id } = c.req.valid('json');
      await rt.withActor(asUser(user), (tx) => restoreFromTrash(tx, table, id, rt.registry.tables()));
      return c.body(null, 204);
    },
  );

  // --- Users (foundation for the future user management page) ---------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/users',
      tags: ['Käyttäjät'],
      summary: 'Käyttäjät ja roolit',
      responses: {
        200: jsonContent(
          z.object({
            items: z.array(
              z.object({
                id: z.string(),
                email: z.string(),
                displayName: z.string().nullable(),
                isActive: z.boolean(),
                lastLoginAt: z.string().nullable(),
                roles: z.array(z.string()),
              }),
            ),
            roles: z.array(
              z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }),
            ),
          }),
          'Käyttäjät',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.admin');
      const items = await rt.sql`
        select u.id, u.email, u.display_name, u.is_active, u.last_login_at,
          coalesce(array_agg(ur.role_id) filter (where ur.role_id is not null), '{}') as roles
        from core.users u left join core.user_roles ur on ur.user_id = u.id
        group by u.id order by u.email`;
      const roles = await rt.sql`select id, name, description from core.roles order by sort_order`;
      return c.json({ items: json(items), roles: json(roles) }, 200);
    },
  );
}
