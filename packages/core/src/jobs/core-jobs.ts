import type { ModuleContext } from '../modules/types.ts';
import { runSync } from '../sync/framework.ts';
import { purgeTrash } from '../audit/history.ts';
import { requeueStaleJobs } from './queue.ts';
import { notifyAdmins } from '../notifications/notify.ts';
import { storeEmbedding } from '../search/service.ts';
import { sha256Hex } from '../util/crypto.ts';
import { exportModule } from '../backup/module-backup.ts';
import { encryptBytes } from '../util/crypto.ts';
import { ValidationError } from '../util/errors.ts';
import type { ServiceType } from '../modules/manifest.ts';

const workerOnly = (type: string) => async () => {
  throw new Error(`Työ ${type} ajetaan taustatyöntekijässä (pnpm job work); tämä ympäristö ei voi ajaa sitä`);
};

/** Jobs provided by the core itself. Modules add their own via ServerModule.jobs(). */
export function registerCoreJobs(ctx: ModuleContext): void {
  const { jobs, sql, log } = ctx;

  jobs.register<{ sourceId: string; params?: Record<string, unknown> }>({
    type: 'sync:run',
    moduleId: '0.000',
    description: 'Tietolähteen synkronointi',
    permission: 'core.sync',
    placement: 'worker',
    maxAttempts: 2,
    async run(jc, payload) {
      const def = ctx.sync.get(payload.sourceId);
      if (!def) throw new ValidationError(`Tuntematon synkronointi ${payload.sourceId}`);
      const r = await runSync(sql, def, jc.log, {
        params: payload.params ?? {},
        jobId: jc.job.id,
        triggeredBy: jc.job.createdBy,
        createHttp: () => ctx.http(def.dataSource),
        progress: (d, t, m) => jc.progress(d, t, m),
        alert: (title, body) =>
          notifyAdmins(sql, { kind: 'warning', title, body, link: '/yllapito/synkronoinnit' }),
      });
      if (r.status === 'failed') throw new Error(r.errors[0]?.message ?? 'Synkronointi epäonnistui');
      return r;
    },
  });

  jobs.register({
    type: 'events:dispatch',
    moduleId: '0.000',
    description: 'Tapahtumien jakelu moduuleille',
    permission: 'core.admin',
    placement: 'inline',
    async run(jc) {
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const n = await ctx.events.dispatch(sql, jc.log);
        total += n;
        if (n === 0) break;
      }
      return { delivered: total };
    },
  });

  jobs.register<{ days?: number }>({
    type: 'trash:purge',
    moduleId: '0.000',
    description: 'Roskakorin tyhjennys (yli 30 päivää vanhat)',
    permission: 'core.trash',
    placement: 'inline',
    async run(_jc, payload) {
      const removed = await purgeTrash(sql, ctx.registry.tables(), payload.days ?? 30);
      await sql`delete from core.snapshots where expires_at < now()`;
      return { removed };
    },
  });

  jobs.register({
    type: 'health:check',
    moduleId: '0.000',
    description: 'Palveluiden ja synkronointien valvonta',
    permission: 'core.services',
    placement: 'inline',
    async run() {
      const results: Record<string, boolean> = {};
      const types: ServiceType[] = ['database', 'storage', 'backup', 'mail', 'jobs', 'realtime'];
      for (const t of types) {
        const r = await ctx.services.test(t);
        results[t] = r.ok;
        if (!r.ok)
          await notifyAdmins(sql, {
            kind: 'error',
            title: `Palvelu ei vastaa: ${t}`,
            body: r.message,
            link: '/yllapito/palvelut',
          });
      }
      const ai = await ctx.ai();
      const route = ai.route('default');
      const t = await ai.testProvider(route.provider, route.model);
      results.ai = t.ok;
      if (!t.ok)
        await notifyAdmins(sql, {
          kind: 'error',
          title: 'Tekoälypalvelu ei vastaa',
          body: t.message,
          link: '/yllapito/tekoaly',
        });
      const stale = await requeueStaleJobs(sql);
      const failing = await sql<{ name: string; consecutiveFailures: number }[]>`
        select name, consecutive_failures from core.sync_sources where enabled and consecutive_failures >= 3`;
      return { services: results, requeuedJobs: stale, failingSyncs: failing };
    },
  });

  jobs.register<{ contentType?: string; limit?: number }>({
    type: 'embeddings:reindex',
    moduleId: '0.000',
    description: 'Upotteiden laskenta semanttista hakua varten',
    permission: 'core.ai',
    placement: 'worker',
    async run(jc, payload) {
      const ai = await ctx.ai();
      const model = ai.settings.embedding?.model;
      if (!model) throw new ValidationError('Upotemallia ei ole määritetty');
      const limit = payload.limit ?? 5000;
      // Only rows without an embedding for the current model: the old model's
      // vectors stay usable until the new ones are ready.
      const rows = await sql<
        { contentType: string; refId: string; title: string; body: string | null; visibility: string }[]
      >`
        select s.content_type, s.ref_id, s.title, s.body, s.visibility from core.search_index s
        where not exists (select 1 from core.embeddings e where e.content_type = s.content_type and e.ref_id = s.ref_id and e.model = ${model})
          ${payload.contentType ? sql`and s.content_type = ${payload.contentType}` : sql``}
        limit ${limit}`;
      let done = 0;
      for (let i = 0; i < rows.length; i += 32) {
        const batch = rows.slice(i, i + 32);
        const texts = batch.map((r) => `${r.title}\n${(r.body ?? '').slice(0, 6000)}`);
        const vis = batch.every((r) => r.visibility === 'public') ? 'public' : 'internal';
        const emb = await ai.embed(texts, { visibility: vis });
        for (let k = 0; k < batch.length; k++) {
          await storeEmbedding(sql, {
            contentType: batch[k]!.contentType,
            refId: batch[k]!.refId,
            model: emb.model,
            vector: emb.vectors[k]!,
            contentHash: await sha256Hex(texts[k]!),
          });
        }
        done += batch.length;
        await jc.progress(done, rows.length);
      }
      return { embedded: done, model };
    },
  });

  jobs.register<{ moduleId: string; includeReproducible?: boolean }>({
    type: 'backup:module',
    moduleId: '0.000',
    description: 'Moduulin varmuuskopio (JSON)',
    permission: 'core.backup',
    placement: 'inline',
    async run(_jc, payload) {
      const key = ctx.config.BACKUP_ENCRYPTION_KEY;
      if (!key) throw new ValidationError('BACKUP_ENCRYPTION_KEY puuttuu');
      const mod = ctx.registry.get(payload.moduleId);
      const [row] = await sql<{ id: string }[]>`
        insert into core.backups (kind, module_id, target, include_reproducible)
        values ('module', ${payload.moduleId}, ${ctx.services.backup.provider}, ${payload.includeReproducible ?? true})
        returning id`;
      try {
        const data = await exportModule(sql, mod.manifest, {
          includeReproducible: payload.includeReproducible ?? true,
        });
        const bytes = await encryptBytes(new TextEncoder().encode(JSON.stringify(data)), key);
        const location = `modules/${payload.moduleId}/${new Date().toISOString().replace(/[:.]/g, '-')}.json.enc`;
        await ctx.services.backup.put(location, bytes, 'application/octet-stream');
        await sql`update core.backups set status = 'succeeded', location = ${location}, size_bytes = ${bytes.length},
                    sha256 = ${await sha256Hex(bytes)}, finished_at = now() where id = ${row!.id}`;
        return { backupId: row!.id, location };
      } catch (err) {
        await sql`update core.backups set status = 'failed', error = ${String(err)}, finished_at = now() where id = ${row!.id}`;
        throw err;
      }
    },
  });

  // Node-only jobs (pg_dump/pg_restore). The worker replaces these placeholders.
  for (const [type, description] of [
    ['backup:full', 'Täysi varmuuskopio (tietokanta + tiedostot)'],
    ['backup:verify', 'Varmuuskopion palautustesti'],
    ['backup:restore', 'Palautus varmuuskopiosta'],
  ] as const) {
    jobs.register({
      type,
      moduleId: '0.000',
      description,
      permission: 'core.backup',
      placement: 'worker',
      run: workerOnly(type),
    });
  }
  log.debug('core jobs registered', { count: jobs.list().length });
}
