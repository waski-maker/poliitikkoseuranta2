import { z } from 'zod';

/**
 * All runtime configuration comes from environment variables (documented in
 * .env.example). Nothing platform-specific is hard-coded: the same build runs
 * on Supabase Edge Functions, Node.js, Bun and Docker.
 */
const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
    );

export const configSchema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL puuttuu'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),

  APP_BASE_URL: z.string().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().default('http://localhost:8787'),
  CORS_ORIGINS: csv,

  AUTH_PROVIDER: z.enum(['supabase', 'oidc', 'dev']).default('dev'),
  ALLOWED_EMAILS: csv,
  AUTH_JWT_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  OIDC_ISSUER: z.string().optional(),
  OIDC_JWKS_URL: z.string().optional(),
  OIDC_AUDIENCE: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),

  SETTINGS_ENCRYPTION_KEY: z.string().optional(),

  STORAGE_PROVIDER: z.enum(['supabase', 'local', 's3', 'memory']).default('local'),
  STORAGE_BUCKET: z.string().default('poliitikkoseuranta'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  MAIL_PROVIDER: z.enum(['supabase-auth', 'resend', 'console']).default('console'),
  MAIL_FROM: z.string().default('Poliitikkoseuranta <noreply@example.invalid>'),
  RESEND_API_KEY: z.string().optional(),

  JOBS_RUNNER: z.enum(['github-actions', 'inline', 'queue']).default('inline'),
  GITHUB_REPOSITORY: z.string().optional(),
  GITHUB_DISPATCH_TOKEN: z.string().optional(),
  GITHUB_WORKFLOW_FILE: z.string().default('jobs.yml'),
  GITHUB_REF: z.string().default('main'),

  REALTIME_PROVIDER: z.enum(['supabase', 'polling']).default('polling'),

  AI_PROVIDER: z.enum(['anthropic', 'openai', 'openai-compatible', 'mock']).optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['openai', 'openai-compatible', 'mock']).optional(),
  EMBEDDING_MODEL: z.string().optional(),

  BACKUP_TARGET: z.enum(['s3', 'local', 'memory']).default('local'),
  BACKUP_LOCAL_DIR: z.string().default('./backups'),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_REGION: z.string().default('auto'),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_VERIFY_DATABASE_URL: z.string().optional(),
  BACKUP_BEFORE_MIGRATE: bool(true),

  EDUSKUNTA_API_URL: z.string().default('https://api.eduskunta.fi/api/v1/'),
  EDUSKUNTA_USER_AGENT: z.string().default('Poliitikkoseuranta/2.0 (+https://github.com/)'),
  EDUSKUNTA_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(400),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Virheelliset asetukset: ${issues}`);
  }
  return parsed.data;
}

/** Reads the process environment in Node, Bun or Deno. */
export function readEnv(): Record<string, string | undefined> {
  const g = globalThis as unknown as {
    process?: { env: Record<string, string | undefined> };
    Deno?: { env: { toObject(): Record<string, string> } };
  };
  if (g.Deno?.env) return g.Deno.env.toObject();
  return g.process?.env ?? {};
}
