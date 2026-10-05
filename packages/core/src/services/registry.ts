import type { AppConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { SettingsStore } from '../settings/store.ts';
import type { Logger } from '../util/log.ts';
import type { ModuleManifest, ServiceType } from '../modules/manifest.ts';
import { errorMessage, ValidationError } from '../util/errors.ts';
import type {
  JobsRunnerAdapter,
  MailAdapter,
  ProviderOption,
  RealtimeAdapter,
  StorageAdapter,
  SwitchableService,
  TestResult,
} from './types.ts';
import { diskStorage, memoryStorage, s3Storage, supabaseStorage } from './adapters/storage.ts';
import { consoleMail, resendMail, supabaseAuthMail } from './adapters/mail.ts';
import { githubActionsRunner, inlineRunner, queueRunner } from './adapters/jobs.ts';
import { pollingRealtime, supabaseRealtime } from './adapters/realtime.ts';

export const SERVICES_SCOPE = 'services';

export const SERVICE_LABELS: Record<ServiceType, string> = {
  database: 'Tietokanta',
  auth: 'Kirjautuminen',
  storage: 'Tiedostojen tallennus',
  mail: 'Sähköposti',
  realtime: 'Reaaliaikaiset ilmoitukset',
  jobs: 'Taustatöiden ajo',
  ai: 'Tekoäly',
  embeddings: 'Upotteet (semanttinen haku)',
  backup: 'Varmuuskopioiden kohde',
  hosting: 'Käyttöliittymän julkaisu',
  'api-runtime': 'API:n ajoympäristö',
};

export const PROVIDER_OPTIONS: Record<SwitchableService, ProviderOption[]> = {
  storage: [
    {
      id: 'supabase',
      label: 'Supabase Storage',
      fields: [
        { key: 'url', label: 'Supabase-osoite', placeholder: 'https://xyz.supabase.co' },
        { key: 'bucket', label: 'Bucket' },
        { key: 'serviceKey', label: 'Service role -avain', secret: true },
      ],
    },
    { id: 'local', label: 'Paikallinen levy', fields: [{ key: 'dir', label: 'Hakemisto' }] },
    {
      id: 's3',
      label: 'S3-yhteensopiva (AWS, R2, MinIO)',
      fields: [
        { key: 'endpoint', label: 'Osoite' },
        { key: 'region', label: 'Alue' },
        { key: 'bucket', label: 'Bucket' },
        { key: 'accessKeyId', label: 'Access key ID', secret: true },
        { key: 'secretAccessKey', label: 'Secret access key', secret: true },
      ],
    },
  ],
  mail: [
    { id: 'supabase-auth', label: 'Supabase Auth -sähköpostit', fields: [] },
    {
      id: 'resend',
      label: 'Resend',
      fields: [
        { key: 'from', label: 'Lähettäjä' },
        { key: 'apiKey', label: 'API-avain', secret: true },
      ],
    },
    { id: 'console', label: 'Palvelimen loki (kehitys)', fields: [] },
  ],
  jobs: [
    {
      id: 'github-actions',
      label: 'GitHub Actions',
      fields: [
        { key: 'repository', label: 'Repositorio', placeholder: 'omistaja/repo' },
        { key: 'workflowFile', label: 'Työnkulku', placeholder: 'jobs.yml' },
        { key: 'ref', label: 'Haara', placeholder: 'main' },
        { key: 'token', label: 'GitHub-token (actions:write)', secret: true },
      ],
    },
    { id: 'inline', label: 'API-palvelimella (Node/Docker)', fields: [] },
    { id: 'queue', label: 'Jono + erillinen työntekijä (cron, systemd, Docker)', fields: [] },
  ],
  realtime: [
    {
      id: 'supabase',
      label: 'Supabase Realtime',
      fields: [
        { key: 'url', label: 'Supabase-osoite' },
        { key: 'anonKey', label: 'Julkinen anon-avain' },
      ],
    },
    { id: 'polling', label: 'Kysely (polling)', fields: [{ key: 'intervalMs', label: 'Väli (ms)' }] },
  ],
  backup: [
    { id: 'local', label: 'Paikallinen levy', fields: [{ key: 'dir', label: 'Hakemisto' }] },
    {
      id: 's3',
      label: 'S3-yhteensopiva (eri tarjoaja kuin tuotanto)',
      fields: [
        { key: 'endpoint', label: 'Osoite' },
        { key: 'region', label: 'Alue' },
        { key: 'bucket', label: 'Bucket' },
        { key: 'accessKeyId', label: 'Access key ID', secret: true },
        { key: 'secretAccessKey', label: 'Secret access key', secret: true },
      ],
    },
  ],
};

interface Override {
  provider: string;
  config: Record<string, string>;
}

export interface ServiceDescription {
  type: ServiceType;
  label: string;
  provider: string;
  providerLabel: string;
  switchable: boolean;
  options: ProviderOption[];
  config: Record<string, string>;
  secretsSet: string[];
  status: 'ok' | 'error' | 'unknown' | 'disabled';
  message: string | null;
  lastOkAt: string | null;
  lastCheckedAt: string | null;
  usedBy: { id: string; name: string }[];
  note?: string;
}

export interface ServiceRegistryDeps {
  db: Db;
  config: AppConfig;
  settings: SettingsStore;
  log: Logger;
  manifests: ModuleManifest[];
  /** Used by the inline jobs runner. */
  runJobInline?: (jobId: string) => void;
  fetch?: typeof fetch;
  /** Test hook: force memory storage/backup. */
  forceMemory?: boolean;
}

/**
 * Central registry of switchable services. Modules ask for services.storage,
 * services.mail, … and never use a provider library directly. The active
 * provider comes from admin settings (core.settings scope "services") and
 * falls back to environment variables.
 */
export class ServiceRegistry {
  storage!: StorageAdapter;
  mail!: MailAdapter;
  jobs!: JobsRunnerAdapter;
  realtime!: RealtimeAdapter;
  backup!: StorageAdapter;
  private overrides: Partial<Record<SwitchableService, Override>> = {};

  private constructor(private readonly deps: ServiceRegistryDeps) {}

  static async create(deps: ServiceRegistryDeps): Promise<ServiceRegistry> {
    const r = new ServiceRegistry(deps);
    await r.reload();
    return r;
  }

  async reload(): Promise<void> {
    // Before the first migration the settings table does not exist yet.
    const all = await this.deps.settings.getAll(SERVICES_SCOPE).catch(() => ({}));
    this.overrides = all as Partial<Record<SwitchableService, Override>>;
    this.storage = await this.build('storage');
    this.backup = await this.build('backup');
    this.mail = await this.buildMail();
    this.jobs = await this.buildJobs();
    this.realtime = await this.buildRealtime();
  }

  private async secret(
    type: SwitchableService,
    key: string,
    envFallback?: string,
  ): Promise<string | undefined> {
    try {
      return (await this.deps.settings.getSecret(SERVICES_SCOPE, `${type}.${key}`)) ?? envFallback;
    } catch {
      return envFallback;
    }
  }

  private current(type: SwitchableService, envProvider: string): Override {
    const o = this.overrides[type];
    return o ? { provider: o.provider, config: o.config ?? {} } : { provider: envProvider, config: {} };
  }

  private async build(type: 'storage' | 'backup'): Promise<StorageAdapter> {
    const c = this.deps.config;
    if (this.deps.forceMemory) return memoryStorage();
    const isBackup = type === 'backup';
    const { provider, config } = this.current(type, isBackup ? c.BACKUP_TARGET : c.STORAGE_PROVIDER);
    const signingKey = c.SETTINGS_ENCRYPTION_KEY ?? c.AUTH_JWT_SECRET ?? 'dev-signing-key';
    switch (provider) {
      case 'memory':
        return memoryStorage();
      case 'local':
        return diskStorage({
          dir: config.dir ?? (isBackup ? c.BACKUP_LOCAL_DIR : c.STORAGE_LOCAL_DIR),
          signingKey,
          publicApiUrl: c.API_PUBLIC_URL,
        });
      case 'supabase': {
        const url = config.url ?? c.SUPABASE_URL;
        const key = await this.secret(type, 'serviceKey', c.SUPABASE_SERVICE_ROLE_KEY);
        if (!url || !key)
          throw new ValidationError('Supabase Storage vaatii SUPABASE_URL- ja service role -avaimen');
        return supabaseStorage({
          url,
          serviceKey: key,
          bucket: config.bucket ?? c.STORAGE_BUCKET,
          fetch: this.deps.fetch,
        });
      }
      case 's3': {
        const endpoint = config.endpoint ?? (isBackup ? c.BACKUP_S3_ENDPOINT : c.S3_ENDPOINT);
        const bucket = config.bucket ?? (isBackup ? c.BACKUP_S3_BUCKET : c.S3_BUCKET);
        const accessKeyId = await this.secret(
          type,
          'accessKeyId',
          isBackup ? c.BACKUP_S3_ACCESS_KEY_ID : c.S3_ACCESS_KEY_ID,
        );
        const secretAccessKey = await this.secret(
          type,
          'secretAccessKey',
          isBackup ? c.BACKUP_S3_SECRET_ACCESS_KEY : c.S3_SECRET_ACCESS_KEY,
        );
        if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
          throw new ValidationError('S3-tallennus vaatii osoitteen, bucketin ja avaimet');
        }
        return s3Storage({
          endpoint,
          bucket,
          accessKeyId,
          secretAccessKey,
          region: config.region ?? (isBackup ? c.BACKUP_S3_REGION : c.S3_REGION),
        });
      }
      default:
        throw new ValidationError(`Tuntematon tallennuspalvelu ${provider}`);
    }
  }

  private async buildMail(): Promise<MailAdapter> {
    const c = this.deps.config;
    const { provider, config } = this.current('mail', c.MAIL_PROVIDER);
    if (provider === 'resend') {
      const apiKey = await this.secret('mail', 'apiKey', c.RESEND_API_KEY);
      if (!apiKey) throw new ValidationError('Resend vaatii API-avaimen');
      return resendMail({ apiKey, from: config.from ?? c.MAIL_FROM, fetch: this.deps.fetch });
    }
    if (provider === 'supabase-auth') return supabaseAuthMail(this.deps.log);
    return consoleMail(this.deps.log);
  }

  private async buildJobs(): Promise<JobsRunnerAdapter> {
    const c = this.deps.config;
    const { provider, config } = this.current('jobs', c.JOBS_RUNNER);
    if (provider === 'github-actions') {
      const token = await this.secret('jobs', 'token', c.GITHUB_DISPATCH_TOKEN);
      const repository = config.repository ?? c.GITHUB_REPOSITORY;
      if (!token || !repository) throw new ValidationError('GitHub Actions vaatii repositorion ja tokenin');
      return githubActionsRunner({
        repository,
        token,
        workflowFile: config.workflowFile ?? c.GITHUB_WORKFLOW_FILE,
        ref: config.ref ?? c.GITHUB_REF,
        fetch: this.deps.fetch,
      });
    }
    if (provider === 'inline' && this.deps.runJobInline) return inlineRunner(this.deps.runJobInline);
    return queueRunner();
  }

  private async buildRealtime(): Promise<RealtimeAdapter> {
    const c = this.deps.config;
    const { provider, config } = this.current('realtime', c.REALTIME_PROVIDER);
    if (provider === 'supabase') {
      const url = config.url ?? c.SUPABASE_URL;
      const anonKey = config.anonKey ?? c.SUPABASE_ANON_KEY;
      if (url && anonKey) return supabaseRealtime({ url, anonKey, fetch: this.deps.fetch });
    }
    return pollingRealtime(Number(config.intervalMs ?? 3000));
  }

  /** Safe build: a misconfigured service must not stop the whole app. */
  static async createSafe(deps: ServiceRegistryDeps): Promise<ServiceRegistry> {
    try {
      return await ServiceRegistry.create(deps);
    } catch (err) {
      deps.log.error('service configuration invalid, falling back to defaults', { error: errorMessage(err) });
      const r = new ServiceRegistry({ ...deps });
      r.overrides = {};
      r.storage = memoryStorage();
      r.backup = memoryStorage();
      r.mail = consoleMail(deps.log);
      r.jobs = queueRunner();
      r.realtime = pollingRealtime();
      return r;
    }
  }

  async test(type: ServiceType): Promise<TestResult> {
    let result: TestResult;
    try {
      switch (type) {
        case 'storage':
          result = await this.storage.test();
          break;
        case 'backup':
          result = await this.backup.test();
          break;
        case 'mail':
          result = await this.mail.test();
          break;
        case 'jobs':
          result = await this.jobs.test();
          break;
        case 'realtime':
          result = await this.realtime.test();
          break;
        case 'database': {
          await this.deps.db`select 1`;
          result = { ok: true, message: 'Tietokanta vastaa' };
          break;
        }
        default:
          result = { ok: true, message: 'Tila tarkistetaan omalta asetussivultaan' };
      }
    } catch (err) {
      result = { ok: false, message: errorMessage(err) };
    }
    await this.deps.db`
      insert into core.service_status (service, provider, status, message, last_ok_at, last_checked_at)
      values (${type}, ${this.providerOf(type)}, ${result.ok ? 'ok' : 'error'}, ${result.message},
              ${result.ok ? new Date() : null}, now())
      on conflict (service) do update set provider = excluded.provider, status = excluded.status,
        message = excluded.message, last_checked_at = now(),
        last_ok_at = coalesce(excluded.last_ok_at, core.service_status.last_ok_at)`;
    return result;
  }

  providerOf(type: ServiceType): string {
    const c = this.deps.config;
    switch (type) {
      case 'storage':
        return this.storage.provider;
      case 'backup':
        return this.backup.provider;
      case 'mail':
        return this.mail.provider;
      case 'jobs':
        return this.jobs.provider;
      case 'realtime':
        return this.realtime.provider;
      case 'database':
        return /supabase\.(co|com)/.test(c.DATABASE_URL) ? 'supabase-postgres' : 'postgresql';
      case 'auth':
        return c.AUTH_PROVIDER;
      default:
        return '';
    }
  }

  /** Saves a new provider choice (and encrypted secrets) and rebuilds adapters. */
  async configure(
    type: SwitchableService,
    provider: string,
    config: Record<string, string>,
    secrets: Record<string, string>,
    userId: string | null,
  ): Promise<void> {
    const option = PROVIDER_OPTIONS[type].find((o) => o.id === provider);
    if (!option) throw new ValidationError(`Tuntematon palveluntarjoaja ${provider}`);
    const publicConfig: Record<string, string> = {};
    for (const f of option.fields) {
      if (f.secret) {
        const v = secrets[f.key];
        if (v) await this.deps.settings.setSecret(SERVICES_SCOPE, `${type}.${f.key}`, v, userId);
      } else if (config[f.key] !== undefined && config[f.key] !== '') publicConfig[f.key] = config[f.key]!;
    }
    const previous = this.overrides;
    await this.deps.settings.set(SERVICES_SCOPE, type, { provider, config: publicConfig }, userId);
    try {
      await this.reload();
    } catch (err) {
      // Roll back to the previous working configuration.
      if (previous[type]) await this.deps.settings.set(SERVICES_SCOPE, type, previous[type], userId);
      else await this.deps.settings.delete(SERVICES_SCOPE, type);
      await this.reload();
      throw new ValidationError(`Asetuksia ei otettu käyttöön: ${errorMessage(err)}`);
    }
  }

  async describe(
    extra: Partial<Record<ServiceType, { provider: string; note?: string }>> = {},
  ): Promise<ServiceDescription[]> {
    const statusRows = await this.deps.db<
      {
        service: string;
        status: ServiceDescription['status'];
        message: string | null;
        lastOkAt: Date | null;
        lastCheckedAt: Date | null;
      }[]
    >`select service, status, message, last_ok_at, last_checked_at from core.service_status`;
    const status = new Map(statusRows.map((s) => [s.service, s]));
    const types: ServiceType[] = [
      'database',
      'auth',
      'storage',
      'mail',
      'realtime',
      'jobs',
      'ai',
      'embeddings',
      'backup',
      'hosting',
      'api-runtime',
    ];
    const out: ServiceDescription[] = [];
    for (const type of types) {
      const switchable = type in PROVIDER_OPTIONS;
      const options = switchable ? PROVIDER_OPTIONS[type as SwitchableService] : [];
      const provider = extra[type]?.provider ?? this.providerOf(type);
      const s = status.get(type);
      const o = switchable ? this.overrides[type as SwitchableService] : undefined;
      const secretKeys = switchable
        ? (await this.deps.settings.secretKeys(SERVICES_SCOPE).catch(() => []))
            .filter((k) => k.startsWith(`${type}.`))
            .map((k) => k.slice(type.length + 1))
        : [];
      out.push({
        type,
        label: SERVICE_LABELS[type],
        provider,
        providerLabel: options.find((x) => x.id === provider)?.label ?? provider,
        switchable,
        options,
        config: o?.config ?? {},
        secretsSet: secretKeys,
        status: s?.status ?? 'unknown',
        message: s?.message ?? null,
        lastOkAt: s?.lastOkAt ? new Date(s.lastOkAt).toISOString() : null,
        lastCheckedAt: s?.lastCheckedAt ? new Date(s.lastCheckedAt).toISOString() : null,
        usedBy: this.deps.manifests
          .filter((m) => m.services.includes(type))
          .map((m) => ({ id: m.id, name: m.name })),
        note: extra[type]?.note,
      });
    }
    return out;
  }
}
