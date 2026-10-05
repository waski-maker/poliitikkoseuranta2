/** Provider-neutral AI types. Modules only ever see these. */

export type ProviderKind = 'anthropic' | 'openai' | 'openai-compatible' | 'mock';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object answer (providers that support it enforce it). */
  json?: boolean;
}

export interface CompletionResult {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dims: number;
  inputTokens: number;
}

export interface ModelInfo {
  id: string;
  contextTokens: number;
  maxOutputTokens: number;
  supportsJson: boolean;
  supportsEmbeddings: boolean;
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
  latencyMs: number;
  model?: string;
}

export interface AiProvider {
  /** Configured provider name, e.g. "anthropic" or "ollama-local". */
  name: string;
  kind: ProviderKind;
  /** True for models running inside our own environment (no data leaves it). */
  internal: boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  embed?(texts: string[], model: string): Promise<EmbeddingResult>;
  modelInfo(model: string): ModelInfo;
  listModels(): string[];
  test(model: string): Promise<ConnectionTest>;
}

/** Stored (non-secret) configuration of one provider instance. */
export interface ProviderConfig {
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  defaultModel: string;
  internal?: boolean;
  /** Overrides of model limits for unknown/self-hosted models. */
  contextTokens?: number;
  maxOutputTokens?: number;
}

export interface TaskRoute {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export type AiTask = 'default' | 'analysis' | 'classification' | 'summary' | 'chat';

export interface AiSettings {
  providers: ProviderConfig[];
  tasks: Partial<Record<AiTask, TaskRoute>> & { default: TaskRoute };
  /** Provider used when the primary one fails. */
  fallbackProvider?: string | null;
  embedding: { provider: string; model: string } | null;
  /** When true, non-public data may only be sent to providers marked internal. */
  nonPublicOnlyInternal: boolean;
  cacheEnabled: boolean;
}
