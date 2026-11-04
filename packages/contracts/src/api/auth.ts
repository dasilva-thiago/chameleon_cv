import { z } from 'zod';

/**
 * DTOs de autenticacao (ADR-0009, ADR-0014). Consumidos pela API (validacao) e pelo frontend
 * (tipos e validacao de formulario). Requisicoes sao estritas: campo desconhecido e rejeitado.
 *
 * Convencoes de transporte (nao fazem parte do corpo):
 * - sessao: cookie HttpOnly `__Host-cc_session` (producao) / `cc_session` (dev em http://localhost);
 * - CSRF: metodos nao seguros enviam `X-CSRF-Token` com o valor do cookie legivel `cc_csrf`
 *   (`__Host-cc_csrf` em producao); o cookie e emitido por qualquer `GET /api/*` (ex.: `GET /api/auth/me`).
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 100;
export const POLICY_VERSION_MAX_LENGTH = 64;
export const MAX_CONSENTS_PER_REQUEST = 10;

/** Token de convite: 32 bytes aleatorios em base64url (43 caracteres). */
export const INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

/** E-mail normalizado (trim + minusculas) e validado; a API compara sem diferenciar caixa. */
export const authEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Senha nova: minimo 12 caracteres, sem regra de composicao (a lista de senhas comuns e do servidor). */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH);

export const inviteTokenSchema = z
  .string()
  .regex(INVITE_TOKEN_REGEX, 'Convite invalido ou expirado.');

/** Sem caracteres de controle (inclui NUL, que o PostgreSQL rejeita). */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DISPLAY_NAME_MAX_LENGTH)
  // eslint-disable-next-line no-control-regex -- rejeitar caracteres de controle (inclui NUL) e o objetivo
  .regex(/^[^\u0000-\u001f\u007f]+$/);

/** Finalidades aceitas no cadastro (ADR-0014). */
export const consentPurposeSchema = z
  .string()
  .regex(/^(profile_processing|ai_processing:[a-z0-9][a-z0-9_.-]{0,63})$/);

export const consentInputSchema = z.strictObject({
  purpose: consentPurposeSchema,
  granted: z.boolean(),
  /** Versao do texto da politica exibida ao usuario. */
  policyVersion: z
    .string()
    .trim()
    .min(1)
    .max(POLICY_VERSION_MAX_LENGTH)
    .regex(/^[A-Za-z0-9._-]+$/),
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

// --- Usuario e sessao (respostas) ---------------------------------------------------------

export const authUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authSessionInfoSchema = z.strictObject({
  /** Fim da validade deslizante (renovada pelo uso, ate o limite absoluto). */
  expiresAt: z.iso.datetime(),
  /** Limite absoluto (30 dias desde o login). */
  absoluteExpiresAt: z.iso.datetime(),
});
export type AuthSessionInfo = z.infer<typeof authSessionInfoSchema>;

/** Resposta de login, aceite de convite e `GET /api/auth/me`. */
export const authSessionResponseSchema = z.strictObject({
  user: authUserSchema,
  session: authSessionInfoSchema,
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type MeResponse = AuthSessionResponse;
export type LoginResponse = AuthSessionResponse;
export type AcceptInviteResponse = AuthSessionResponse;
export const meResponseSchema = authSessionResponseSchema;
export const loginResponseSchema = authSessionResponseSchema;
export const acceptInviteResponseSchema = authSessionResponseSchema;

// --- Convite -------------------------------------------------------------------------------

/** POST /api/auth/invites/preview */
export const invitePreviewRequestSchema = z.strictObject({ token: inviteTokenSchema });
export type InvitePreviewRequest = z.infer<typeof invitePreviewRequestSchema>;

export const invitePreviewResponseSchema = z.strictObject({
  email: z.string(),
  expiresAt: z.iso.datetime(),
});
export type InvitePreviewResponse = z.infer<typeof invitePreviewResponseSchema>;

/** POST /api/auth/invites/accept — cria a conta (e-mail vem do convite) e inicia a sessao. */
export const acceptInviteRequestSchema = z.strictObject({
  token: inviteTokenSchema,
  password: newPasswordSchema,
  displayName: displayNameSchema.optional(),
  consents: z.array(consentInputSchema).max(MAX_CONSENTS_PER_REQUEST).optional(),
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;

// --- Login e logout ------------------------------------------------------------------------

/** POST /api/auth/login */
export const loginRequestSchema = z.strictObject({
  email: authEmailSchema,
  /** Sem regra de tamanho minimo no login: a politica vale so ao definir a senha. */
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

/** POST /api/auth/logout e POST /api/auth/logout-all (sem corpo). */
export const logoutResponseSchema = z.strictObject({
  /** Quantidade de sessoes revogadas (1 em `logout`). */
  revokedSessions: z.number().int().nonnegative(),
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
