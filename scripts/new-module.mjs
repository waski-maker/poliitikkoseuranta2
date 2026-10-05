// `pnpm new-module <numero> <nimi> ["Näyttönimi"]`
// Creates a complete module skeleton: manifest (with permissions, menu, backup
// info), schema + migration with RLS, typed API, events, REST routes with
// OpenAPI, sync source, UI page, dashboard card, tests and README – and
// registers it in the API, worker and web app.
// Example: pnpm new-module 1.003 votes "Äänestykset"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { c, run } from './lib.mjs';

const [id, slugArg, displayArg] = process.argv.slice(2);
if (!id || !slugArg || !/^\d+\.\d{3}$/.test(id) || !/^[a-z][a-z0-9-]*$/.test(slugArg)) {
  c.fail(
    'Käyttö: pnpm new-module <numero> <nimi> ["Näyttönimi"]   esim. pnpm new-module 1.003 votes "Äänestykset"',
  );
  process.exit(1);
}
const root = new URL('..', import.meta.url).pathname;
const slug = slugArg;
const name = displayArg ?? slug.charAt(0).toUpperCase() + slug.slice(1);
const [major, minor] = id.split('.');
const num = `${major.padStart(1, '0')}${minor}`.padStart(4, '0');
const schema = `m${num}_${slug.replace(/-/g, '_')}`;
const dir = join(root, 'modules', `${id}-${slug}`);
const pkg = `@ps/m${num}-${slug}`;
const camel = slug.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
const Pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
const route = `/${slug}`;
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const migration = `${stamp}_${schema}.sql`;
if (existsSync(dir)) {
  c.fail(`Moduuli on jo olemassa: ${dir}`);
  process.exit(1);
}

