import { describe, expect, it } from 'vitest';
import { AiService, silentLogger, type ProviderConfig } from '../src/index.ts';
import { createAnthropicProvider } from '../src/ai/providers/anthropic.ts';
import { createOpenAiProvider } from '../src/ai/providers/openai.ts';

/** Fake Anthropic Messages API (server-sent events). */
function anthropicFetch(captured: { body?: Record<string, unknown>; headers?: Headers }): typeof fetch {
  return async (input, init) => {
    captured.body = JSON.parse(String(init?.body));
    captured.headers = new Headers(init?.headers);
    const events = [
      [
        'message_start',
        {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 12, output_tokens: 0 },
          },
        },
      ],
      [
        'content_block_start',
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      ],
      [
        'content_block_delta',
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hei [#a1]' } },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      [
        'message_delta',
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 5 },
        },
      ],
      ['message_stop', { type: 'message_stop' }],
    ];
    const sse = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
    void input;
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

describe('AI provider adapters (fake servers, no API keys)', () => {
  it('Anthropic adapter streams a completion and enables server-side refusal fallback', async () => {
    const captured: { body?: Record<string, unknown>; headers?: Headers } = {};
    const cfg: ProviderConfig = { name: 'anthropic', kind: 'anthropic', defaultModel: 'claude-opus-5-5' };
    const p = createAnthropicProvider(cfg, 'test-key', anthropicFetch(captured));
    const r = await p.complete({
      model: 'claude-opus-5-5',
      system: 'S',
      messages: [{ role: 'user', content: 'Moi' }],
    });
    expect(r).toMatchObject({
      text: 'Hei [#a1]',
      inputTokens: 12,
      outputTokens: 5,
      provider: 'anthropic',
      stopReason: 'end_turn',
    });
    expect(captured.body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'S',
      stream: true,
      fallbacks: 'default',
    });
    expect(captured.headers?.get('x-api-key')).toBe('test-key');
    expect(captured.headers?.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(p.modelInfo('claude-opus-5-5').contextTokens).toBe(1_000_000);
  });

  it('OpenAI-compatible adapter (e.g. Ollama) completes and embeds', async () => {
    const calls: string[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      const body = JSON.parse(String(init?.body));
      if (url.endsWith('/embeddings')) {
        return Response.json({
          model: body.model,
          data: body.input.map((_: string, i: number) => ({ index: i, embedding: [i, 1, 0] })),
          usage: { prompt_tokens: 3 },
        });
      }
      expect(body.max_tokens).toBeDefined();
      return Response.json({
        model: body.model,
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      });
    };
    const cfg: ProviderConfig = {
      name: 'local',
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: 'llama3.1',
      internal: true,
    };
    const p = createOpenAiProvider(cfg, null, fake);
    expect(p.internal).toBe(true);
    expect((await p.complete({ model: 'llama3.1', messages: [{ role: 'user', content: 'x' }] })).text).toBe(
      'ok',
    );
    const e = await p.embed!(['a', 'b'], 'nomic-embed-text');
    expect(e.dims).toBe(3);
    expect(calls).toEqual([
      'http://localhost:11434/v1/chat/completions',
      'http://localhost:11434/v1/embeddings',
    ]);
  });

  it('OpenAI adapter sends bearer key and max_completion_tokens', async () => {
    let auth = '';
    let body: Record<string, unknown> = {};
    const fake: typeof fetch = async (_input, init) => {
      auth = new Headers(init?.headers).get('authorization') ?? '';
      body = JSON.parse(String(init?.body));
      return Response.json({
        model: 'gpt-5',
        choices: [{ message: { content: 'hei' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      });
    };
    const p = createOpenAiProvider(
      { name: 'openai', kind: 'openai', defaultModel: 'gpt-5' },
      'sk-test',
      fake,
    );
    expect((await p.test('gpt-5')).ok).toBe(true);
    expect(auth).toBe('Bearer sk-test');
    expect(body.max_completion_tokens).toBe(32);
  });

  it('privacy rule blocks non-public data for external providers and fallback is used on failure', async () => {
    const db = Object.assign(async () => [], { json: (v: unknown) => v }) as never;
    const settings = {
      providers: [
        { name: 'cloud', kind: 'mock' as const, defaultModel: 'm' },
        { name: 'inhouse', kind: 'mock' as const, defaultModel: 'm2', internal: true },
      ],
      tasks: { default: { provider: 'cloud', model: 'm' } },
      fallbackProvider: 'inhouse',
      embedding: null,
      nonPublicOnlyInternal: true,
      cacheEnabled: false,
    };
    const ai = new AiService({
      db,
      settings,
      apiKey: async () => null,
      log: silentLogger,
      providerFactory: (cfg) => ({
        name: cfg.name,
        kind: 'mock',
        internal: Boolean(cfg.internal),
        complete: async (req) => {
          if (cfg.name === 'cloud') throw new Error('palvelu alhaalla');
          return {
            text: 'ok',
            model: req.model,
            provider: cfg.name,
            inputTokens: 1,
            outputTokens: 1,
            stopReason: 'end_turn',
          };
        },
        modelInfo: (m) => ({
          id: m,
          contextTokens: 8000,
          maxOutputTokens: 1000,
          supportsJson: true,
          supportsEmbeddings: false,
        }),
        listModels: () => [cfg.defaultModel],
        test: async () => ({ ok: true, message: 'ok', latencyMs: 0 }),
      }),
    });
    await expect(
      ai.complete({ messages: [{ role: 'user', content: 'x' }], visibility: 'private' }),
    ).rejects.toThrow(/Tietosuoja/);
    const r = await ai.complete({ messages: [{ role: 'user', content: 'x' }], visibility: 'public' });
    expect(r.provider).toBe('inhouse');
  });
});
