import {
  AiProviderError,
  type AiCompletion,
  type AiProvider,
  type CompletionRequest,
  type FetchLike,
  type ProviderSpec,
} from './types';

const toNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

function retryAfterOf(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

/** Cheap check on the (untrusted) error body to tell a spent daily allowance from a per-minute limit. */
function looksLikeQuota(body: string): boolean {
  return /quota|per day|daily|exceeded your current|billing|credits?/i.test(body);
}

/**
 * Maps an HTTP failure to an error kind. The body is only inspected, never kept or logged: provider error
 * messages may echo the request.
 */
export function classifyFailure(
  status: number,
  body: string,
  retryAfterSeconds?: number,
): AiProviderError {
  const extra = retryAfterSeconds !== undefined ? { retryAfterSeconds } : {};
  if (status === 401 || status === 403) return new AiProviderError('auth', { status });
  if (status === 402) return new AiProviderError('quota', { status });
  if (status === 429) {
    return new AiProviderError(
      looksLikeQuota(body) && retryAfterSeconds === undefined ? 'quota' : 'rate_limited',
      {
        status,
        ...extra,
      },
    );
  }
  if (status === 408) return new AiProviderError('timeout', { status });
  if (status >= 500) return new AiProviderError('unavailable', { status, ...extra });
  return new AiProviderError('bad_request', { status });
}

interface ChatBody {
  model: string;
  messages: readonly { role: string; content: string }[];
  max_tokens: number;
  temperature: number;
  response_format?: { type: 'json_object' };
}

/** One provider speaking the OpenAI-compatible `/chat/completions` protocol over plain `fetch`. */
export function createOpenAiCompatibleProvider(
  spec: ProviderSpec,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): AiProvider {
  async function post(body: ChatBody, signal: AbortSignal | undefined): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, spec.timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetchImpl(`${spec.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${spec.apiKey}`,
          ...spec.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new AiProviderError('timeout', { cause: error });
      throw new AiProviderError(controller.signal.aborted ? 'timeout' : 'unavailable', {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    spec,
    async complete(request: CompletionRequest, signal?: AbortSignal): Promise<AiCompletion> {
      const base: ChatBody = {
        model: spec.model,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      };
      let response = await post(
        spec.jsonMode ? { ...base, response_format: { type: 'json_object' } } : base,
        signal,
      );
      if (!response.ok && spec.jsonMode && (response.status === 400 || response.status === 422)) {
        // Some models reject JSON mode: try once without it (the prompt still demands JSON).
        const text = await response.text().catch(() => '');
        if (/response_format|json/i.test(text)) response = await post(base, signal);
        else throw classifyFailure(response.status, text);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw classifyFailure(response.status, text, retryAfterOf(response));
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new AiProviderError('invalid_output', { cause: error });
      }
      const root = payload as {
        choices?: { message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
      };
      const content = root.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new AiProviderError('invalid_output');
      }
      const prompt = toNumber(root.usage?.prompt_tokens);
      const completion = toNumber(root.usage?.completion_tokens);
      return {
        text: content,
        usage: {
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: toNumber(root.usage?.total_tokens) || prompt + completion,
        },
        provider: spec.id,
        model: spec.model,
      };
    },
  };
}