const files = {
  'package.json':
    JSON.stringify(
      {
        name: pkg,
        version: '0.1.0',
        private: true,
        type: 'module',
        description: `${id} ${name}`,
        exports: { '.': './src/index.ts', './manifest': './src/manifest.ts', './ui': './src/ui/index.tsx' },
        scripts: { typecheck: 'tsc -p tsconfig.json' },
        dependencies: { '@ps/core': 'workspace:*', '@hono/zod-openapi': '^1.1.0', zod: '^4.1.0' },
        peerDependencies: {
          '@ps/sdk': 'workspace:*',
          '@ps/ui': 'workspace:*',
          react: '^19.0.0',
          'react-router': '^7.0.0',
          'lucide-react': '*',
        },
        devDependencies: {
          '@ps/sdk': 'workspace:*',
          '@ps/ui': 'workspace:*',
          '@types/react': '^19.0.0',
          'lucide-react': '^0.577.0',
          react: '^19.2.0',
          'react-router': '^7.9.0',
          typescript: '^5.9.3',
        },
      },
      null,
      2,
    ) + '\n',
  'tsconfig.json': '{\n  "extends": "../../tsconfig.base.json",\n  "include": ["src", "tests"]\n}\n',
  'README.md': `# ${id} ${name}

Moduulin kuvaus.

## Rakenne

- \`src/manifest.ts\` – tunnus, riippuvuudet, oikeudet, valikko, tapahtumat, palvelut, tietolähteet ja varmuuskopiointi
- \`src/schema.ts\` – taulut skeemassa \`${schema}\` (SQL: \`supabase/migrations/${migration}\`)
- \`src/api.ts\` – julkinen rajapinta muille moduuleille (\`registry.get('${id}').api\`)
- \`src/events.ts\` – julkaistavat tapahtumat
- \`src/routes.ts\` – REST-rajapinta \`/api/v1${route}\` (OpenAPI)
- \`src/sync/\` – tuonti ulkoisista lähteistä
- \`src/ui/\` – sivut ja kojelautakortti
- \`tests/\` – testit

Katso tarkistuslista: docs/MODULES.md.
`,
  'src/manifest.ts': `import { defineManifest } from '@ps/core/manifest';

export const manifest = defineManifest({
  id: '${id}',
  slug: '${slug}',
  name: '${name}',
  description: 'TODO: kuvaus',
  version: '0.1.0',
  dependsOn: ['0.001'],
  dbSchema: '${schema}',
  migrations: ['${migration}'],
  apiBasePath: '${route}',
  provides: ['${slug}.items'],
  events: {
    publishes: [{ type: '${slug}.item_created', version: 1, description: 'Uusi rivi lisättiin' }],
    subscribes: [],
  },
  menu: [{ label: '${name}', path: '/${slug}', icon: 'Box', permission: '${slug}.read', order: 100, section: 'main' }],
  permissions: [
    { id: '${slug}.read', description: '${name}: luku', roles: ['editor', 'analyst', 'reader'] },
    { id: '${slug}.edit', description: '${name}: muokkaus', roles: ['editor'] },
  ],
  settings: [],
  services: ['database'],
  dataSources: [],
  backup: {
    schemaVersion: 1,
    // Käsin syötetyt ja muokatut tiedot, analyysit: varmuuskopioidaan aina.
    irreplaceable: [{ table: '${schema}.items', description: 'Rivit' }],
    // Uudelleen tuotettavat (avoin data, indeksit, upotteet): voidaan jättää pois.
    reproducible: [],
    files: { irreplaceable: [], reproducible: [] },
  },
  searchTypes: [{ type: '${slug}-item', label: '${name}', readPermission: '${slug}.read' }],
  dashboardCards: [{ id: '${slug}-card', title: '${name}', permission: '${slug}.read' }],
});
`,
  'src/schema.ts': `/** Tables of module ${id} (schema ${schema}). Other modules use api.ts, never these tables. */
export const SCHEMA = '${schema}';
export const TABLES = { items: \`\${SCHEMA}.items\` } as const;

export interface Item {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  visibility: 'public' | 'internal' | 'private';
  source: 'eduskunta' | 'manual' | 'seed' | 'other';
  sourceUrl: string | null;
  fetchedAt: Date | null;
  manualFields: string[];
}
`,
  'src/events.ts': `import type { Db } from '@ps/core';
import { publishEvent } from '@ps/core';
import { manifest } from './manifest.ts';

export const EVENTS = { itemCreated: '${slug}.item_created' } as const;

export function publishItemCreated(db: Db, itemId: string) {
  return publishEvent(db, { type: EVENTS.itemCreated, source: manifest.id, payload: { itemId } });
}
`,
  'src/api.ts': `import type { Db, ListOptions } from '@ps/core';
import { getRow, indexDocument, insertRow, listRows, softDeleteRow, updateRow } from '@ps/core';
import { TABLES, type Item } from './schema.ts';
import { publishItemCreated } from './events.ts';
import { manifest } from './manifest.ts';

/** Public API of module ${id}. Every method takes an actor-scoped connection (RLS applies). */
export function create${Pascal}Api() {
  return {
    list: (db: Db, opts: ListOptions = {}) => listRows<Item>(db, TABLES.items, { orderBy: 'name', ...opts }),
    get: (db: Db, id: string) => getRow<Item>(db, TABLES.items, id),
    async create(db: Db, data: { name: string; description?: string | null }) {
      const row = await insertRow<Item>(db, TABLES.items, { ...data, source: 'manual' });
      await indexDocument(db, {
        contentType: '${slug}-item',
        refId: row.id,
        moduleId: manifest.id,
        title: row.name,
        body: row.description,
        urlPath: '/${slug}',
        readPermission: '${slug}.read',
      });
      await publishItemCreated(db, row.id);
      return row;
    },
    update: async (db: Db, id: string, patch: Partial<Pick<Item, 'name' | 'description'>>) => (await updateRow<Item>(db, TABLES.items, id, patch)).after,
    remove: (db: Db, id: string) => softDeleteRow(db, TABLES.items, id),
  };
}

export type ${Pascal}Api = ReturnType<typeof create${Pascal}Api>;

declare module '@ps/core' {
  interface ModuleApis {
    '${id}': ${Pascal}Api;
  }
}
`,
  'src/routes.ts': `import { createRoute, z } from '@hono/zod-openapi';
import type { ModuleContext, ModuleRouter } from '@ps/core';
import { ListQuerySchema, RecordMetaSchema, errorResponses, json, jsonContent, requirePermission } from '@ps/core';
import type { ${Pascal}Api } from './api.ts';

const Fields = z.object({ name: z.string().min(1), description: z.string().nullable() });
const Item = RecordMetaSchema.extend(Fields.shape).openapi('${Pascal}Item');

/**
 * REST endpoints at /api/v1${route}. Every module function (search, create,
 * edit, import, export, analysis) must be available here and described in OpenAPI.
 */
export function register${Pascal}Routes(router: ModuleRouter, ctx: ModuleContext): void {
  const api = () => ctx.registry.get('${id}').api as ${Pascal}Api;
  const asUser = (u: { id: string; email: string }) => ({ kind: 'user' as const, userId: u.id, email: u.email });

  router.openapi(
    createRoute({
      method: 'get',
      path: '/items',
      tags: ['${name}'],
      summary: 'Listaa rivit',
      request: { query: ListQuerySchema },
      responses: { 200: jsonContent(z.object({ items: z.array(Item) }), 'Rivit'), ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), '${slug}.read');
      const q = c.req.valid('query');
      const items = await ctx.withActor(asUser(user), (tx) =>
        api().list(tx, { updatedSince: q.updated_since, includeDeleted: q.include_deleted === 'true', limit: q.limit, offset: q.offset }),
      );
      return c.json({ items: json(items) }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: 'post',
      path: '/items',
      tags: ['${name}'],
      summary: 'Lisää rivi',
      request: { body: { content: { 'application/json': { schema: Fields.partial({ description: true }) } }, required: true } },
      responses: { 201: jsonContent(Item, 'Luotu'), ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), '${slug}.edit');
      const row = await ctx.withActor(asUser(user), (tx) => api().create(tx, c.req.valid('json')));
      return c.json(json(row), 201);
    },
  );
}
`,
  'src/sync/index.ts': `import type { SyncSourceDefinition } from '@ps/core';
import { manifest } from '../manifest.ts';

/** Example sync source. Use ctx.createHttp() (rate limits, retries) and upsertSynced() (keeps manual edits). */
export function ${camel}Sync(): SyncSourceDefinition {
  return {
    id: '${id}:example',
    moduleId: manifest.id,
    name: '${name}: esimerkkituonti',
    description: 'TODO: tietolähde',
    dataSource: 'eduskunta',
    async run(ctx) {
      ctx.log.info('Ei toteutettu vielä');
    },
  };
}
`,
  'src/index.ts': `import type { ServerModule } from '@ps/core';
import { manifest } from './manifest.ts';
import { create${Pascal}Api, type ${Pascal}Api } from './api.ts';
import { register${Pascal}Routes } from './routes.ts';
import { ${camel}Sync } from './sync/index.ts';

export { manifest } from './manifest.ts';
export type { ${Pascal}Api } from './api.ts';

/** Module ${id} ${name} – server side. */
export const ${camel}Module: ServerModule<${Pascal}Api> = {
  manifest,
  createApi: () => create${Pascal}Api(),
  registerRoutes: register${Pascal}Routes,
  syncSources: () => [${camel}Sync()],
};

export default ${camel}Module;
`,
  'src/ui/index.tsx': `import type { UiModule } from '@ps/sdk/react';
import { ${Pascal}Page } from './${Pascal}Page.tsx';

export const ${camel}Ui: UiModule = {
  id: '${id}',
  routes: [{ path: '/${slug}', element: <${Pascal}Page /> }],
  dashboardCards: [],
};
`,
  [`src/ui/${Pascal}Page.tsx`]: `import { unwrap } from '@ps/sdk';
import { useApi, useQuery } from '@ps/sdk/react';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, Table, Td, Th } from '@ps/ui';

export function ${Pascal}Page() {
  const api = useApi();
  const q = useQuery({
    queryKey: ['${slug}', 'items'],
    queryFn: async () => (await unwrap(api.GET('${route}/items' as '/registries/parties', {}))).items as unknown as { id: string; name: string }[],
  });
  return (
    <>
      <PageHeader title="${name}" crumbs={[{ label: '${name}' }]} />
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.data && !q.data.length ? <EmptyState title="Ei rivejä vielä" /> : null}
      {q.data?.length ? (
        <Card>
          <Table>
            <thead><tr><Th>Nimi</Th></tr></thead>
            <tbody>{q.data.map((r) => <tr key={r.id}><Td>{r.name}</Td></tr>)}</tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
`,
  'tests/module.test.ts': `import { describe, expect, it } from 'vitest';
import { validateManifest } from '@ps/core';
import { manifest } from '../src/manifest.ts';

describe('module ${id}', () => {
  it('has a valid manifest with backup information', () => {
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.backup.irreplaceable.length + manifest.backup.reproducible.length).toBeGreaterThan(0);
  });
});
`,
};

