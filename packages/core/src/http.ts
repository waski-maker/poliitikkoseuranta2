import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { Actor } from './db/client.ts';
import type { CurrentUser } from './auth/users.ts';

export interface AppVariables {
  user: CurrentUser | null;
  actor: Actor;
  requestId: string;
}

export type AppEnv = { Variables: AppVariables };

/** Router type that modules use to register their REST endpoints. */
export type ModuleRouter = OpenAPIHono<AppEnv>;

export function createRouter(): ModuleRouter {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: 'validation_error',
              message: 'Virheellinen pyyntö',
              details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            },
          },
          400,
        );
      }
    },
  });
}

// Shared OpenAPI schemas ------------------------------------------------------

export const ErrorSchema = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  })
  .openapi('Error');

export const VisibilitySchema = z.enum(['public', 'internal', 'private']).openapi('Visibility');
export const SourceSchema = z.enum(['eduskunta', 'manual', 'seed', 'other']).openapi('DataSource');

/** Standard columns present on every module record. */
export const RecordMetaSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  visibility: VisibilitySchema,
  source: SourceSchema,
  sourceUrl: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  manualFields: z.array(z.string()),
});

/** Query parameters every list endpoint supports (offline sync for future apps). */
export const ListQuerySchema = z.object({
  updated_since: z.string().datetime({ offset: true }).optional().openapi({
    description: 'Palauta vain tämän jälkeen muuttuneet (myös poistetut) rivit',
  }),
  include_deleted: z
    .enum(['true', 'false'])
    .optional()
    .openapi({ description: 'Sisällytä pehmeästi poistetut' }),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const errorResponses = {
  400: { description: 'Virheellinen pyyntö', content: { 'application/json': { schema: ErrorSchema } } },
  401: { description: 'Kirjautuminen vaaditaan', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: 'Ei oikeutta', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'Ei löytynyt', content: { 'application/json': { schema: ErrorSchema } } },
} as const;

export function jsonContent<T extends z.ZodTypeAny>(schema: T, description: string) {
  return { description, content: { 'application/json': { schema } } };
}

/** Converts DB rows (Dates) to JSON-safe objects matching the OpenAPI schemas. */
export function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * JSON-safe copy of DB rows for responses. Typed as `any` on purpose: rows are
 * validated against the route's OpenAPI schema by tests, not by the compiler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function json(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}
