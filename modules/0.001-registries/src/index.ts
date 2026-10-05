import type { ServerModule } from '@ps/core';
import { withActor, SYSTEM } from '@ps/core';
import { manifest } from './manifest.ts';
import { createRegistriesApi, type RegistriesApi } from './api.ts';
import { registerRegistryRoutes } from './routes.ts';
import { referenceSync } from './sync/eduskunta.ts';
import { reindexRegistries, seedRegistries } from './seed/seed.ts';

export { manifest } from './manifest.ts';
export type { RegistriesApi, EntityName, EntityRows } from './api.ts';
export * from './schema.ts';
export { EVENTS } from './events.ts';

/** Module 0.001 Perusrekisterit – server side. */
export const registriesModule: ServerModule<RegistriesApi> = {
  manifest,
  createApi: () => createRegistriesApi(),
  registerRoutes: registerRegistryRoutes,
  syncSources: (ctx) => [referenceSync(() => ctx.config.EDUSKUNTA_API_URL)],
  jobs: (ctx) => [
    {
      type: 'sync:registries',
      moduleId: manifest.id,
      description: 'Perusrekisterien päivitys eduskunnan datasta',
      permission: 'registries.sync',
      placement: 'inline',
      maxAttempts: 2,
      async run(jc) {
        const r = await ctx.runSync(
          '0.001:eduskunta-reference',
          {},
          { jobId: jc.job.id, triggeredBy: jc.job.createdBy },
        );
        await withActor(ctx.sql, SYSTEM, (tx) => reindexRegistries(tx));
        if (r.status === 'failed') throw new Error(r.errors[0]?.message ?? 'Synkronointi epäonnistui');
        return r;
      },
    },
  ],
  async seed(ctx) {
    await withActor(ctx.sql, { kind: 'system', label: 'seed:0.001' }, (tx) => seedRegistries(tx));
  },
};

export default registriesModule;