for (const [rel, content] of Object.entries(files)) {
  const f = join(dir, rel);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, content);
}

writeFileSync(
  join(root, 'supabase', 'migrations', migration),
  `-- Module ${id} ${name}
create schema if not exists ${schema};
grant usage on schema ${schema} to anon, authenticated;

create table ${schema}.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text
);
-- Standard columns (created/updated/by, deleted_at, visibility, source …),
-- audit + updated_at triggers and RLS policies (read / edit permission).
select core.setup_table('${schema}.items', '${slug}.read', '${slug}.edit');
`,
);

// Register in the API (server modules) and the web app (UI modules).
const apiModules = join(root, 'apps/api/src/modules.ts');
let a = readFileSync(apiModules, 'utf8');
a = a.replace(
  /(import type \{ ServerModule \} from '@ps\/core';\n)/,
  `$1import { ${camel}Module } from '${pkg}';\n`,
);
a = a.replace(
  /(export const serverModules: ServerModule\[\] = \[)([\s\S]*?)(\];)/,
  (_, s, body, e) =>
    `${s}${body.trimEnd().replace(/,$/, '')}${body.trim() ? ', ' : ''}${camel}Module as ServerModule${e}`,
);
writeFileSync(apiModules, a);

const webModules = join(root, 'apps/web/src/modules.ts');
let w = readFileSync(webModules, 'utf8');
w = w.replace(
  /(import type \{ UiModule \} from '@ps\/sdk\/react';\n)/,
  `$1import { manifest as ${camel}Manifest } from '${pkg}/manifest';\nimport { ${camel}Ui } from '${pkg}/ui';\n`,
);
w = w.replace(
  /(export const uiModules[^=]*= \[)([\s\S]*?)(\];)/,
  (_, s, body, e) =>
    `${s}${body.trimEnd().replace(/,$/, '')}, { manifest: ${camel}Manifest, ui: ${camel}Ui }${e}`,
);
writeFileSync(webModules, w);

for (const p of ['apps/api/package.json', 'apps/web/package.json']) {
  const f = join(root, p);
  const j = JSON.parse(readFileSync(f, 'utf8'));
  j.dependencies[pkg] = 'workspace:*';
  j.dependencies = Object.fromEntries(Object.entries(j.dependencies).sort(([x], [y]) => x.localeCompare(y)));
  writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}

run('pnpm', ['install', '--silent']);
run('pnpm', ['exec', 'prettier', '--write', dir, apiModules, webModules, '--log-level', 'warn']);
c.ok(`Moduuli luotu: modules/${id}-${slug} (${pkg})`);
c.info(`Migraatio: supabase/migrations/${migration}`);
c.info(
  'Seuraavaksi: pnpm db:migrate && pnpm db:seed && pnpm sdk:generate — ja käy läpi docs/MODULES.md:n tarkistuslista.',
);
