/**
 * Worker CLI. Every background task is a command, so the same code runs in
 * GitHub Actions, cron, systemd timers or a Docker container:
 *
 *   pnpm db:migrate                     apply migrations (snapshot first)
 *   pnpm db:seed                        permissions, sync sources, module seed data
 *   pnpm job run <type> [--key value]   run one job now (e.g. sync:registries, backup:full)
 *   pnpm job work [--id <jobId>]        process queued jobs (GitHub Actions dispatch uses --id)
 *   pnpm job list                       list job types
 *   pnpm job module:export <id> [file]  module data as provider-neutral JSON
 *   pnpm job module:import <file> --confirm
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
  createRuntime,
  enqueueJob,
  exportModule,
  importModule,
  pendingMigrations,
  runMigrations,
  syncPermissions,
  takeSnapshot,
  withActor,
  errorMessage,
  type ModuleBackup,
  type Runtime,
} from '@ps/core';
import { loadMigrationFiles, registerNodeJobs, runFullBackup } from '@ps/core/node';
import { serverModules } from '@ps/api/modules';
import { flagsToPayload, parseArgs } from './args.ts';

async function migrate(rt: Runtime): Promise<void> {
  const files = await loadMigrationFiles();
  const pending = await pendingMigrations(rt.sql, files);
  if (!pending.length) {
    console.log('Tietokanta on ajan tasalla.');
    return;
  }
  // Automatic snapshot before risky changes (only when there is data to protect).
  const [{ hasCore }] =
    (await rt.sql`select to_regclass('core.users') is not null as has_core`) as unknown as [
      { hasCore: boolean },
    ];
  if (hasCore && rt.config.BACKUP_BEFORE_MIGRATE && rt.config.BACKUP_ENCRYPTION_KEY) {
    console.log('Otetaan varmuuskopio ennen migraatioita…');
    try {
      const r = await runFullBackup(rt, { kind: 'pre_migration' });
      console.log(`  ${r.location}`);
    } catch (err) {
      console.error(`Varmuuskopio ennen migraatiota epäonnistui: ${errorMessage(err)}`);
      if (!process.env.MIGRATE_WITHOUT_BACKUP) {
        throw new Error('Migraatiot keskeytettiin. Aseta MIGRATE_WITHOUT_BACKUP=1 ohittaaksesi.');
      }
    }
  }
  const r = await runMigrations(rt.sql, files, { onApply: (n) => console.log(`  ✓ ${n}`) });
  console.log(`Migraatioita ajettu: ${r.applied.length}`);
}

async function seed(rt: Runtime): Promise<void> {
  await syncPermissions(rt.sql, rt.registry.manifests());
  await rt.sync.persist(rt.sql);
  for (const m of rt.registry.list()) {
    if (m.seed) {
      await m.seed(rt);
      console.log(`  ✓ ${m.manifest.id} ${m.manifest.name}`);
    }
  }
  console.log('Alkudata ja oikeudet päivitetty.');
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') {
    console.log(
      'Käyttö: pnpm job <db:migrate|db:seed|run|work|list|module:export|module:import> …\nKatso apps/worker/src/cli.ts tai README.md.',
    );
    return 0;
  }

  const rt = await createRuntime({ modules: serverModules, host: 'worker' });
  registerNodeJobs(rt);
  try {
    switch (command) {
      case 'db:migrate':
        await migrate(rt);
        return 0;
      case 'db:seed':
        await seed(rt);
        return 0;
      case 'setup':
        await migrate(rt);
        await seed(rt);
        return 0;
      case 'list':
        for (const j of rt.jobs.list())
          console.log(`${j.type.padEnd(24)} ${j.placement.padEnd(7)} ${j.description}`);
        for (const s of rt.sync.list()) console.log(`sync:run --source-id ${s.id.padEnd(30)} ${s.name}`);
        return 0;
      case 'run': {
        const type = positional[0];
        if (!type) throw new Error('Anna työn tyyppi, esim. pnpm job run sync:registries');
        if (!rt.jobs.get(type)) throw new Error(`Tuntematon työ ${type}. Katso: pnpm job list`);
        const job = await enqueueJob(rt.sql, {
          type,
          moduleId: rt.jobs.get(type)!.moduleId,
          payload: flagsToPayload(flags),
          runner: 'cli',
        });
        const outcome = await rt.runJobById(job.id);
        const [done] = await rt.sql`select status, result, error from core.jobs where id = ${job.id}`;
        console.log(JSON.stringify({ job: job.id, outcome, ...done }, null, 2));
        return outcome === 'succeeded' ? 0 : 1;
      }
      case 'work': {
        if (typeof flags.id === 'string') {
          const outcome = await rt.runJobById(flags.id);
          console.log(`Työ ${flags.id}: ${outcome}`);
          return outcome === 'failed' ? 1 : 0;
        }
        const n = await rt.workQueue({ maxJobs: Number(flags.max ?? 50) });
        console.log(`Käsiteltiin ${n} työtä.`);
        return 0;
      }
      case 'module:export': {
        const id = positional[0];
        if (!id) throw new Error('Anna moduulin tunnus, esim. 0.001');
        const data = await exportModule(rt.sql, rt.registry.get(id).manifest, {
          includeReproducible: flags['skip-reproducible'] !== true,
        });
        const file = positional[1] ?? `moduuli-${id}-${new Date().toISOString().slice(0, 10)}.json`;
        await writeFile(file, JSON.stringify(data, null, 2));
        console.log(`Kirjoitettu ${file}`);
        return 0;
      }
      case 'module:import': {
        const file = positional[0];
        if (!file) throw new Error('Anna tiedosto');
        if (flags.confirm !== true)
          throw new Error('Palautus korvaa tietoja. Lisää --confirm vahvistukseksi.');
        const backup = JSON.parse(await readFile(file, 'utf8')) as ModuleBackup;
        const mod = rt.registry.list().find((m) => m.manifest.id === backup.moduleId);
        if (!mod) throw new Error(`Moduulia ${backup.moduleId} ei ole asennettu`);
        const result = await withActor(rt.sql, { kind: 'system', label: 'cli:module-import' }, async (tx) => {
          for (const t of [...mod.manifest.backup.irreplaceable, ...mod.manifest.backup.reproducible]) {
            await takeSnapshot(tx, {
              reason: 'Ennen moduulin palautusta (CLI)',
              moduleId: mod.manifest.id,
              table: t.table,
            });
          }
          return importModule(tx, mod.manifest, backup, mod.upgradeBackup);
        });
        console.log(JSON.stringify(result, null, 2));
        return 0;
      }
      default:
        throw new Error(`Tuntematon komento ${command}`);
    }
  } finally {
    await rt.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`Virhe: ${errorMessage(err)}`);
    process.exit(1);
  });
