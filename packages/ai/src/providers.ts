import { createOpenAiCompatibleProvider } from './openai-compatible';
import type { AiProvider, FetchLike, ProviderSpec } from './types';

/**
 * Providers known to the app. All speak the OpenAI-compatible chat-completions protocol.
 *
 * Models and free-tier limits change often and the numbers published by different sources disagree, so:
 * - every model is overridable (`AI_<ID>_MODEL`) and `pnpm ai:check` lists what a key can really use;
 * - the daily request caps below are deliberately conservative (`AI_<ID>_DAILY_REQUESTS` overrides them);
 * - a provider is used only when its key is set, and only in the order of `AI_PROVIDER_ORDER`.
 */
export interface KnownProvider {
  id: string;
  label: string;
  baseUrl: string;
  keyEnv: string;
  defaultModel: string;
  defaultDailyRequests: number;
  jsonMode: boolean;
  /** Short note shown by `ai:check`. */
  note: string;
}

export const KNOWN_PROVIDERS: readonly KnownProvider[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.8-flash',
    defaultDailyRequests: 200,
    jsonMode: true,
    note: 'Free tier (Google AI Studio). Unpaid-tier content may be used by Google to improve its products.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    defaultDailyRequests: 200,
    jsonMode: true,
    note: 'Free access with per-model limits; fast open models.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-small-latest',
    defaultDailyRequests: 100,
    jsonMode: true,
    note: 'Free "Experiment" plan; check the data terms of the plan in the Mistral console.',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY',
    defaultModel: 'gpt-oss-120b',
    defaultDailyRequests: 100,
    jsonMode: true,
    note: 'Free tier with a daily token allowance.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    defaultDailyRequests: 40,
    jsonMode: false,
    note: 'Models ending in ":free" (about 50 requests/day without credits). Free models come and go: confirm with ai:check.',
  },
  {
    id: 'github',
    label: 'GitHub Models',
    baseUrl: 'https://models.github.ai/inference',
    keyEnv: 'GITHUB_MODELS_TOKEN',
    defaultModel: 'openai/gpt-4.1-mini',
    defaultDailyRequests: 50,
    jsonMode: true,
    note: 'Free tier with a GitHub token (rate-limited, meant for prototyping).',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    defaultDailyRequests: 100,
    jsonMode: true,
    note: 'Not a free tier: very cheap pay-as-you-go (new accounts may get starter credit). Last in the default order.',
  },
];

export const DEFAULT_PROVIDER_ORDER: readonly string[] = KNOWN_PROVIDERS.map((p) => p.id);

type Env = Readonly<Record<string, string | undefined>>;

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

const positiveInt = (value: string | undefined): number | undefined => {
  const n = Number(clean(value));
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * Providers that have a key, in the configured order. `AI_PROVIDER_ORDER` (comma-separated ids) selects and
 * orders them; unknown ids are ignored, providers without a key are skipped.
 */
export function resolveProviderSpecs(env: Env): ProviderSpec[] {
  const order = (clean(env.AI_PROVIDER_ORDER) ?? DEFAULT_PROVIDER_ORDER.join(','))
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id !== '');
  const timeoutMs = positiveInt(env.AI_TIMEOUT_MS) ?? 45_000;
  const specs: ProviderSpec[] = [];
  for (const id of order) {
    const known = KNOWN_PROVIDERS.find((provider) => provider.id === id);
    if (known === undefined || specs.some((spec) => spec.id === id)) continue;
    const apiKey = clean(env[known.keyEnv]);
    if (apiKey === undefined) continue;
    const key = id.toUpperCase();
    specs.push({
      id,
      label: known.label,
      baseUrl: known.baseUrl,
      apiKey,
      model: clean(env[`AI_${key}_MODEL`]) ?? known.defaultModel,
      dailyRequests: positiveInt(env[`AI_${key}_DAILY_REQUESTS`]) ?? known.defaultDailyRequests,
      dailyTokens: positiveInt(env[`AI_${key}_DAILY_TOKENS`]),
      jsonMode: known.jsonMode,
      timeoutMs,
    });
  }
  return specs;
}

export function resolveProviders(env: Env, fetchImpl?: FetchLike): AiProvider[] {
  return resolveProviderSpecs(env).map((spec) => createOpenAiCompatibleProvider(spec, fetchImpl));
}
