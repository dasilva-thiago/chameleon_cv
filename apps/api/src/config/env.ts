import { z } from 'zod';

/** Variaveis vazias (ex.: `AI_MODEL=`) equivalem a "nao definida". */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Origem da SPA (esquema + host + porta). Base do CSRF por Origin e da estrategia de cookies. */
  APP_ORIGIN: z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  /** `open` e reservado (ADR-0009) e ainda nao implementado: rejeitado na validacao. */
  SIGNUP_MODE: z.enum(['invite', 'open', 'closed']).default('invite'),
  /** Numero de proxies confiaveis a frente da API (0 = nenhum; usa o IP do socket). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  /**
   * Explicit opt-out documenting a DIRECT deployment (no reverse proxy). Required to run
   * NODE_ENV=production with TRUST_PROXY=0: behind a proxy that setting makes every client share the
   * proxy address as rate-limit key (shared lockout).
   */
  TRUST_PROXY_ACK_DIRECT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Policy text versions the server accepts for `profile_processing` consent (comma-separated; the
   * first is the current one). Must contain the version shown by apps/web (DEFAULT_PROFILE_POLICY_VERSION
   * or VITE_PROFILE_POLICY_VERSION). Client-supplied versions outside this list are rejected.
   */
  PROFILE_POLICY_VERSIONS: z
    .string()
    .default('2026-11.1')
    .transform((value) =>
      value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== ''),
    )
    .pipe(
      z
        .array(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/))
        .min(1)
        .max(20),
    ),
  /** Limite do corpo JSON (bytes). Rotas com payload maior definem o proprio parser. */
  JSON_BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(100 * 1024),
  /**
   * `auto`: use the AI providers that have a key (GEMINI_API_KEY, GROQ_API_KEY...; see packages/ai) and fall back
   * to the local deterministic engine when none answers. `deterministic`: never call an AI provider.
   */
  AI_PROVIDER: z.enum(['deterministic', 'auto']).default('auto'),
  /** Comma-separated provider ids in order of preference (default: every known provider that has a key). */
  AI_PROVIDER_ORDER: optionalString,
  /** Cap of requests per UTC day across ALL providers (protects the free allowances as a whole). */
  AI_DAILY_REQUESTS_TOTAL: z.coerce.number().int().positive().default(120),
  /** Cap of tokens per UTC day across all providers. */
  AI_DAILY_TOKEN_LIMIT_PER_USER: z.coerce.number().int().positive().default(200_000),
  PDF_BROWSER: z.enum(['bundled', 'chrome']).default('bundled'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Regras entre variaveis. Estrategia de cookies (ADR-0009): `__Host-` + `Secure` exigem HTTPS, entao
 * a excecao de desenvolvimento e derivada de APP_ORIGIN (nao ha flag separada para desligar `Secure`):
 * http so e aceito em loopback e nunca em NODE_ENV=production.
 */
const refinedEnvSchema = envSchema.superRefine((env, ctx) => {
  const url = new URL(env.APP_ORIGIN);
  if (url.protocol === 'http:') {
    if (env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'em producao deve ser https (cookies Secure com prefixo __Host-)',
      });
    } else if (!LOOPBACK_HOSTS.has(url.hostname)) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'http so e aceito para localhost/127.0.0.1/[::1] (desenvolvimento local)',
      });
    }
  }
  if (env.NODE_ENV === 'production' && env.TRUST_PROXY === 0 && !env.TRUST_PROXY_ACK_DIRECT) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUST_PROXY'],
      message:
        'em producao defina TRUST_PROXY>=1 (numero de proxies confiaveis) ou TRUST_PROXY_ACK_DIRECT=true se a API recebe clientes diretamente; com 0 atras de um proxy todos os clientes compartilham o limite de taxa',
    });
  }
  if (env.TRUST_PROXY_ACK_DIRECT && env.TRUST_PROXY !== 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUST_PROXY_ACK_DIRECT'],
      message: 'so faz sentido com TRUST_PROXY=0 (implantacao direta, sem proxy)',
    });
  }
  if (env.SIGNUP_MODE === 'open') {
    ctx.addIssue({
      code: 'custom',
      path: ['SIGNUP_MODE'],
      message: 'o modo "open" ainda nao esta implementado; use "invite" ou "closed"',
    });
  }
});

export type AppConfig = z.output<typeof envSchema>;

export interface ConfigIssue {
  variable: string;
  message: string;
}

/**
 * Erro de configuracao. A mensagem lista apenas os NOMES das variaveis invalidas e o
 * motivo, nunca os valores (podem conter segredos).
 */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(`Configuracao invalida: ${issues.map((i) => `${i.variable} (${i.message})`).join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = refinedEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? '(raiz)'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}
