import { cors } from 'hono/cors';
import type { AuthAdapter, CurrentUser, Runtime } from '@ps/core';
import {
  AppError,
  createRouter,
  devAuth,
  ensureUser,
  errorMessage,
  isEmailAllowed,
  loadUser,
  oidcAuth,
  supabaseAuth,
} from '@ps/core';
import { registerCoreRoutes } from './routes/core.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerBackupRoutes } from './routes/backups.ts';
import { registerAiRoutes } from './routes/ai.ts';

export const API_VERSION = '0.1.0';

export function createAuthAdapter(rt: Runtime): AuthAdapter {
  const c = rt.config;
  if (c.AUTH_PROVIDER === 'supabase') {
    if (!c.SUPABASE_URL) throw new Error('AUTH_PROVIDER=supabase vaatii SUPABASE_URL-asetuksen');
    return supabaseAuth({
      url: c.SUPABASE_URL,
      anonKey: c.SUPABASE_ANON_KEY,
      jwtSecret: c.SUPABASE_JWT_SECRET,
    });
  }
  if (c.AUTH_PROVIDER === 'oidc') {
    if (!c.OIDC_ISSUER) throw new Error('AUTH_PROVIDER=oidc vaatii OIDC_ISSUER-asetuksen');
    return oidcAuth({
      issuer: c.OIDC_ISSUER,
      jwksUrl: c.OIDC_JWKS_URL,
      audience: c.OIDC_AUDIENCE,
      clientId: c.OIDC_CLIENT_ID,
    });
  }
  if (!c.AUTH_JWT_SECRET || c.AUTH_JWT_SECRET.length < 32) {
    throw new Error('AUTH_PROVIDER=dev vaatii vähintään 32 merkin AUTH_JWT_SECRET-asetuksen');
  }
  return devAuth({ secret: c.AUTH_JWT_SECRET });
}

/**
 * Builds the platform-independent API. The same app object is served by
 * Supabase Edge Functions (Deno), Node.js, Bun and Docker.
 */
export function createApp(rt: Runtime, opts: { auth?: AuthAdapter } = {}) {
  const auth = opts.auth ?? createAuthAdapter(rt);
  const app = createRouter();
  const userCache = new Map<string, { user: CurrentUser | null; at: number }>();

  const allowedOrigins = new Set(
    [...rt.config.CORS_ORIGINS, rt.config.APP_BASE_URL].map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return u;
      }
    }),
  );
  app.use(
    '*',
    cors({
      origin: (origin) => (allowedOrigins.has(origin) || allowedOrigins.has('*') ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type', 'X-Client-Info', 'apikey'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Content-Disposition'],
      maxAge: 600,
    }),
  );

  // Authentication: every request resolves the user (or null). Authorisation
  // happens in each route via requirePermission() and again in the database (RLS).
  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.set('user', null);
    c.set('actor', { kind: 'anon' });
    const header = c.req.header('Authorization');
    if (header?.startsWith('Bearer ')) {
      const identity = await auth.verify(header.slice(7));
      if (identity) {
        const cached = userCache.get(identity.sub);
        let user: CurrentUser | null;
        if (cached && Date.now() - cached.at < 15_000) user = cached.user;
        else {
          const allowed = await isEmailAllowed(rt.sql, identity.email, rt.config.ALLOWED_EMAILS);
          user = allowed
            ? ((await loadUser(rt.sql, identity.sub)) ??
              (await ensureUser(rt.sql, identity, rt.config.ALLOWED_EMAILS)))
            : null;
          userCache.set(identity.sub, { user, at: Date.now() });
        }
        if (user) {
          c.set('user', user);
          c.set('actor', { kind: 'user', userId: user.id, email: user.email });
        }
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status as 400,
      );
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '42501') {
      return c.json(
        { error: { code: 'forbidden', message: 'Tietokanta esti toiminnon (ei oikeutta)' } },
        403,
      );
    }
    if (pgCode === '23505') {
      return c.json({ error: { code: 'conflict', message: 'Samalla tunnisteella on jo tietue' } }, 409);
    }
    if (pgCode === '23503' || pgCode === '23514' || pgCode === '22P02') {
      return c.json({ error: { code: 'validation_error', message: errorMessage(err) } }, 400);
    }
    rt.log.error('unhandled error', {
      error: errorMessage(err),
      stack: (err as Error).stack,
      path: c.req.path,
    });
    return c.json({ error: { code: 'internal_error', message: 'Palvelinvirhe' } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Polkua ei löytynyt' } }, 404));

  const v1 = createRouter();
  registerCoreRoutes(v1, rt, auth, { invalidateUser: (id) => userCache.delete(id) });
  registerAdminRoutes(v1, rt);
  registerAiRoutes(v1, rt);
  registerBackupRoutes(v1, rt);
  for (const m of rt.registry.list()) {
    if (!m.registerRoutes) continue;
    const router = createRouter();
    m.registerRoutes(router, rt);
    v1.route(m.manifest.apiBasePath, router);
  }

  v1.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Poliitikkoseuranta API',
      version: API_VERSION,
      description:
        'Versioitu REST-rajapinta kaikille asiakkaille (web, tulevat työpöytä- ja mobiilisovellukset). ' +
        'Tunnistautuminen: Authorization: Bearer <JWT> (Supabase Auth / OIDC). ' +
        'Listat tukevat updated_since-parametria ja pehmeitä poistoja synkronointia varten.',
    },
    servers: [{ url: `${rt.config.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1` }],
  });
  v1.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  app.route('/api/v1', v1);
  return app;
}

export type App = ReturnType<typeof createApp>;
