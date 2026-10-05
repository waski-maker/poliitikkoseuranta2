import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
  ConnectionTest,
  EmbeddingResult,
  ModelInfo,
  ProviderConfig,
} from '../types.ts';

const OPENAI_MODELS: Record<string, { context: number; output: number; embedding?: boolean }> = {
  'gpt-5': { context: 400_000, output: 128_000 },
  'gpt-5-mini': { context: 400_000, output: 128_000 },
  'text-embedding-3-small': { context: 8_191, output: 0, embedding: true },
  'text-embedding-3-large': { context: 8_191, output: 0, embedding: true },
};

interface ChatResponse {
  model: string;
  choices: { message: { content: string | null }; finish_reason: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface EmbeddingResponse {
  model: string;
  data: { embedding: number[]; index: number }[];
  usage?: { prompt_tokens?: number };
}

/**
 * OpenAI and any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio,
 * OpenRouter, Azure-compatible gateways, …) via the standard
 * /chat/completions and /embeddings REST API.
 */
export function createOpenAiProvider(
  cfg: ProviderConfig,
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
): AiProvider {
  const base = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const isOfficial = cfg.kind === 'openai';

  const call = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${cfg.name}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  };

  const info = (model: string): ModelInfo => {
    const m = OPENAI_MODELS[model];
    return {
      id: model,
      contextTokens: cfg.contextTokens ?? m?.context ?? 32_000,
      maxOutputTokens: cfg.maxOutputTokens ?? m?.output ?? 8_000,
      supportsJson: isOfficial || true,
      supportsEmbeddings: m?.embedding ?? !isOfficial,
    };
  };

  const complete = async (req: CompletionRequest): Promise<CompletionResult> => {
    const maxTokens = Math.min(req.maxTokens ?? 8_000, info(req.model).maxOutputTokens);
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      ...(isOfficial ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      ...(req.temperature !== undefined && !isOfficial ? { temperature: req.temperature } : {}),
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    };
    const r = await call<ChatResponse>('/chat/completions', body);
    const choice = r.choices[0];
    return {
      text: choice?.message.content ?? '',
      model: r.model ?? req.model,
      provider: cfg.name,
      inputTokens: r.usage?.prompt_tokens ?? 0,
      outputTokens: r.usage?.completion_tokens ?? 0,
      stopReason: choice?.finish_reason ?? null,
    };
  };

  const embed = async (texts: string[], model: string): Promise<EmbeddingResult> => {
    const r = await call<EmbeddingResponse>('/embeddings', { model, input: texts });
    const vectors = [...r.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return {
      vectors,
      model: r.model ?? model,
      dims: vectors[0]?.length ?? 0,
      inputTokens: r.usage?.prompt_tokens ?? 0,
    };
  };

  return {
    name: cfg.name,
    kind: cfg.kind,
    internal: cfg.internal ?? !isOfficial,
    complete,
    embed,
    modelInfo: info,
    listModels: () => (isOfficial ? Object.keys(OPENAI_MODELS) : [cfg.defaultModel]),
    async test(model: string): Promise<ConnectionTest> {
      const t0 = Date.now();
      try {
        if (info(model).supportsEmbeddings && OPENAI_MODELS[model]?.embedding) {
          const e = await embed(['testi'], model);
          return {
            ok: true,
            message: `Yhteys toimii (${e.dims} ulottuvuutta)`,
            latencyMs: Date.now() - t0,
            model,
          };
        }
        const r = await complete({
          model,
          maxTokens: 32,
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
