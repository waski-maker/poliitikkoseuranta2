import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
  EmbeddingResult,
  ProviderConfig,
} from '../types.ts';
import { estimateTokens } from '../pricing.ts';

/**
 * Deterministic fake provider for development and tests (no API key needed).
 * Completions echo a short summary that keeps [#id] citations from the input;
 * embeddings are hashed bag-of-words vectors, so similar texts get similar vectors.
 */
export function createMockProvider(
  cfg: ProviderConfig = { name: 'mock', kind: 'mock', defaultModel: 'mock-1' },
): AiProvider {
  const complete = async (req: CompletionRequest): Promise<CompletionResult> => {
    const input = [req.system ?? '', ...req.messages.map((m) => m.content)].join('\n');
    const cites = [...new Set(input.match(/\[#[^\]\s]+\]/g) ?? [])].slice(0, 5);
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const text = req.json
      ? JSON.stringify({ summary: `Valevastaus (${lastUser.length} merkkiä)`, citations: cites })
      : `Valepalvelun vastaus: aineistossa ${lastUser.length} merkkiä. ${cites.join(' ')}`.trim();
    return {
      text,
      model: req.model,
      provider: cfg.name,
      inputTokens: estimateTokens(input),
      outputTokens: estimateTokens(text),
      stopReason: 'end_turn',
    };
  };

  const embed = async (texts: string[], model: string): Promise<EmbeddingResult> => {
    const dims = 64;
    const vectors = texts.map((t) => {
      const v = new Array<number>(dims).fill(0);
      for (const word of t
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)) {
        const stem = word.slice(0, 5);
        let h = 2166136261;
        for (let i = 0; i < stem.length; i++) h = Math.imul(h ^ stem.charCodeAt(i), 16777619);
        v[Math.abs(h) % dims]! += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
    return { vectors, model, dims, inputTokens: texts.reduce((s, t) => s + estimateTokens(t), 0) };
  };

  return {
    name: cfg.name,
    kind: 'mock',
    internal: true,
    complete,
    embed,
    modelInfo: (model) => ({
      id: model,
      contextTokens: cfg.contextTokens ?? 8_000,
      maxOutputTokens: 2_000,
      supportsJson: true,
      supportsEmbeddings: true,
    }),
    listModels: () => [cfg.defaultModel],
    test: async (model) => ({ ok: true, message: `Valepalvelu vastaa (${model})`, latencyMs: 0, model }),
  };
}
