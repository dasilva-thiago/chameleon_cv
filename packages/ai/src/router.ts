import {
  AiProviderError,
  type AiErrorKind,
  type AiProvider,
  type ChatMessage,
  type TokenUsage,
} from './types';

/** Per-provider, per-UTC-day counters. The API keeps them in the database so a restart does not reset them. */
export interface BudgetStore {
  usage(providerId: string, day: string): Promise<{ requests: number; tokens: number }>;
  record(
    providerId: string,
    day: string,
    delta: { requests: number; tokens: number },
  ): Promise<void>;
}

export function memoryBudgetStore(): BudgetStore {
  const counters = new Map<string, { requests: number; tokens: number }>();
  return {
    usage: (providerId, day) =>
      Promise.resolve({ ...(counters.get(`${providerId}|${day}`) ?? { requests: 0, tokens: 0 }) }),
    record(providerId, day, delta) {
      const key = `${providerId}|${day}`;
      const current = counters.get(key) ?? { requests: 0, tokens: 0 };
      counters.set(key, {
        requests: current.requests + delta.requests,
        tokens: current.tokens + delta.tokens,
      });
      return Promise.resolve();
    },
  };
}

export interface AiLimits {
  /** Total requests per UTC day across providers (the cap that protects all the free allowances at once). */
  totalDailyRequests?: number | undefined;
  /** Total tokens per UTC day across providers. */
  totalDailyTokens?: number | undefined;
}

export type AttemptOutcome =
  'ok' | AiErrorKind | 'skipped_cooldown' | 'skipped_budget' | 'skipped_consent';

/** What happened with each provider on one call. No prompt or answer text: safe to log and to store. */
export interface Attempt {
  provider: string;
  outcome: AttemptOutcome;
}

export class AiUnavailableError extends Error {
  readonly attempts: readonly Attempt[];
  constructor(attempts: readonly Attempt[]) {
    super('No AI provider could answer.');
    this.name = 'AiUnavailableError';
    this.attempts = attempts;
  }
}

export interface RunInput<T> {
  messages: readonly ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** Turns the answer text into the typed value, or throws when it is not valid. */
  parse: (text: string) => T;
}

export interface RunResult<T> {
  value: T;
  provider: string;
  model: string;
  usage: TokenUsage;
  attempts: readonly Attempt[];
}

export interface AiRouter {
  /** At least one provider is configured. */
  readonly enabled: boolean;
  providerIds(): string[];
  run<T>(input: RunInput<T>, signal?: AbortSignal): Promise<RunResult<T>>;
}

export interface AiRouterOptions {
  providers: readonly AiProvider[];
  budget: BudgetStore;
  limits?: AiLimits;
  /** Per-provider consent gate (a provider without consent is never called). Default: allowed. */
  allowed?: (providerId: string) => boolean | Promise<boolean>;
  now?: () => Date;
  /** Pause state (provider id -> epoch ms). Pass the same map to every router so pauses outlive one request. */
  cooldowns?: Map<string, number>;
}

const SECOND = 1000;
const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
const nextUtcMidnight = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);

/**
 * Tries the providers in order and answers with the first valid result. A provider is skipped while it is paused
 * (rate limit, outage, spent daily allowance, bad key), when its own daily budget or the global one is used up,
 * or when there is no consent for it. When every provider fails the caller gets `AiUnavailableError` and falls
 * back to the local, deterministic result: the user never sees an error because one free tier ran out.
 */
export function createAiRouter(options: AiRouterOptions): AiRouter {
  const { providers, budget } = options;
  const now = options.now ?? (() => new Date());
  const pausedUntil = options.cooldowns ?? new Map<string, number>();

  const pause = (id: string, error: AiProviderError, at: Date): void => {
    let until: number;
    switch (error.kind) {
      case 'rate_limited':
        until = at.getTime() + Math.max(15, error.retryAfterSeconds ?? 60) * SECOND;
        break;
      case 'quota':
        until = nextUtcMidnight(at);
        break;
      case 'auth':
        until = at.getTime() + 6 * 60 * 60 * SECOND;
        break;
      case 'bad_request':
        until = at.getTime() + 10 * 60 * SECOND;
        break;
      case 'unavailable':
      case 'timeout':
        until = at.getTime() + 60 * SECOND;
        break;
      case 'invalid_output':
        return; // the next provider answers; this one is fine for the next call
    }
    pausedUntil.set(id, until);
  };

  return {
    enabled: providers.length > 0,
    providerIds: () => providers.map((provider) => provider.spec.id),
    async run<T>(input: RunInput<T>, signal?: AbortSignal): Promise<RunResult<T>> {
      const attempts: Attempt[] = [];
      const start = now();
      const day = dayOf(start);

      let totalRequests = 0;
      let totalTokens = 0;
      const used = new Map<string, { requests: number; tokens: number }>();
      for (const provider of providers) {
        const usage = await budget.usage(provider.spec.id, day);
        used.set(provider.spec.id, usage);
        totalRequests += usage.requests;
        totalTokens += usage.tokens;
      }
      const { totalDailyRequests, totalDailyTokens } = options.limits ?? {};
      if (
        (totalDailyRequests !== undefined && totalRequests >= totalDailyRequests) ||
        (totalDailyTokens !== undefined && totalTokens >= totalDailyTokens)
      ) {
        throw new AiUnavailableError(
          providers.map((p) => ({ provider: p.spec.id, outcome: 'skipped_budget' })),
        );
      }

      for (const provider of providers) {
        const { id } = provider.spec;
        if (!(await (options.allowed?.(id) ?? true))) {
          attempts.push({ provider: id, outcome: 'skipped_consent' });
          continue;
        }
        if ((pausedUntil.get(id) ?? 0) > start.getTime()) {
          attempts.push({ provider: id, outcome: 'skipped_cooldown' });
          continue;
        }
        const own = used.get(id) ?? { requests: 0, tokens: 0 };
        if (
          own.requests >= provider.spec.dailyRequests ||
          (provider.spec.dailyTokens !== undefined && own.tokens >= provider.spec.dailyTokens)
        ) {
          attempts.push({ provider: id, outcome: 'skipped_budget' });
          continue;
        }

        // The request counts as soon as it is sent: a failed call may still spend the provider's allowance.
        await budget.record(id, day, { requests: 1, tokens: 0 });
        try {
          const completion = await provider.complete(
            {
              messages: input.messages,
              maxTokens: input.maxTokens,
              temperature: input.temperature ?? 0.2,
            },
            signal,
          );
          await budget.record(id, day, { requests: 0, tokens: completion.usage.totalTokens });
          let value: T;
          try {
            value = input.parse(completion.text);
          } catch (cause) {
            throw new AiProviderError('invalid_output', { cause });
          }
          attempts.push({ provider: id, outcome: 'ok' });
          return {
            value,
            provider: completion.provider,
            model: completion.model,
            usage: completion.usage,
            attempts,
          };
        } catch (error) {
          if (signal?.aborted) throw error;
          const failure =
            error instanceof AiProviderError
              ? error
              : new AiProviderError('unavailable', { cause: error });
          attempts.push({ provider: id, outcome: failure.kind });
          pause(id, failure, now());
        }
      }
      throw new AiUnavailableError(attempts);
    },
  };
}
