import type { Db } from '../db/client.ts';
import type { AppConfig } from '../config.ts';
import type { Logger } from '../util/log.ts';
import { sha256Hex } from '../util/crypto.ts';
import { ForbiddenError, ValidationError, errorMessage } from '../util/errors.ts';
import { createAnthropicProvider } from './providers/anthropic.ts';
import { createOpenAiProvider } from './providers/openai.ts';
import { createMockProvider } from './providers/mock.ts';
import { chunkDocuments, formatDocument, type SourceDocument } from './chunking.ts';
import { estimateCostUsd, estimateTokens } from './pricing.ts';
import { getPrompt, renderPrompt } from './prompts/index.ts';
import type {
  AiProvider,
  AiSettings,
  AiTask,
  ChatMessage,
  CompletionResult,
  ConnectionTest,
  EmbeddingResult,
  ProviderConfig,
  TaskRoute,
} from './types.ts';

export const AI_SETTINGS_SCOPE = 'ai';
export const AI_SETTINGS_KEY = 'config';

export type DataVisibility = 'public' | 'internal' | 'private';

/** Built-in provider definitions; admins can edit them and add more. */
export function defaultAiSettings(config: Partial<AppConfig>): AiSettings {
  const providers: ProviderConfig[] = [
    { name: 'anthropic', kind: 'anthropic', defaultModel: 'claude-opus-5-5' },
    { name: 'openai', kind: 'openai', defaultModel: 'gpt-5' },
    {
      name: 'local',
      kind: 'openai-compatible',
      baseUrl: config.AI_BASE_URL ?? 'http://localhost:11434/v1',
      defaultModel:
        config.AI_PROVIDER === 'openai-compatible' && config.AI_MODEL ? config.AI_MODEL : 'llama3.1',
      internal: true,
      contextTokens: 32_000,
      maxOutputTokens: 4_000,
    },
    { name: 'mock', kind: 'mock', defaultModel: 'mock-1', internal: true },
  ];
  const chosen =
    config.AI_PROVIDER === 'openai-compatible'
      ? 'local'
      : (config.AI_PROVIDER ??
        (config.ANTHROPIC_API_KEY ? 'anthropic' : config.OPENAI_API_KEY ? 'openai' : 'mock'));
  const providerCfg = providers.find((p) => p.name === chosen)!;
  const model = config.AI_MODEL && chosen !== 'local' ? config.AI_MODEL : providerCfg.defaultModel;

  const embProvider =
    config.EMBEDDING_PROVIDER === 'openai-compatible'
      ? 'local'
      : (config.EMBEDDING_PROVIDER ?? (config.OPENAI_API_KEY ? 'openai' : 'mock'));
  const embModel =
    config.EMBEDDING_MODEL ??
    (embProvider === 'openai'
      ? 'text-embedding-3-small'
      : embProvider === 'mock'
        ? 'mock-embed-64'
        : 'nomic-embed-text');

  return {
    providers,
    tasks: { default: { provider: chosen, model } },
    fallbackProvider: null,
    embedding: { provider: embProvider, model: embModel },
    nonPublicOnlyInternal: false,
    cacheEnabled: true,
  };
}

export interface AiServiceDeps {
  /** System-level connection (usage log and cache bypass RLS). */
  db: Db;
  settings: AiSettings;
  /** Resolves the API key for a provider (encrypted settings first, then env). */
  apiKey: (provider: ProviderConfig) => Promise<string | null>;
  log: Logger;
  fetch?: typeof fetch;
  priceOverrides?: Record<string, { input: number; output: number }>;
  /** Test hook: replace provider construction. */
  providerFactory?: (cfg: ProviderConfig, key: string | null) => AiProvider;
}

export interface CompleteInput {
  task?: AiTask;
  system?: string;
  messages: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
  /** Most restrictive visibility level of the data in the prompt. */
  visibility?: DataVisibility;
  userId?: string | null;
  /** Force a provider (e.g. "Test connection"). */
  provider?: string;
  model?: string;
}

export interface AnalyzeInput {
  task?: AiTask;
  /** What the model should do, e.g. "Tiivistä edustajan kannat aiheesta X". */
  instructions: string;
  documents: SourceDocument[];
  visibility?: DataVisibility;
  userId?: string | null;
  systemPromptVersion?: number;
}

export interface AnalyzeResult {
  text: string;
  provider: string;
  model: string;
  parts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  promptVersions: Record<string, number>;
}

/**
 * The single server-side entry point for all AI calls. Modules call
 * ai.complete(), ai.analyze() and ai.embed(); they never import provider SDKs.
 */
export class AiService {
  private cache = new Map<string, AiProvider>();

  constructor(private readonly deps: AiServiceDeps) {}

  get settings(): AiSettings {
    return this.deps.settings;
  }

  providerConfig(name: string): ProviderConfig {
    const cfg = this.deps.settings.providers.find((p) => p.name === name);
    if (!cfg) throw new ValidationError(`Tuntematon tekoälypalvelu: ${name}`);
    return cfg;
  }

