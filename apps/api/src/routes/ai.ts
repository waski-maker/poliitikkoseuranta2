import { createRoute, z } from '@hono/zod-openapi';
import type { AiSettings, ModuleRouter, Runtime } from '@ps/core';
import {
  AI_SETTINGS_KEY,
  AI_SETTINGS_SCOPE,
  DEFAULT_PRICES,
  ValidationError,
  aiUsageSummary,
  errorResponses,
  json,
  jsonContent,
  requirePermission,
} from '@ps/core';

const ProviderSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(['anthropic', 'openai', 'openai-compatible', 'mock']),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().min(1),
  internal: z.boolean().optional(),
  contextTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

const RouteSchema = z.object({
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const AiSettingsSchema = z
  .object({
    providers: z.array(ProviderSchema),
    tasks: z.object({
      default: RouteSchema,
      analysis: RouteSchema.optional(),
      classification: RouteSchema.optional(),
      summary: RouteSchema.optional(),
      chat: RouteSchema.optional(),
    }),
    fallbackProvider: z.string().nullable().optional(),
    embedding: z.object({ provider: z.string(), model: z.string() }).nullable(),
    nonPublicOnlyInternal: z.boolean(),
    cacheEnabled: z.boolean(),
  })
  .openapi('AiSettings');

export function registerAiRoutes(r: ModuleRouter, rt: Runtime): void {
  r.openapi(
    createRoute({
      method: 'get',
      path: '/ai/settings',
      tags: ['Tekoäly'],
      summary: 'Tekoälyasetukset (ilman avaimia)',
      responses: {
        200: jsonContent(
          z.object({
            settings: AiSettingsSchema,
            keysSet: z.array(z.string()).openapi({
              description: 'Palvelut, joille on tallennettu tai ympäristössä asetettu API-avain',
            }),
            knownModels: z.record(z.string(), z.array(z.string())),
            prices: z.record(z.string(), z.object({ input: z.number(), output: z.number() })),
          }),
          'Asetukset',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.ai');
      const settings = await rt.aiSettings();
      const stored = await rt.settings.secretKeys(AI_SETTINGS_SCOPE).catch(() => []);
      const keysSet = new Set(stored.map((k) => k.replace(/\.apiKey$/, '')));
      if (rt.config.ANTHROPIC_API_KEY) keysSet.add('anthropic');
      if (rt.config.OPENAI_API_KEY) keysSet.add('openai');
      if (rt.config.AI_API_KEY) keysSet.add('local');
      const ai = await rt.ai();
      const knownModels: Record<string, string[]> = {};
      for (const p of settings.providers) {
        try {
          knownModels[p.name] = (await ai.provider(p.name)).listModels();
        } catch {
          knownModels[p.name] = [p.defaultModel];
        }
      }
      return c.json(
        { settings: json(settings), keysSet: [...keysSet], knownModels, prices: DEFAULT_PRICES },
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: 'put',
      path: '/ai/settings',
      tags: ['Tekoäly'],
      summary: 'Tallenna tekoälyasetukset',
      request: { body: { content: { 'application/json': { schema: AiSettingsSchema } }, required: true } },
      responses: { 204: { description: 'Tallennettu' }, ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.ai');
      const s = c.req.valid('json') as AiSettings;
      const names = new Set(s.providers.map((p) => p.name));
      for (const [task, route] of Object.entries(s.tasks)) {
        if (route && !names.has(route.provider))
          throw new ValidationError(`Tehtävän ${task} palvelua ${route.provider} ei ole määritetty`);
      }
      if (s.fallbackProvider && !names.has(s.fallbackProvider))
        throw new ValidationError('Varapalvelua ei ole määritetty');
      if (s.embedding && !names.has(s.embedding.provider))
        throw new ValidationError('Upotepalvelua ei ole määritetty');
      const previous = await rt.aiSettings();
      await rt.settings.set(AI_SETTINGS_SCOPE, AI_SETTINGS_KEY, s, user.id);
      // Changing the embedding model triggers background re-embedding; the old
      // vectors keep serving semantic search until the new ones exist.
      if (
        s.embedding &&
        (s.embedding.model !== previous.embedding?.model ||
          s.embedding.provider !== previous.embedding?.provider)
      ) {
        await rt.startJob({ type: 'embeddings:reindex', payload: {}, user }).catch(() => null);
      }
      rt.invalidateAi();
      return c.body(null, 204);
    },
  );

  r.openapi(
    createRoute({
      method: 'put',
      path: '/ai/providers/{name}/key',
      tags: ['Tekoäly'],
      summary: 'Tallenna API-avain (salattuna)',
      description: 'Avainta ei palauteta koskaan käyttöliittymään. Tyhjä avain poistaa tallennetun avaimen.',
      request: {
        params: z.object({ name: z.string() }),
        body: {
          content: { 'application/json': { schema: z.object({ apiKey: z.string() }) } },
          required: true,
        },
      },
      responses: { 204: { description: 'Tallennettu' }, ...errorResponses },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.ai');
      const { name } = c.req.valid('param');
      const { apiKey } = c.req.valid('json');
      if (apiKey) await rt.settings.setSecret(AI_SETTINGS_SCOPE, `${name}.apiKey`, apiKey, user.id);
      else await rt.settings.deleteSecret(AI_SETTINGS_SCOPE, `${name}.apiKey`);
      rt.invalidateAi();
      return c.body(null, 204);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/ai/providers/{name}/test',
      tags: ['Tekoäly'],
      summary: 'Testaa yhteys tekoälypalveluun',
      request: {
        params: z.object({ name: z.string() }),
        body: {
          content: { 'application/json': { schema: z.object({ model: z.string().optional() }) } },
          required: false,
        },
      },
      responses: {
        200: jsonContent(
          z
            .object({
              ok: z.boolean(),
              message: z.string(),
              latencyMs: z.number(),
              model: z.string().optional(),
            })
            .openapi('ConnectionTest'),
          'Tulos',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.ai');
      const body = await c.req.json().catch(() => ({}));
      rt.invalidateAi();
      const ai = await rt.ai();
      return c.json(await ai.testProvider(c.req.valid('param').name, body?.model || undefined), 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'get',
      path: '/ai/usage',
      tags: ['Tekoäly'],
      summary: 'Tekoälyn käyttö palveluittain',
      request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).optional() }) },
      responses: {
        200: jsonContent(
          z.object({
            items: z.array(
              z.object({
                provider: z.string(),
                model: z.string(),
                calls: z.number(),
                failures: z.number(),
                cachedCalls: z.number(),
                inputTokens: z.number(),
                outputTokens: z.number(),
                costUsd: z.number(),
                avgDurationMs: z.number(),
              }),
            ),
          }),
          'Käyttö',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      requirePermission(c.get('user'), 'core.ai');
      return c.json({ items: await aiUsageSummary(rt.sql, c.req.valid('query').days ?? 30) }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: 'post',
      path: '/ai/complete',
      tags: ['Tekoäly'],
      summary: 'Vapaa tekoälykutsu (ylläpitäjän kokeilu)',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({
                prompt: z.string().min(1).max(20_000),
                task: z.enum(['default', 'analysis', 'classification', 'summary', 'chat']).optional(),
              }),
            },
          },
          required: true,
        },
      },
      responses: {
        200: jsonContent(
          z.object({
            text: z.string(),
            provider: z.string(),
            model: z.string(),
            inputTokens: z.number(),
            outputTokens: z.number(),
            cached: z.boolean(),
          }),
          'Vastaus',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requirePermission(c.get('user'), 'core.ai');
      const body = c.req.valid('json');
      const ai = await rt.ai();
      const r2 = await ai.complete({
        task: body.task,
        messages: [{ role: 'user', content: body.prompt }],
        userId: user.id,
        visibility: 'public',
      });
      return c.json(
        {
          text: r2.text,
          provider: r2.provider,
          model: r2.model,
          inputTokens: r2.inputTokens,
          outputTokens: r2.outputTokens,
          cached: r2.cached,
        },
        200,
      );
    },
  );
}
