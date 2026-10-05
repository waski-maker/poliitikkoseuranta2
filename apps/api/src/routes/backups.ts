import { createRoute, z } from '@hono/zod-openapi';
import type { ModuleBackup, ModuleRouter, Runtime, RetentionPolicy } from '@ps/core';
import {
  DEFAULT_RETENTION,
  NotFoundError,
  ValidationError,
  auditAction,
  errorResponses,
  exportModule,
  importModule,
  json,
  jsonContent,
  requirePermission,
  serialize,
  takeSnapshot,
} from '@ps/core';

const BackupSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    moduleId: z.string().nullable(),
    status: z.string(),
    target: z.string(),
    location: z.string().nullable(),
    sizeBytes: z.number().nullable(),
    sha256: z.string().nullable(),
    encrypted: z.boolean(),
    retentionClass: z.string().nullable(),
    includeReproducible: z.boolean(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    verifiedAt: z.string().nullable(),
    verifyStatus: z.string().nullable(),
    verifyMessage: z.string().nullable(),
    error: z.string().nullable(),
  })
  .openapi('Backup');

const RetentionSchema = z
  .object({
    daily: z.number().int().min(1).max(60),
    weekly: z.number().int().min(0).max(52),
    monthly: z.number().int().min(0).max(120),
  })
  .openapi('RetentionPolicy');

/** The one destructive operation: restore must be confirmed by typing this word. */
export const RESTORE_CONFIRMATION = 'PALAUTA';