  async provider(name: string): Promise<AiProvider> {
    const hit = this.cache.get(name);
    if (hit) return hit;
    const cfg = this.providerConfig(name);
    const key = await this.deps.apiKey(cfg);
    let p: AiProvider;
    if (this.deps.providerFactory) p = this.deps.providerFactory(cfg, key);
    else if (cfg.kind === 'anthropic') {
      if (!key) throw new ValidationError('Anthropic-palvelun API-avain puuttuu');
      p = createAnthropicProvider(cfg, key, this.deps.fetch);
    } else if (cfg.kind === 'openai' || cfg.kind === 'openai-compatible') {
      if (cfg.kind === 'openai' && !key) throw new ValidationError('OpenAI-palvelun API-avain puuttuu');
      p = createOpenAiProvider(cfg, key, this.deps.fetch);
    } else p = createMockProvider(cfg);
    this.cache.set(name, p);
    return p;
  }

  route(task: AiTask = 'default'): TaskRoute {
    return this.deps.settings.tasks[task] ?? this.deps.settings.tasks.default;
  }

  /** Picks provider+model honouring the privacy rule (non-public data only to internal models). */
  private async resolve(input: {
    task?: AiTask;
    provider?: string;
    model?: string;
    visibility?: DataVisibility;
  }) {
    const route = this.route(input.task);
    const name = input.provider ?? route.provider;
    const model = input.model ?? (input.provider ? this.providerConfig(name).defaultModel : route.model);
    const p = await this.provider(name);
    const restricted =
      this.deps.settings.nonPublicOnlyInternal && (input.visibility ?? 'internal') !== 'public';
    if (restricted && !p.internal) {
      throw new ForbiddenError(
        'Tietosuoja-asetus: ei-julkista tietoa saa lähettää vain sisäiselle mallille. Valitse sisäinen malli tälle tehtävälle.',
      );
    }
    return { provider: p, model, route };
  }

  async complete(input: CompleteInput): Promise<CompletionResult & { cached: boolean }> {
    const { provider, model, route } = await this.resolve(input);
    const req = {
      model,
      system: input.system,
      messages: input.messages,
      json: input.json,
      maxTokens: input.maxTokens ?? route.maxTokens,
      temperature: route.temperature,
    };
    const cacheKey = await sha256Hex(JSON.stringify({ p: provider.name, ...req }));
    if (this.deps.settings.cacheEnabled && !input.provider) {
      const [hit] = await this.deps.db<{ response: CompletionResult }[]>`
        select response from core.ai_cache where key = ${cacheKey}`;
      if (hit) {
        await this.logUsage(
          provider.name,
          model,
          input.task ?? 'default',
          0,
          0,
          0,
          true,
          null,
          input.userId,
          true,
        );
        return { ...hit.response, cached: true };
      }
    }
    const t0 = Date.now();
    try {
      const result = await provider.complete(req);
      await this.logUsage(
        provider.name,
        result.model,
        input.task ?? 'default',
        result.inputTokens,
        result.outputTokens,
        Date.now() - t0,
        true,
        null,
        input.userId,
        false,
      );
      if (this.deps.settings.cacheEnabled) {
        await this.deps.db`insert into core.ai_cache (key, provider, model, response)
          values (${cacheKey}, ${provider.name}, ${result.model}, ${this.deps.db.json(result as never)})
          on conflict (key) do nothing`;
      }
      return { ...result, cached: false };
    } catch (err) {
      await this.logUsage(
        provider.name,
        model,
        input.task ?? 'default',
        0,
        0,
        Date.now() - t0,
        false,
        errorMessage(err),
        input.userId,
        false,
      );
      const fb = this.deps.settings.fallbackProvider;
      if (fb && fb !== provider.name && !input.provider) {
        this.deps.log.warn('AI provider failed, using fallback', { provider: provider.name, fallback: fb });
        return this.complete({ ...input, provider: fb, model: this.providerConfig(fb).defaultModel });
      }
      throw err;
    }
  }

  /** Estimates tokens, parts and cost before a large analysis run. */
  async estimate(input: Pick<AnalyzeInput, 'task' | 'documents' | 'instructions'>) {
    const route = this.route(input.task);
    const p = await this.provider(route.provider);
    const info = p.modelInfo(route.model);
    const parts = chunkDocuments(input.documents, info.contextTokens, 8_000).length;
    const tokens =
      input.documents.reduce((s, d) => s + estimateTokens(formatDocument(d)), 0) +
      estimateTokens(input.instructions);
    const outTokens = Math.min(4_000, info.maxOutputTokens) * (parts > 1 ? parts + 1 : 1);
    return {
      provider: p.name,
      model: route.model,
      documents: input.documents.length,
      inputTokens: tokens,
      parts,
      costUsd: estimateCostUsd(route.model, tokens, outTokens, this.deps.priceOverrides),
    };
  }

