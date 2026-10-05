import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface VerifiedIdentity {
  sub: string;
  email: string;
  claims: JWTPayload;
}

/** Verifies bearer tokens. One adapter per identity provider; switched with AUTH_PROVIDER. */
export interface AuthAdapter {
  provider: string;
  verify(token: string): Promise<VerifiedIdentity | null>;
  /** Public client settings for the browser (never secrets). */
  clientConfig(): Record<string, unknown>;
}

const enc = new TextEncoder();

function identity(payload: JWTPayload): VerifiedIdentity | null {
  const email = (payload.email as string | undefined)?.toLowerCase();
  if (!payload.sub || !email) return null;
  return { sub: payload.sub, email, claims: payload };
}

/**
 * Supabase Auth (magic link). Verifies HS256 tokens with the project's JWT
 * secret, or asymmetric tokens via the project's JWKS endpoint.
 */
export function supabaseAuth(opts: { url: string; anonKey?: string; jwtSecret?: string }): AuthAdapter {
  const jwks = createRemoteJWKSet(new URL(`${opts.url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`));
  return {
    provider: 'supabase',
    async verify(token) {
      try {
        const header = JSON.parse(atob(token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
          alg?: string;
        };
        const { payload } =
          header.alg === 'HS256' && opts.jwtSecret
            ? await jwtVerify(token, enc.encode(opts.jwtSecret), { audience: 'authenticated' })
            : await jwtVerify(token, jwks, { audience: 'authenticated' });
        return identity(payload);
      } catch {
        return null;
      }
    },
    clientConfig: () => ({ provider: 'supabase', url: opts.url, anonKey: opts.anonKey }),
  };
}

/** Any OpenID Connect provider (Keycloak, Entra ID, Google, Auth.js, …) with PKCE in the client. */
export function oidcAuth(opts: {
  issuer: string;
  jwksUrl?: string;
  audience?: string;
  clientId?: string;
}): AuthAdapter {
  const jwks = createRemoteJWKSet(
    new URL(opts.jwksUrl ?? `${opts.issuer.replace(/\/$/, '')}/.well-known/jwks.json`),
  );
  return {
    provider: 'oidc',
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: opts.issuer,
          ...(opts.audience ? { audience: opts.audience } : {}),
        });
        return identity(payload);
      } catch {
        return null;
      }
    },
    clientConfig: () => ({ provider: 'oidc', issuer: opts.issuer, clientId: opts.clientId }),
  };
}

/**
 * Local development and self-hosted fallback: the API issues HS256 tokens
 * itself after checking the allow-list (see /api/v1/auth/dev-login).
 * Never enable on a public deployment without an allow-list.
 */
export function devAuth(opts: { secret: string }): AuthAdapter & {
  issue(sub: string, email: string, ttlSec?: number): Promise<string>;
} {
  const key = enc.encode(opts.secret);
  return {
    provider: 'dev',
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: 'poliitikkoseuranta-dev',
          audience: 'authenticated',
        });
        return identity(payload);
      } catch {
        return null;
      }
    },
    async issue(sub, email, ttlSec = 60 * 60 * 12) {
      return new SignJWT({ email, role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setIssuer('poliitikkoseuranta-dev')
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime(`${ttlSec}s`)
        .sign(key);
    },
    clientConfig: () => ({ provider: 'dev' }),
  };
}

/** Deterministic UUID (v5-style, SHA-1 based) for dev logins: same email → same user id. */
export async function uuidFromEmail(email: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-1', enc.encode(`poliitikkoseuranta:${email.toLowerCase()}`)),
  );
  const b = digest.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
