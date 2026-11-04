import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  authSessionResponseSchema,
  invitePreviewRequestSchema,
  invitePreviewResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type AuthSessionResponse,
  type InvitePreviewResponse,
  type LoginRequest,
  type LoginResponse,
  type LogoutResponse,
} from '@chameleon/contracts';
import { createApiClient, type ApiClient } from './client';
import { ApiError, isApiError } from './errors';

/** Valida a requisicao com o schema do contrato antes de enviar (falha local = VALIDATION_ERROR). */
function validated<T>(
  schema: { safeParse(data: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError({ code: 'VALIDATION_ERROR', status: 0 });
  return result.data;
}

export interface AuthApi {
  /** Sessao atual, ou `null` quando nao autenticado (401). Tambem faz o servidor emitir o CSRF. */
  getSession(signal?: AbortSignal): Promise<AuthSessionResponse | null>;
  login(input: LoginRequest): Promise<LoginResponse>;
  previewInvite(token: string, signal?: AbortSignal): Promise<InvitePreviewResponse>;
  acceptInvite(input: AcceptInviteRequest): Promise<AcceptInviteResponse>;
  logout(): Promise<LogoutResponse>;
  logoutAll(): Promise<LogoutResponse>;
}

export function createAuthApi(client: ApiClient): AuthApi {
  return {
    async getSession(signal) {
      try {
        return await client.get('/api/auth/me', { schema: authSessionResponseSchema, signal });
      } catch (error) {
        if (isApiError(error, 'UNAUTHENTICATED')) return null;
        throw error;
      }
    },
    async login(input) {
      const body = validated(loginRequestSchema, input);
      return await client.post('/api/auth/login', { body, schema: loginResponseSchema });
    },
    async previewInvite(token, signal) {
      const body = validated(invitePreviewRequestSchema, { token });
      return await client.post('/api/auth/invites/preview', {
        body,
        schema: invitePreviewResponseSchema,
        signal,
      });
    },
    async acceptInvite(input) {
      const body = validated(acceptInviteRequestSchema, input);
      return await client.post('/api/auth/invites/accept', {
        body,
        schema: acceptInviteResponseSchema,
      });
    },
    logout() {
      return client.post('/api/auth/logout', { schema: logoutResponseSchema });
    },
    logoutAll() {
      return client.post('/api/auth/logout-all', { schema: logoutResponseSchema });
    },
  };
}

/** Instancia da aplicacao: mesma origem (proxy do Vite em dev), cookies same-origin. */
export const authApi: AuthApi = createAuthApi(createApiClient());