  /**
   * Analyses a set of documents. If they do not fit the model's context window
   * they are processed in parts (map) and combined (reduce). Citations [#id]
   * are preserved through both steps.
   */
  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    if (!input.documents.length) throw new ValidationError('Analyysiin ei valittu yhtään aineistoa');
    const { provider, model } = await this.resolve(input);
    const info = provider.modelInfo(model);
    const system = renderPrompt(getPrompt('neutral-system', input.systemPromptVersion), {});
    const mapPrompt = getPrompt('map-step');
    const reducePrompt = getPrompt('reduce-step');
    const batches = chunkDocuments(input.documents, info.contextTokens, estimateTokens(system) + 8_000);
    let inTok = 0;
    let outTok = 0;
    const call = async (content: string) => {
      const r = await this.complete({
        task: input.task ?? 'analysis',
        system,
        messages: [{ role: 'user', content }],
        visibility: input.visibility,
        userId: input.userId,
      });
      inTok += r.inputTokens;
      outTok += r.outputTokens;
      return r;
    };

    let final: CompletionResult;
    if (batches.length === 1) {
      final = await call(`${input.instructions}\n\n${batches[0]!.map(formatDocument).join('\n\n')}`);
    } else {
      const partials: string[] = [];
      for (let i = 0; i < batches.length; i++) {
        const r = await call(
          renderPrompt(mapPrompt, {
            task: input.instructions,
            part: String(i + 1),
            parts: String(batches.length),
            documents: batches[i]!.map(formatDocument).join('\n\n'),
          }),
        );
        partials.push(`### Osa ${i + 1}\n${r.text}`);
      }
      final = await call(
        renderPrompt(reducePrompt, {
          task: input.instructions,
          parts: String(batches.length),
          partials: partials.join('\n\n'),
        }),
      );
    }
    return {
      text: final.text,
      provider: final.provider,
      model: final.model,
      parts: batches.length,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: estimateCostUsd(final.model, inTok, outTok, this.deps.priceOverrides),
      promptVersions: {
        'neutral-system': getPrompt('neutral-system', input.systemPromptVersion).version,
        ...(batches.length > 1 ? { 'map-step': mapPrompt.version, 'reduce-step': reducePrompt.version } : {}),
      },
    };
  }

  /** Embeds texts with the separately configured embedding model. */
  async embed(
    texts: string[],
    opts: { visibility?: DataVisibility; userId?: string | null } = {},
  ): Promise<EmbeddingResult> {
    const emb = this.deps.settings.embedding;
    if (!emb) throw new ValidationError('Upotemallia ei ole määritetty');
    const p = await this.provider(emb.provider);
    if (!p.embed) throw new ValidationError(`Palvelu ${emb.provider} ei tue upotteita`);
    if (
      this.deps.settings.nonPublicOnlyInternal &&
      (opts.visibility ?? 'internal') !== 'public' &&
      !p.internal
    ) {
      throw new ForbiddenError('Tietosuoja-asetus: ei-julkisen tiedon upotteet vain sisäisellä mallilla');
    }
    const t0 = Date.now();
    const r = await p.embed(texts, emb.model);
    await this.logUsage(
      p.name,
      emb.model,
      'embedding',
      r.inputTokens,
      0,
      Date.now() - t0,
      true,
      null,
      opts.userId,
      false,
    );
    return r;
  }

  async testProvider(name: string, model?: string): Promise<ConnectionTest> {
    try {
      const p = await this.provider(name);
      return await p.test(model ?? this.providerConfig(name).defaultModel);
    } catch (err) {
      return { ok: false, message: errorMessage(err), latencyMs: 0 };
    }
  }

  private async logUsage(
    provider: string,
    model: string,
    task: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    success: boolean,
    error: string | null,
    userId: string | null | undefined,
    cached: boolean,
  ): Promise<void> {
    try {
      await this.deps.db`insert into core.ai_usage
        (provider, model, task, input_tokens, output_tokens, duration_ms, cost_usd, success, cached, error, user_id)
        values (${provider}, ${model}, ${task}, ${inputTokens}, ${outputTokens}, ${durationMs},
                ${estimateCostUsd(model, inputTokens, outputTokens, this.deps.priceOverrides)},
                ${success}, ${cached}, ${error}, ${userId ?? null})`;
    } catch (err) {
      this.deps.log.warn('could not log AI usage', { error: errorMessage(err) });
    }
  }
}

/** Usage summary per provider/model for the admin page. */
export async function aiUsageSummary(db: Db, sinceDays = 30) {
  return db<
    {
      provider: string;
      model: string;
      calls: number;
      failures: number;
      cachedCalls: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      avgDurationMs: number;
    }[]
  >`
    select provider, model, count(*)::int as calls,
      count(*) filter (where not success)::int as failures,
      count(*) filter (where cached)::int as cached_calls,
      coalesce(sum(input_tokens), 0)::int as input_tokens,
      coalesce(sum(output_tokens), 0)::int as output_tokens,
      coalesce(sum(cost_usd), 0)::float8 as cost_usd,
      coalesce(avg(duration_ms) filter (where not cached), 0)::int as avg_duration_ms
    from core.ai_usage
    where at > now() - make_interval(days => ${sinceDays})
    group by provider, model
    order by cost_usd desc, calls desc`;
}
