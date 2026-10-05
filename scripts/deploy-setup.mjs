// `pnpm deploy:setup [--dry-run]`
// Puts the app online on GitHub Pages + Supabase without clicking through settings:
//  1. reads .env.deploy (created from a template on the first run)
//  2. generates encryption keys if missing
//  3. sets GitHub Secrets and Variables (gh CLI)
//  4. enables GitHub Pages (build from GitHub Actions)
//  5. configures Supabase: function secrets, Auth (no public sign-up, redirect
//     URLs), storage bucket and the allowed users
//  6. starts the deploy workflows
import { existsSync, writeFileSync } from 'node:fs';
import { c, has, key32, parseEnv, run, setEnv } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const FILE = '.env.deploy';
const root = new URL('..', import.meta.url).pathname;
process.chdir(root);

const TEMPLATE = `# Verkkojulkaisun asetukset (pnpm deploy:setup). ÄLÄ commitoi tätä tiedostoa.
# Supabase: luo projekti osoitteessa https://supabase.com/dashboard ja kopioi arvot
# Project Settings → API ja Database -sivuilta.

# Projektin tunnus (osoitteen https://<ref>.supabase.co alku)
SUPABASE_PROJECT_REF=
# Project Settings → API: anon public key (julkinen, menee selaimeen)
SUPABASE_ANON_KEY=
# Project Settings → API: service_role key (salainen)
SUPABASE_SERVICE_ROLE_KEY=
# Vanhat projektit (HS256): Project Settings → API → JWT secret. Uusissa voi jättää tyhjäksi.
SUPABASE_JWT_SECRET=
# Project Settings → Database → Connection string → URI (Session pooler), salasana mukaan
DATABASE_URL=
# https://supabase.com/dashboard/account/tokens (Edge Functionien julkaisu ja asetukset)
SUPABASE_ACCESS_TOKEN=

# Sallitut käyttäjät pilkulla eroteltuna; ensimmäinen kirjautuja on ylläpitäjä
ALLOWED_EMAILS=

# Tekoäly (valinnainen; ilman avainta käytetään valepalvelua)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# GitHub-token (fine-grained, tämä repo, Actions: Read and write), jolla API käynnistää
# pitkät taustatyöt GitHub Actionsissa. Ilman sitä työt ajetaan ajastetusti.
GITHUB_DISPATCH_TOKEN=

# Varmuuskopioiden kohde eri tarjoajalla (S3-yhteensopiva, esim. Cloudflare R2, Backblaze B2)
BACKUP_S3_ENDPOINT=
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=

# Luodaan automaattisesti, jos tyhjä. Säilytä BACKUP_ENCRYPTION_KEY myös muualla (esim. salasanojen hallinta)!
SETTINGS_ENCRYPTION_KEY=
BACKUP_ENCRYPTION_KEY=

# Valinnainen oma verkkotunnus käyttöliittymälle (esim. https://seuranta.example.fi). Tyhjä = GitHub Pages.
CUSTOM_APP_URL=
`;

if (!existsSync(FILE)) {
  writeFileSync(FILE, TEMPLATE);
  c.title('Täytä asetukset');
  c.info(
    `Loin tiedoston ${FILE}. Täytä Supabase-projektin tiedot ja sallitut sähköpostit, ja aja sitten uudelleen: pnpm deploy:setup`,
  );
  process.exit(0);
}

const cfg = parseEnv(FILE);
const missing = [
  'SUPABASE_PROJECT_REF',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'SUPABASE_ACCESS_TOKEN',
  'ALLOWED_EMAILS',
].filter((k) => !cfg[k]);
if (missing.length) {
  c.fail(`Puuttuvat arvot tiedostossa ${FILE}: ${missing.join(', ')}`);
  process.exit(1);
}
const generated = {};
if (!cfg.SETTINGS_ENCRYPTION_KEY) generated.SETTINGS_ENCRYPTION_KEY = key32();
if (!cfg.BACKUP_ENCRYPTION_KEY) generated.BACKUP_ENCRYPTION_KEY = key32();
if (Object.keys(generated).length && !DRY) {
  setEnv(FILE, generated);
  Object.assign(cfg, generated);
  c.warn(
    'Loin salausavaimet. Tallenna BACKUP_ENCRYPTION_KEY myös erilliseen turvalliseen paikkaan – ilman sitä varmuuskopioita ei voi palauttaa.',
  );
}

