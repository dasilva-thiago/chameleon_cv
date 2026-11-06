/**
 * Shared types of the AI layer. Every provider is reached through the OpenAI-compatible chat-completions
 * protocol, so one adapter covers Gemini, Groq, Mistral, Cerebras, OpenRouter, DeepSeek and GitHub Models.
 *
 * Nothing here knows about resumes: the tasks (analysis, resume) build the messages and validate the answer.
 */

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiCompletion {
  text: string;
  usage: TokenUsage;
  provider: string;
  model: string;
}

/**
 * Why a call failed. The router decides what to do from the kind:
 * - `rate_limited`: per-minute limit -> short pause, try the next provider;
 * - `quota`: the daily/monthly allowance is spent -> out for the rest of the day;
 * - `auth`: bad or missing key -> out for a long time (a human has to fix it);
 * - `unavailable`/`timeout`: provider trouble -> short pause;
 * - `bad_request`: this request, for this provider (e.g. unknown model) -> next provider, no long pause;
 * - `invalid_output`: the answer was not the JSON we asked for -> next provider.
 */
export type AiErrorKind =
  'rate_limited' | 'quota' | 'auth' | 'unavailable' | 'timeout' | 'bad_request' | 'invalid_output';

export class AiProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  /** The message never carries prompt or answer text: it is safe to log. */
  constructor(
    kind: AiErrorKind,
    options: { status?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(
      `AI provider error: ${kind}${options.status !== undefined ? ` (${String(options.status)})` : ''}`,
    );
    this.name = 'AiProviderError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface ProviderSpec {
  /** Short stable id: `gemini`, `groq`... (also the consent purpose suffix). */
  id: string;
  label: string;
  /** Without the trailing slash and without `/chat/completions`. */
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Requests per UTC day this app may spend on the provider (a conservative cap below the real one). */
  dailyRequests: number;
  /** Optional cap of tokens per UTC day. */
  dailyTokens?: number | undefined;
  /** Send `response_format: json_object`. A provider that rejects it is retried once without. */
  jsonMode: boolean;
  timeoutMs: number;
  headers?: Record<string, string> | undefined;
}

export interface CompletionRequest {
  messages: readonly ChatMessage[];
  maxTokens: number;
  temperature: number;
}

export interface AiProvider {
  readonly spec: ProviderSpec;
  complete(request: CompletionRequest, signal?: AbortSignal): Promise<AiCompletion>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
