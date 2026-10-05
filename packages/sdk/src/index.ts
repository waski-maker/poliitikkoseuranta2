/**
 * Typed client for the Poliitikkoseuranta REST API (/api/v1), generated from
 * the OpenAPI document (`pnpm sdk:generate`). Used by the web UI and usable
 * as-is by future desktop/mobile apps (React Native, Tauri, …).
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { paths, components };
export type Schemas = components['schemas'];

export interface SdkOptions {
  /** API origin, e.g. https://xyz.supabase.co/functions/v1 or http://localhost:8787 */
  baseUrl: string;
  /** Returns the current access token (JWT) or null. */
  getToken?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
  /** Called on 401 responses (e.g. to redirect to the sign-in page). */
  onUnauthorized?: () => void;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function createApiClient(opts: SdkOptions) {
  const client = createClient<paths>({
    baseUrl: `${opts.baseUrl.replace(/\/$/, '')}/api/v1`,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await opts.getToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401) opts.onUnauthorized?.();
      return response;
    },
  };
  client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Unwraps an openapi-fetch result: returns data or throws ApiError with the API's (Finnish) message. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (error !== undefined || !response.ok) {
    const e = (error as { error?: { code?: string; message?: string; details?: unknown } } | undefined)
      ?.error;
    throw new ApiError(
      response.status,
      e?.code ?? 'error',
      e?.message ?? `HTTP ${response.status}`,
      e?.details,
    );
  }
  return data as T;
}