if (!has('gh')) {
  c.fail('GitHub CLI (gh) puuttuu: https://cli.github.com – kirjaudu ensin: gh auth login');
  process.exit(1);
}
// owner/repo from the git remote (works with HTTPS, SSH and proxied remotes), gh as fallback.
const remote = run('git', ['remote', 'get-url', 'origin'], { silent: true, allowFail: true }).out;
const fromRemote = /[/:]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(remote)?.[1];
const repo =
  process.env.GITHUB_REPOSITORY ||
  fromRemote ||
  run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { silent: true }).out;
const [owner, name] = repo.split('/');
const ref = cfg.SUPABASE_PROJECT_REF;
const supabaseUrl = `https://${ref}.supabase.co`;
const apiUrl = `${supabaseUrl}/functions/v1`;
const pagesUrl = cfg.CUSTOM_APP_URL || `https://${owner.toLowerCase()}.github.io/${name}/`;
const basePath = cfg.CUSTOM_APP_URL ? '/' : `/${name}/`;
const appOrigin = new URL(pagesUrl).origin;
c.title(`Julkaisu: ${repo}`);
c.info(`Käyttöliittymä: ${pagesUrl}`);
c.info(`API: ${apiUrl}/api/v1`);

const step = (label, fn) => {
  if (DRY) return c.info(`[kuivaharjoitus] ${label}`);
  try {
    fn();
    c.ok(label);
  } catch (e) {
    c.fail(`${label}: ${e.message}`);
    process.exitCode = 1;
  }
};

c.title('GitHub Secrets ja Variables');
const secrets = {
  DATABASE_URL: cfg.DATABASE_URL,
  SUPABASE_ACCESS_TOKEN: cfg.SUPABASE_ACCESS_TOKEN,
  SUPABASE_SERVICE_ROLE_KEY: cfg.SUPABASE_SERVICE_ROLE_KEY,
  SETTINGS_ENCRYPTION_KEY: cfg.SETTINGS_ENCRYPTION_KEY,
  BACKUP_ENCRYPTION_KEY: cfg.BACKUP_ENCRYPTION_KEY,
  ALLOWED_EMAILS: cfg.ALLOWED_EMAILS,
  ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: cfg.OPENAI_API_KEY,
  BACKUP_S3_ENDPOINT: cfg.BACKUP_S3_ENDPOINT,
  BACKUP_S3_REGION: cfg.BACKUP_S3_REGION,
  BACKUP_S3_BUCKET: cfg.BACKUP_S3_BUCKET,
  BACKUP_S3_ACCESS_KEY_ID: cfg.BACKUP_S3_ACCESS_KEY_ID,
  BACKUP_S3_SECRET_ACCESS_KEY: cfg.BACKUP_S3_SECRET_ACCESS_KEY,
};
for (const [k, v] of Object.entries(secrets)) {
  if (v)
    step(`secret ${k}`, () => run('gh', ['secret', 'set', k, '--repo', repo], { input: v, silent: true }));
}
const variables = {
  VITE_API_URL: apiUrl,
  VITE_BASE_PATH: basePath,
  SUPABASE_PROJECT_REF: ref,
  SUPABASE_URL: supabaseUrl,
  STORAGE_PROVIDER: 'supabase',
  BACKUP_TARGET: cfg.BACKUP_S3_BUCKET ? 's3' : 'local',
};
for (const [k, v] of Object.entries(variables))
  step(`variable ${k}=${v}`, () =>
    run('gh', ['variable', 'set', k, '--body', v, '--repo', repo], { silent: true }),
  );
if (!cfg.BACKUP_S3_BUCKET)
  c.warn(
    'Varmuuskopioiden S3-kohde puuttuu: päivittäiset varmuuskopiot jäävät GitHub Actionsin väliaikaiseen levyyn. Lisää BACKUP_S3_* (ks. docs/BACKUP.md).',
  );

c.title('GitHub Pages');
step('Pages käyttöön (GitHub Actions -julkaisu)', () => {
  const exists = run('gh', ['api', `repos/${repo}/pages`], { silent: true, allowFail: true }).ok;
  run('gh', ['api', '-X', exists ? 'PUT' : 'POST', `repos/${repo}/pages`, '-f', 'build_type=workflow'], {
    silent: true,
  });
});

