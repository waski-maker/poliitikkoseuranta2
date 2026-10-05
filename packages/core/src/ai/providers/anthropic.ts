import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
  ConnectionTest,
  ModelInfo,
  ProviderConfig,
} from '../types.ts';

// Models that accept the server-side refusal fallback ("fallbacks: default").
const SERVER_FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

const MODELS: Record<string, { context: number; output: number }> = {
  'claude-opus-5-5': { context: 1_000_000, output: 128_000 },
  'claude-sonnet-5-5': { context: 1_000_000, output: 128_000 },
  'claude-haiku-4-5': { context: 200_000, output: 64_000 },
  'claude-fable-5-1': { context: 1_000_000, output: 128_000 },
};

/** Anthropic Claude via the official SDK (runs on Node, Deno and Bun). */
export function createAnthropicProvider(
  cfg: ProviderConfig,
  apiKey: string,
  fetchImpl?: typeof fetch,
): AiProvider {
  const client = new Anthropic({
    apiKey,
    ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    maxRetries: 2,
  });

  const info = (model: string): ModelInfo => {
    const m = MODELS[model];
    return {
      id: model,
      contextTokens: cfg.contextTokens ?? m?.context ?? 200_000,
      maxOutputTokens: cfg.maxOutputTokens ?? m?.output ?? 32_000,
      supportsJson: true,
      supportsEmbeddings: false,
    };
  };

  const complete = async (req: CompletionRequest): Promise<CompletionResult> => {
    const maxTokens = Math.min(req.maxTokens ?? 16_000, info(req.model).maxOutputTokens);
    const system = req.json
      ? `${req.system ?? ''}\n\nVastaa pelkällä JSON-objektilla ilman muuta tekstiä.`.trim()
      : req.system;
    // Streaming avoids HTTP timeouts on long outputs; finalMessage() collects the result.
    // If the model declines on policy grounds, the API re-runs the request on a
    // fallback model inside the same call (server-side fallback, "default" routing).
    const useFallback = SERVER_FALLBACK_MODELS.has(req.model) && !cfg.baseUrl;
    const stream = client.beta.messages.stream({
      model: req.model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      throw new Error('Tekoälypalvelu kieltäytyi vastaamasta (refusal)');
    }
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      model: msg.model,
      provider: cfg.name,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      stopReason: msg.stop_reason,
    };
  };

  return {
    name: cfg.name,
    kind: 'anthropic',
    internal: cfg.internal ?? false,
    complete,
    modelInfo: info,
    listModels: () => Object.keys(MODELS),
    async test(model: string): Promise<ConnectionTest> {
      const t0 = Date.now();
      try {
        const r = await complete({
          model,
          maxTokens: 64,
          messages: [{ role: 'user', content: 'Vastaa sanalla: ok' }],
        });
        return {
          ok: true,
          message: `Yhteys toimii (${r.model})`,
          latencyMs: Date.now() - t0,
          model: r.model,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - t0,
        };
      }
    },
  };
}
