import { createRoute, z } from '@hono/zod-openapi';
import type { AuthAdapter, ModuleRouter, Runtime } from '@ps/core';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  can,
  cancelJob,
  ensureUser,
  errorResponses,
  getJob,
  isEmailAllowed,
  json,
  jsonContent,
  listEvents,
  requirePermission,
  searchSemantic,
  searchText,
  serialize,
  uuidFromEmail,
  verifyFileToken,
} from '@ps/core';
import { API_VERSION } from '../app.ts';

const UserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    isAdmin: z.boolean(),
  })
  .openapi('CurrentUser');

const JobSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string(),
    moduleId: z.string(),
    payload: z.record(z.string(), z.unknown()),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
    runner: z.string(),
    progressDone: z.number(),
    progressTotal: z.number().nullable(),
    message: z.string().nullable(),
    result: z.unknown(),
    error: z.string().nullable(),
    attempts: z.number(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .openapi('Job');

const NotificationSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(['info', 'success', 'warning', 'error']),
    title: z.string(),
    body: z.string().nullable(),
    link: z.string().nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Notification');

const SearchHitSchema = z
  .object({
    contentType: z.string(),
    refId: z.string(),
    moduleId: z.string(),
    title: z.string(),
    urlPath: z.string().nullable(),
    snippet: z.string().nullable(),
    rank: z.number(),
    meta: z.record(z.string(), z.unknown()),
  })
  .openapi('SearchHit');

const MenuItemSchema = z.object({
  label: z.string(),
  path: z.string(),
  icon: z.string(),
  permission: z.string(),
  order: z.number(),
  section: z.enum(['main', 'admin']).optional(),
  moduleId: z.string(),
});

const ModuleInfoSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string(),
    dependsOn: z.array(z.string()),
    apiBasePath: z.string(),
    services: z.array(z.string()),
    dataSources: z.array(
      z.object({ id: z.string(), name: z.string(), url: z.string(), license: z.string().optional() }),
    ),
    permissions: z.array(z.object({ id: z.string(), description: z.string() })),
    settings: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        description: z.string().optional(),
        type: z.string(),
        default: z.unknown(),
      }),
    ),
    events: z.object({
      publishes: z.array(z.object({ type: z.string(), version: z.number(), description: z.string() })),
      subscribes: z.array(z.string()),
    }),
    backup: z.object({
      schemaVersion: z.number(),
      irreplaceable: z.array(z.object({ table: z.string(), description: z.string().optional() })),
      reproducible: z.array(z.object({ table: z.string(), description: z.string().optional() })),
    }),
  })
  .openapi('ModuleInfo');

const SyncSourceSchema = z
  .object({
    id: z.string(),
    moduleId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    enabled: z.boolean(),
    schedule: z.string().nullable(),
    lastSuccessAt: z.string().nullable(),
    lastError: z.string().nullable(),
    consecutiveFailures: z.number(),
    lastRun: z
      .object({
        id: z.string(),
        status: z.string(),
        startedAt: z.string(),
        finishedAt: z.string().nullable(),
        rowsFetched: z.number(),
        rowsInserted: z.number(),
        rowsUpdated: z.number(),
        rowsSkipped: z.number(),
      })
      .nullable(),
  })
  .openapi('SyncSource');

const SyncRunSchema = z
  .object({
    id: z.string(),
    sourceId: z.string(),
    jobId: z.string().nullable(),
    params: z.record(z.string(), z.unknown()),
    status: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    rowsFetched: z.number(),
    rowsInserted: z.number(),
    rowsUpdated: z.number(),
    rowsSkipped: z.number(),
    errors: z.array(z.object({ message: z.string(), item: z.unknown().optional() })),
    log: z.array(z.string()),
  })
  .openapi('SyncRun');