c.title('Supabase');
const mgmt = async (method, path, body) => {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
};
const astep = async (label, fn) => {
  if (DRY) return c.info(`[kuivaharjoitus] ${label}`);
  try {
    await fn();
    c.ok(label);
  } catch (e) {
    c.fail(`${label}: ${e.message}`);
    process.exitCode = 1;
  }
};

// Edge Function secrets (SUPABASE_URL / ANON / SERVICE_ROLE / DB_URL are provided by Supabase).
const fnSecrets = {
  AUTH_PROVIDER: 'supabase',
  ALLOWED_EMAILS: cfg.ALLOWED_EMAILS,
  APP_BASE_URL: appOrigin,
  CORS_ORIGINS: appOrigin,
  API_PUBLIC_URL: apiUrl,
  SETTINGS_ENCRYPTION_KEY: cfg.SETTINGS_ENCRYPTION_KEY,
  BACKUP_ENCRYPTION_KEY: cfg.BACKUP_ENCRYPTION_KEY,
  STORAGE_PROVIDER: 'supabase',
  REALTIME_PROVIDER: 'supabase',
  MAIL_PROVIDER: 'supabase-auth',
  JOBS_RUNNER: cfg.GITHUB_DISPATCH_TOKEN ? 'github-actions' : 'queue',
  GITHUB_REPOSITORY: repo,
  GITHUB_DISPATCH_TOKEN: cfg.GITHUB_DISPATCH_TOKEN,
  ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: cfg.OPENAI_API_KEY,
  AUTH_JWT_SECRET: cfg.SUPABASE_JWT_SECRET,
  BACKUP_TARGET: cfg.BACKUP_S3_BUCKET ? 's3' : 'local',
  BACKUP_S3_ENDPOINT: cfg.BACKUP_S3_ENDPOINT,
  BACKUP_S3_REGION: cfg.BACKUP_S3_REGION,
  BACKUP_S3_BUCKET: cfg.BACKUP_S3_BUCKET,
  BACKUP_S3_ACCESS_KEY_ID: cfg.BACKUP_S3_ACCESS_KEY_ID,
  BACKUP_S3_SECRET_ACCESS_KEY: cfg.BACKUP_S3_SECRET_ACCESS_KEY,
};
await astep('Edge Function -salaisuudet', () =>
  mgmt(
    'POST',
    `/projects/${ref}/secrets`,
    Object.entries(fnSecrets)
      .filter(([, v]) => v)
      .map(([name, value]) => ({ name, value })),
  ),
);
await astep('Kirjautuminen: ei julkista rekisteröitymistä, paluuosoitteet', () =>
  mgmt('PATCH', `/projects/${ref}/config/auth`, {
    site_url: pagesUrl,
    uri_allow_list: [pagesUrl, `${pagesUrl.replace(/\/$/, '')}/**`, 'http://localhost:5173/**'].join(','),
    disable_signup: true,
  }),
);
const admin = async (method, path, body) => {
  const res = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
};
await astep('Tallennustila (bucket poliitikkoseuranta)', async () => {
  const r = await admin('POST', '/storage/v1/bucket', {
    id: 'poliitikkoseuranta',
    name: 'poliitikkoseuranta',
    public: false,
  });
  if (!r.ok && r.status !== 409 && !(await r.text()).includes('already exists'))
    throw new Error(`HTTP ${r.status}`);
});
for (const email of cfg.ALLOWED_EMAILS.split(',')
  .map((e) => e.trim())
  .filter(Boolean)) {
  await astep(`Käyttäjä ${email}`, async () => {
    const r = await admin('POST', '/auth/v1/admin/users', { email, email_confirm: true });
    if (!r.ok && r.status !== 422) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  });
}

c.title('Julkaisu');
step('Supabase-migraatiot ja Edge Function (workflow supabase.yml)', () =>
  run('gh', ['workflow', 'run', 'supabase.yml', '--repo', repo], { silent: true }),
);
step('Käyttöliittymä GitHub Pagesiin (workflow pages.yml)', () =>
  run('gh', ['workflow', 'run', 'pages.yml', '--repo', repo], { silent: true }),
);

c.title('Valmis');
console.log(`
  Seuraa julkaisua:  gh run watch --repo ${repo}
  Käyttöliittymä:    ${pagesUrl}
  Kirjaudu sähköpostilinkillä osoitteella: ${cfg.ALLOWED_EMAILS.split(',')[0]}
  Huom: työnkulut käyttävät oletushaaraa; yhdistä muutokset main-haaraan ennen julkaisua.
`);