export function registerBackupRoutes(r: ModuleRouter, rt: Runtime): void {
  r.openapi(
    createRoute({
      method: 'get',
      path: '/backups',
      tags: ['Varmuuskopiot'],
      summary: 'Varmuuskopiot ja niiden tila',
      responses: {
        200: jsonContent(
          z.object({
            items: z.array(BackupSchema),
            retention: RetentionSchema,
            target: z.string(),
            encryptionKeySet: z.boolean(),
          }),
          'Varmuuskopiot',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.backup');
      const items =
        await rt.sql`select * from core.backups where status <> 'deleted' order by started_at desc limit 200`;
      const retention = await rt.settings.get<RetentionPolicy>('backup', 'retention', DEFAULT_RETENTION);
      return c.json(
        {
          items: json(
            serialize(items).map((i) => ({
              ...i,
              sizeBytes: i.sizeBytes == null ? null : Number(i.sizeBytes),
            })),
          ),
          retention,
          target: rt.services.backup.provider,
          encryptionKeySet: Boolean(rt.config.BACKUP_ENCRYPTION_KEY),
        },
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: 'put',
      path: '/backups/retention',
      tags: ['Varmuuskopiot'],
      summary: 'Säilytysasetukset',
      request: { body: { content: { 'application/json': { schema: RetentionSchema } }, required: true } },
      responses: { 204: { description: 'Tallennettu' }, ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.backup');
      await rt.settings.set('backup', 'retention', c.req.valid('json'), user.id);
      return c.body(null, 204);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/backups/run',
      tags: ['Varmuuskopiot'],
      summary: 'Varmuuskopioi nyt',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({
                kind: z.enum(['full', 'module', 'verify']),
                moduleId: z.string().optional(),
                includeReproducible: z.boolean().optional(),
              }),
            },
          },
          required: true,
        },
      },
      responses: { 202: jsonContent(z.object({ jobId: z.string() }), 'Käynnistetty'), ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.backup');
      const body = c.req.valid('json');
      if (body.kind === 'module' && (!body.moduleId || !rt.registry.has(body.moduleId)))
        throw new ValidationError('Tuntematon moduuli');
      const type =
        body.kind === 'full' ? 'backup:full' : body.kind === 'verify' ? 'backup:verify' : 'backup:module';
      const job = await rt.startJob({
        type,
        payload: { moduleId: body.moduleId, includeReproducible: body.includeReproducible },
        user,
      });
      return c.json({ jobId: job.id }, 202);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/backups/{id}/download',
      tags: ['Varmuuskopiot'],
      summary: 'Latauslinkki (salattu tiedosto)',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: jsonContent(z.object({ url: z.string() }), 'Linkki'), ...errorResponses },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.backup');
      const [b] = await rt.sql<
        { location: string | null }[]
      >`select location from core.backups where id = ${c.req.valid('param').id}`;
      if (!b?.location) throw new NotFoundError();
      const url = await rt.services.backup.signedUrl(b.location, 900);
      if (!url) throw new NotFoundError('Kohde ei tue latauslinkkejä');
      return c.json({ url }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/backups/{id}/restore',
      tags: ['Varmuuskopiot'],
      summary: 'Palauta koko järjestelmä varmuuskopiosta',
      description: `Korvaa nykyiset tiedot. Vaatii vahvistuksen: confirm = "${RESTORE_CONFIRMATION}". Ennen palautusta otetaan automaattisesti uusi varmuuskopio.`,
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
          content: { 'application/json': { schema: z.object({ confirm: z.string() }) } },
          required: true,
        },
      },
      responses: { 202: jsonContent(z.object({ jobId: z.string() }), 'Käynnistetty'), ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.backup');
      if (c.req.valid('json').confirm !== RESTORE_CONFIRMATION) {
        throw new ValidationError(`Vahvista palautus kirjoittamalla ${RESTORE_CONFIRMATION}`);
      }
      const job = await rt.startJob({
        type: 'backup:restore',
        payload: { backupId: c.req.valid('param').id },
        user,
      });
      return c.json({ jobId: job.id }, 202);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/backups/modules/{moduleId}/export',
      tags: ['Varmuuskopiot'],
      summary: 'Moduulin tiedot JSON-muodossa (tarjoajasta riippumaton)',
      request: {
        params: z.object({ moduleId: z.string() }),
        query: z.object({ includeReproducible: z.enum(['true', 'false']).optional() }),
      },
      responses: {
        200: {
          description: 'JSON-tiedosto',
          content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
        },
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.backup');
      const { moduleId } = c.req.valid('param');
      if (!rt.registry.has(moduleId)) throw new NotFoundError();
      const m = rt.registry.get(moduleId).manifest;
      const data = await exportModule(rt.sql, m, {
        includeReproducible: c.req.valid('query').includeReproducible !== 'false',
      });
      await rt.withActor({ kind: 'user', userId: user.id, email: user.email }, (tx) =>
        auditAction(tx, {
          action: 'export',
          table: `${m.dbSchema}._module`,
          context: { moduleId, kind: 'module-backup' },
        }),
      );
      c.header(
        'Content-Disposition',
        `attachment; filename="moduuli-${moduleId}-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return c.json(json(data), 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/backups/modules/{moduleId}/import',
      tags: ['Varmuuskopiot'],
      summary: 'Palauta yhden moduulin tiedot JSON-varmuuskopiosta',
      description: `Vaatii vahvistuksen (confirm = "${RESTORE_CONFIRMATION}"). Nykyisistä tiedoista otetaan tilannekuva ennen palautusta. Vanhemman version varmuuskopio muunnetaan automaattisesti.`,
      request: {
        params: z.object({ moduleId: z.string() }),
        body: {
          content: {
            'application/json': {
              schema: z.object({ confirm: z.string(), backup: z.record(z.string(), z.unknown()) }),
            },
          },
          required: true,
        },
      },
      responses: {
        200: jsonContent(
          z.object({
            restored: z.array(z.object({ table: z.string(), rows: z.number() })),
            snapshotIds: z.array(z.string()),
          }),
          'Palautettu',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.backup');
      const body = c.req.valid('json');
      if (body.confirm !== RESTORE_CONFIRMATION)
        throw new ValidationError(`Vahvista palautus kirjoittamalla ${RESTORE_CONFIRMATION}`);
      const { moduleId } = c.req.valid('param');
      if (!rt.registry.has(moduleId)) throw new NotFoundError();
      const mod = rt.registry.list().find((m) => m.manifest.id === moduleId)!;
      const result = await rt.withActor({ kind: 'system', label: `restore:${user.email}` }, async (tx) => {
        const snapshotIds: string[] = [];
        for (const t of [...mod.manifest.backup.irreplaceable, ...mod.manifest.backup.reproducible]) {
          snapshotIds.push(
            await takeSnapshot(tx, {
              reason: `Ennen moduulin ${moduleId} palautusta`,
              moduleId,
              table: t.table,
            }),
          );
        }
        const restored = await importModule(
          tx,
          mod.manifest,
          body.backup as unknown as ModuleBackup,
          mod.upgradeBackup,
        );
        return { restored, snapshotIds };
      });
      return c.json(result, 200);
    },
  );
}