const EventSchema = z
  .object({
    id: z.number(),
    eventId: z.string(),
    type: z.string(),
    version: z.number(),
    occurredAt: z.string(),
    sourceModule: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .openapi('DomainEvent');

const asUser = (u: { id: string; email: string }) => ({
  kind: 'user' as const,
  userId: u.id,
  email: u.email,
});

export function registerCoreRoutes(
  r: ModuleRouter,
  rt: Runtime,
  auth: AuthAdapter,
  hooks: { invalidateUser(id: string): void },
): void {
  // --- Public ---------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/health',
      tags: ['Järjestelmä'],
      summary: 'Terveystarkistus',
      responses: {
        200: jsonContent(z.object({ ok: z.boolean(), version: z.string(), database: z.boolean() }), 'OK'),
      },
    }),
    async (c) => {
      let database = true;
      try {
        await rt.sql`select 1`;
      } catch {
        database = false;
      }
      return c.json({ ok: database, version: API_VERSION, database }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/config',
      tags: ['Järjestelmä'],
      summary: 'Julkiset asiakasasetukset (kirjautumistapa, reaaliaikaisuus)',
      description: 'Ei sisällä salaisuuksia eikä dataa.',
      responses: {
        200: jsonContent(
          z
            .object({
              version: z.string(),
              auth: z.record(z.string(), z.unknown()),
              realtime: z.record(z.string(), z.unknown()),
            })
            .openapi('ClientConfig'),
          'Asetukset',
        ),
      },
    }),
    (c) =>
      c.json(
        { version: API_VERSION, auth: auth.clientConfig(), realtime: rt.services.realtime.clientConfig() },
        200,
      ),
  );

  // --- Auth -----------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'post',
      path: '/auth/session',
      tags: ['Kirjautuminen'],
      summary: 'Kirjautumisen vahvistus',
      description:
        'Tarkistaa, että tunnus on sallittujen listalla, ja luo käyttäjän. Ensimmäinen käyttäjä saa ylläpitäjän roolin.',
      security: [{ bearerAuth: [] }],
      responses: { 200: jsonContent(UserSchema, 'Kirjautunut käyttäjä'), ...errorResponses },
    }),
    async (c) => {
      const header = c.req.header('Authorization');
      const identity = header?.startsWith('Bearer ') ? await auth.verify(header.slice(7)) : null;
      if (!identity) throw new UnauthorizedError();
      const user = await ensureUser(rt.sql, identity, rt.config.ALLOWED_EMAILS);
      hooks.invalidateUser(identity.sub);
      if (!user) throw new ForbiddenError('Sähköpostiosoitetta ei ole sallittujen käyttäjien listalla');
      return c.json(user, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/auth/dev-login',
      tags: ['Kirjautuminen'],
      summary: 'Kehityskirjautuminen (vain AUTH_PROVIDER=dev)',
      description:
        'Paikallista kehitystä ja testejä varten. Pois käytöstä, kun käytössä on Supabase Auth tai OIDC.',
      request: {
        body: {
          content: { 'application/json': { schema: z.object({ email: z.string().email() }) } },
          required: true,
        },
      },
      responses: {
        200: jsonContent(z.object({ token: z.string(), user: UserSchema }), 'Kirjautunut'),
        ...errorResponses,
      },
    }),
    async (c) => {
      if (rt.config.AUTH_PROVIDER !== 'dev' || !('issue' in auth)) throw new NotFoundError();
      const email = c.req.valid('json').email.toLowerCase();
      if (!(await isEmailAllowed(rt.sql, email, rt.config.ALLOWED_EMAILS))) {
        throw new ForbiddenError('Sähköpostiosoitetta ei ole sallittujen käyttäjien listalla');
      }
      const sub = await uuidFromEmail(email);
      const user = await ensureUser(rt.sql, { sub, email }, rt.config.ALLOWED_EMAILS);
      if (!user) throw new ForbiddenError();
      const token = await (
        auth as AuthAdapter & { issue(sub: string, email: string): Promise<string> }
      ).issue(sub, email);
      hooks.invalidateUser(sub);
      return c.json({ token, user }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/me',
      tags: ['Kirjautuminen'],
      summary: 'Nykyinen käyttäjä ja oikeudet',
      responses: { 200: jsonContent(UserSchema, 'Käyttäjä'), ...errorResponses },
    }),
    (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      return c.json(user, 200);
    },
  );

  // --- Modules --------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/modules',
      tags: ['Järjestelmä'],
      summary: 'Asennetut moduulit ja valikko',
      responses: {
        200: jsonContent(
          z.object({ modules: z.array(ModuleInfoSchema), menu: z.array(MenuItemSchema) }),
          'Moduulit',
        ),
        ...errorResponses,
      },
    }),
    (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const modules = rt.registry.manifests().map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        description: m.description,
        version: m.version,
        dependsOn: m.dependsOn,
        apiBasePath: m.apiBasePath,
        services: m.services,
        dataSources: m.dataSources,
        permissions: m.permissions.map((p) => ({ id: p.id, description: p.description })),
        settings: m.settings,
        events: m.events,
        backup: {
          schemaVersion: m.backup.schemaVersion,
          irreplaceable: m.backup.irreplaceable,
          reproducible: m.backup.reproducible,
        },
      }));
      return c.json({ modules, menu: rt.registry.menu().filter((i) => can(user, i.permission)) }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/modules/{moduleId}/settings',
      tags: ['Asetukset'],
      summary: 'Moduulin asetukset',
      request: { params: z.object({ moduleId: z.string() }) },
      responses: {
        200: jsonContent(z.object({ values: z.record(z.string(), z.unknown()) }), 'Asetukset'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.settings');
      const { moduleId } = c.req.valid('param');
      if (!rt.registry.has(moduleId)) throw new NotFoundError();
      const m = rt.registry.get(moduleId).manifest;
      const stored = await rt.settings.getAll(`module:${moduleId}`);
      const values = Object.fromEntries(
        m.settings.map((s) => [s.key, s.key in stored ? stored[s.key] : s.default]),
      );
      return c.json({ values }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'put',
      path: '/modules/{moduleId}/settings',
      tags: ['Asetukset'],
      summary: 'Tallenna moduulin asetukset',
      request: {
        params: z.object({ moduleId: z.string() }),
        body: {
          content: {
            'application/json': { schema: z.object({ values: z.record(z.string(), z.unknown()) }) },
          },
          required: true,
        },
      },
      responses: { 204: { description: 'Tallennettu' }, ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.settings');
      const { moduleId } = c.req.valid('param');
      if (!rt.registry.has(moduleId)) throw new NotFoundError();
      const m = rt.registry.get(moduleId).manifest;
      for (const [k, v] of Object.entries(c.req.valid('json').values)) {
        if (!m.settings.some((s) => s.key === k)) throw new ValidationError(`Tuntematon asetus ${k}`);
        await rt.settings.set(`module:${moduleId}`, k, v, user.id);
      }
      return c.body(null, 204);
    },
  );

  // --- Search ---------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/search',
      tags: ['Haku'],
      summary: 'Yleishaku kaikkiin moduuleihin',
      description:
        'Tekstihaku suomen ja ruotsin sanakirjoilla (taivutusmuodot), lainausmerkit = tarkka fraasi, OR = tai, -sana = ei. mode=semantic käyttää upotteita.',
      request: {
        query: z.object({
          q: z.string().min(1),
          types: z.string().optional().openapi({ description: 'Pilkuin eroteltu lista sisältötyyppejä' }),
          mode: z.enum(['text', 'semantic']).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
      },
      responses: {
        200: jsonContent(
          z.object({
            hits: z.array(SearchHitSchema),
            types: z.array(z.object({ type: z.string(), label: z.string(), moduleId: z.string() })),
          }),
          'Osumat',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.search');
      const q = c.req.valid('query');
      const types = q.types?.split(',').filter(Boolean);
      let hits;
      if (q.mode === 'semantic') {
        const ai = await rt.ai();
        const emb = await ai.embed([q.q], { userId: user.id, visibility: 'public' });
        hits = await rt.withActor(asUser(user), (tx) =>
          searchSemantic(tx, { vector: emb.vectors[0]!, model: emb.model, types, limit: q.limit }),
        );
      } else {
        hits = await rt.withActor(asUser(user), (tx) =>
          searchText(tx, { q: q.q, types, limit: q.limit, offset: q.offset }),
        );
      }
      const visibleTypes = rt.searchTypes.list().filter((t) => can(user, t.readPermission));
      return c.json(
        {
          hits: serialize(hits).map((h) => ({ ...h, rank: Number(h.rank) })),
          types: visibleTypes.map((t) => ({ type: t.type, label: t.label, moduleId: t.moduleId })),
        },
        200,
      );
    },
  );

  // --- Jobs -----------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/jobs',
      tags: ['Taustatyöt'],
      summary: 'Taustatyöt',
      request: {
        query: z.object({
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          updated_since: z.string().optional(),
        }),
      },
      responses: { 200: jsonContent(z.object({ items: z.array(JobSchema) }), 'Työt'), ...errorResponses },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const q = c.req.valid('query');
      const all = can(user, 'core.jobs');
      const rows = await rt.sql`
        select * from core.jobs
        where ${all ? rt.sql`true` : rt.sql`created_by = ${user.id}`}
          ${q.status ? rt.sql`and status = ${q.status}` : rt.sql``}
          ${q.updated_since ? rt.sql`and updated_at > ${q.updated_since}` : rt.sql``}
        order by created_at desc limit ${q.limit ?? 50}`;
      return c.json({ items: json(rows) }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/jobs/{id}',
      tags: ['Taustatyöt'],
      summary: 'Työn tila ja edistyminen',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: jsonContent(JobSchema, 'Työ'), ...errorResponses },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const job = await getJob(rt.sql, c.req.valid('param').id);
      if (!job || (job.createdBy !== user.id && !can(user, 'core.jobs'))) throw new NotFoundError();
      return c.json(json(job), 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/jobs',
      tags: ['Taustatyöt'],
      summary: 'Käynnistä taustatyö',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({ type: z.string(), payload: z.record(z.string(), z.unknown()).optional() }),
            },
          },
          required: true,
        },
      },
      responses: { 202: jsonContent(JobSchema, 'Jonossa'), ...errorResponses },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const body = c.req.valid('json');
      const job = await rt.startJob({ type: body.type, payload: body.payload ?? {}, user });
      return c.json(json(job), 202);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/{id}/cancel',
      tags: ['Taustatyöt'],
      summary: 'Peru työ',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 204: { description: 'Peruttu' }, ...errorResponses },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const job = await getJob(rt.sql, c.req.valid('param').id);
      if (!job || (job.createdBy !== user.id && !can(user, 'core.jobs'))) throw new NotFoundError();
      await cancelJob(rt.sql, job.id);
      return c.body(null, 204);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/jobs-types',
      tags: ['Taustatyöt'],
      summary: 'Käynnistettävät työtyypit',
      responses: {
        200: jsonContent(
          z.object({
            items: z.array(
              z.object({
                type: z.string(),
                moduleId: z.string(),
                description: z.string(),
                permission: z.string(),
                placement: z.string(),
              }),
            ),
          }),
          'Työtyypit',
        ),
        ...errorResponses,
      },
    }),
    (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const items = rt.jobs
        .list()
        .filter((j) => can(user, j.permission))
        .map((j) => ({
          type: j.type,
          moduleId: j.moduleId,
          description: j.description,
          permission: j.permission,
          placement: j.placement,
        }));
      return c.json({ items }, 200);
    },
  );

  // --- Sync -----------------------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/sync/sources',
      tags: ['Synkronointi'],
      summary: 'Tietolähteiden tila',
      responses: {
        200: jsonContent(z.object({ items: z.array(SyncSourceSchema) }), 'Lähteet'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.sync');
      await rt.sync.persist(rt.sql);
      const rows = await rt.sql`
        select s.id, s.module_id, s.name, s.description, s.enabled, s.schedule, s.last_success_at, s.last_error,
          s.consecutive_failures,
          (select to_jsonb(x) from (select id, status, started_at as "startedAt", finished_at as "finishedAt",
              rows_fetched as "rowsFetched", rows_inserted as "rowsInserted", rows_updated as "rowsUpdated",
              rows_skipped as "rowsSkipped"
            from core.sync_runs where source_id = s.id order by started_at desc limit 1) x) as last_run
        from core.sync_sources s order by s.module_id, s.name`;
      return c.json({ items: json(rows) }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/sync/runs',
      tags: ['Synkronointi'],
      summary: 'Synkronointiajojen loki',
      request: {
        query: z.object({
          source: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: { 200: jsonContent(z.object({ items: z.array(SyncRunSchema) }), 'Ajot'), ...errorResponses },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.sync');
      const q = c.req.valid('query');
      const rows = await rt.sql`select * from core.sync_runs
        ${q.source ? rt.sql`where source_id = ${q.source}` : rt.sql``}
        order by started_at desc limit ${q.limit ?? 50}`;
      return c.json({ items: json(rows) }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/sync/sources/{id}/run',
      tags: ['Synkronointi'],
      summary: 'Päivitä nyt',
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: {
            'application/json': {
              schema: z.object({ params: z.record(z.string(), z.unknown()).optional() }),
            },
          },
          required: false,
        },
      },
      responses: { 202: jsonContent(JobSchema, 'Käynnistetty'), ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.sync');
      const { id } = c.req.valid('param');
      if (!rt.sync.get(id)) throw new NotFoundError('Tuntematon tietolähde');
      const body = await c.req.json().catch(() => ({}));
      const job = await rt.startJob({
        type: 'sync:run',
        payload: { sourceId: id, params: body?.params ?? {} },
        user,
      });
      return c.json(json(job), 202);
    },
  );

  r.openapi(
    createRoute({
      method: 'patch',
      path: '/sync/sources/{id}',
      tags: ['Synkronointi'],
      summary: 'Ota lähde käyttöön tai pois käytöstä',
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } },
          required: true,
        },
      },
      responses: { 204: { description: 'Tallennettu' }, ...errorResponses },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.sync');
      await rt.sql`update core.sync_sources set enabled = ${c.req.valid('json').enabled}, updated_at = now()
                   where id = ${c.req.valid('param').id}`;
      return c.body(null, 204);
    },
  );

  // --- Notifications & events --------------------------------------------------
  r.openapi(
    createRoute({
      method: 'get',
      path: '/notifications',
      tags: ['Ilmoitukset'],
      summary: 'Omat ilmoitukset',
      request: {
        query: z.object({
          unread: z.enum(['true', 'false']).optional(),
          updated_since: z.string().optional(),
        }),
      },
      responses: {
        200: jsonContent(z.object({ items: z.array(NotificationSchema), unread: z.number() }), 'Ilmoitukset'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const q = c.req.valid('query');
      const rows = await rt.withActor(
        asUser(user),
        (tx) => tx`
        select id, kind, title, body, link, read_at, created_at from core.notifications
        where true ${q.unread === 'true' ? tx`and read_at is null` : tx``}
          ${q.updated_since ? tx`and created_at > ${q.updated_since}` : tx``}
        order by created_at desc limit 100`,
      );
      const [count] = await rt.withActor(
        asUser(user),
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from core.notifications where read_at is null`,
      );
      return c.json({ items: json(rows), unread: count?.n ?? 0 }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/notifications/read',
      tags: ['Ilmoitukset'],
      summary: 'Merkitse luetuksi',
      request: {
        body: {
          content: {
            'application/json': { schema: z.object({ ids: z.array(z.string().uuid()).optional() }) },
          },
          required: true,
        },
      },
      responses: { 204: { description: 'OK' }, ...errorResponses },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const ids = c.req.valid('json').ids;
      // Admin broadcast notifications have no owner; mark them through the system connection.
      await rt.sql`update core.notifications set read_at = now()
        where read_at is null and (user_id = ${user.id} ${user.isAdmin ? rt.sql`or audience = 'admins'` : rt.sql``})
          ${ids?.length ? rt.sql`and id = any(${ids})` : rt.sql``}`;
      return c.body(null, 204);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/events',
      tags: ['Tapahtumat'],
      summary: 'Tapahtumasyöte (tilattavat tapahtumat)',
      description:
        'Asiakkaat voivat seurata tapahtumia kyselemällä after-parametrilla viimeisimmän tapahtuman id:n jälkeen.',
      request: {
        query: z.object({
          after: z.coerce.number().int().min(0).optional(),
          types: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      },
      responses: {
        200: jsonContent(z.object({ items: z.array(EventSchema) }), 'Tapahtumat'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const q = c.req.valid('query');
      const items = await listEvents(rt.sql, {
        afterId: q.after,
        types: q.types?.split(','),
        limit: q.limit,
      });
      // Events only reveal ids and changed field names; restrict to readable modules.
      const readable = new Set(
        rt.registry
          .manifests()
          .filter((m) => m.permissions.some((p) => p.id.endsWith('.read') && can(user, p.id)))
          .map((m) => m.id),
      );
      return c.json(
        {
          items: serialize(items.filter((e) => readable.has(e.sourceModule) || user.isAdmin)).map((e) => ({
            id: e.id,
            eventId: e.eventId,
            type: e.type,
            version: e.version,
            occurredAt: String(e.occurredAt),
            sourceModule: e.sourceModule,
            payload: e.payload,
          })),
        },
        200,
      );
    },
  );

  // --- Files (signed downloads for local disk storage) ---------------------------
  r.get('/files/:token', async (c) => {
    const key = await verifyFileToken(
      c.req.param('token'),
      rt.config.SETTINGS_ENCRYPTION_KEY ?? rt.config.AUTH_JWT_SECRET ?? 'dev-signing-key',
    );
    if (!key) throw new NotFoundError('Linkki on vanhentunut');
    const bytes = (await rt.services.storage.get(key)) ?? (await rt.services.backup.get(key));
    if (!bytes) throw new NotFoundError();
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
      },
    });
  });

  r.openapi(
    createRoute({
      method: 'get',
      path: '/exports',
      tags: ['Vienti'],
      summary: 'Omat taustalla tehdyt viennit',
      responses: {
        200: jsonContent(
          z.object({
            items: z.array(
              z.object({
                id: z.string(),
                moduleId: z.string(),
                format: z.string(),
                title: z.string(),
                status: z.string(),
                sizeBytes: z.number().nullable(),
                createdAt: z.string(),
                expiresAt: z.string().nullable(),
              }),
            ),
          }),
          'Viennit',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const rows = await rt.withActor(
        asUser(user),
        (tx) =>
          tx`select id, module_id, format, title, status, size_bytes, created_at, expires_at from core.exports order by created_at desc limit 100`,
      );
      return c.json(
        {
          items: json(
            serialize(rows).map((r) => ({
              ...r,
              sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
            })),
          ),
        },
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/exports/{id}/download',
      tags: ['Vienti'],
      summary: 'Vientitiedoston latauslinkki',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: jsonContent(z.object({ url: z.string() }), 'Latauslinkki'), ...errorResponses },
    }),
    async (c) => {
      const user = c.get('user');
      if (!user) throw new UnauthorizedError();
      const [row] = await rt.withActor(
        asUser(user),
        (tx) =>
          tx<
            { storageKey: string | null }[]
          >`select storage_key from core.exports where id = ${c.req.valid('param').id}`,
      );
      if (!row?.storageKey) throw new NotFoundError();
      const url = await rt.services.storage.signedUrl(row.storageKey, 3600);
      if (!url) throw new NotFoundError('Tallennuspalvelu ei tue latauslinkkejä');
      return c.json({ url }, 200);
    },
  );
}
