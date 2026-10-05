// `pnpm run setup` – installs everything on an empty machine:
// dependencies, .env with generated keys, database (Docker or existing),
// migrations, seed data, typed SDK, and a first data import.
// (Note: plain `pnpm setup` is a built-in pnpm command; use `pnpm run setup`.)
import { copyFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { c, has, key32, parseEnv, run, setEnv } from './lib.mjs';

const root = new URL('..', import.meta.url).pathname;
process.chdir(root);

c.title('Poliitikkoseuranta – asennus');

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  c.fail(`Node.js 22 tai uudempi vaaditaan (nyt ${process.versions.node}).`);
  process.exit(1);
}
c.ok(`Node.js ${process.versions.node}`);

c.title('1/6 Riippuvuudet');
run('pnpm', ['install']);

c.title('2/6 Asetukset (.env)');
if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  c.ok('.env luotu pohjasta .env.example');
}
const env = parseEnv('.env');
const updates = {};
if (!env.AUTH_JWT_SECRET) updates.AUTH_JWT_SECRET = key32();
if (!env.SETTINGS_ENCRYPTION_KEY) updates.SETTINGS_ENCRYPTION_KEY = key32();
if (!env.BACKUP_ENCRYPTION_KEY) updates.BACKUP_ENCRYPTION_KEY = key32();
if (!env.ALLOWED_EMAILS || env.ALLOWED_EMAILS === 'admin@example.com') {
  const gitEmail = run('git', ['config', 'user.email'], { silent: true, allowFail: true }).out;
  if (gitEmail) {
    updates.ALLOWED_EMAILS = gitEmail;
    c.info(`Sallittu käyttäjä: ${gitEmail} (muuta ALLOWED_EMAILS .env-tiedostossa)`);
  }
}
if (Object.keys(updates).length) {
  setEnv('.env', updates);
  c.ok(`Luotiin: ${Object.keys(updates).join(', ')}`);
}
Object.assign(
  process.env,
  parseEnv('.env'),
  process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {},
);

c.title('3/6 Tietokanta');
// postgres is a dependency of @ps/core; import it from there.
const probe = () =>
  run(
    'node',
    [
      '--input-type=module',
      '-e',
      `import p from '${root}packages/core/node_modules/postgres/src/index.js'; const s = p(process.env.DATABASE_URL, {connect_timeout: 3, onnotice: () => {}}); try { await s\`select 1\`; await s.end(); } catch { process.exit(1) }`,
    ],
    {
      silent: true,
      allowFail: true,
    },
  ).ok;

let connected = probe();
if (!connected && has('docker')) {
  c.info('Käynnistetään PostgreSQL + pgvector Dockerissa (docker compose up -d db)…');
  run('docker', ['compose', 'up', '-d', 'db'], { allowFail: true });
  for (let i = 0; i < 40 && !connected; i++) {
    await sleep(1500);
    connected = probe();
  }
}
if (!connected) {
  c.fail(`Tietokantaan ei saada yhteyttä: ${process.env.DATABASE_URL}`);
  c.info(
    'Vaihtoehdot: 1) asenna Docker ja aja uudelleen, 2) aja `supabase start` ja aseta DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres,',
  );
  c.info('3) aseta DATABASE_URL olemassa olevaan PostgreSQL-kantaan (pgvector ja pg_trgm vaaditaan).');
  process.exit(1);
}
c.ok('Tietokantayhteys toimii');

c.title('4/6 Migraatiot ja alkudata');
run('pnpm', ['-s', 'db:migrate']);
run('pnpm', ['-s', 'db:seed']);

c.title('5/6 Tyypitetty SDK (OpenAPI)');
run('pnpm', ['-s', 'sdk:generate']);

c.title('6/6 Datan tuonti eduskunnan avoimesta datasta');
const imported = run('pnpm', ['-s', 'job', 'run', 'sync:registries'], { allowFail: true, silent: true });
if (imported.ok) c.ok('Perusrekisterit päivitetty eduskunnan viitetiedoista');
else
  c.warn(
    'Eduskunnan rajapintaan ei saatu yhteyttä; alkudata on silti käytössä. Päivitä myöhemmin: pnpm job run sync:registries',
  );

c.title('Valmis!');
console.log(`
  Käynnistä:          pnpm dev
  Käyttöliittymä:     http://localhost:5173  (kirjaudu osoitteella ${parseEnv('.env').ALLOWED_EMAILS?.split(',')[0]})
  API + OpenAPI:      http://localhost:8787/api/v1/openapi.json
  Testit:             pnpm test   ·   pnpm test:e2e
  Verkkoon (GitHub Pages + Supabase):  pnpm deploy:setup
`);
