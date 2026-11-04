import type { AcceptInviteRequest, AuthSessionResponse, LoginRequest } from '@chameleon/contracts';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { authApi } from '../../lib/api';
import { isApiError } from '../../lib/api/errors';

export const SESSION_KEY = ['auth', 'session'] as const;
export const NOTICE_KEY = ['auth', 'notice'] as const;

/** Aviso mostrado na tela de login depois de uma saida ou de uma sessao encerrada. */
export type AuthNotice =
  | { kind: 'expired' }
  | { kind: 'signed-out' }
  | { kind: 'signed-out-all'; revokedSessions: number };

/**
 * Quando qualquer requisicao autenticada responde 401, a sessao local e descartada. As rotas
 * protegidas observam `SESSION_KEY` e redirecionam para o login (tratamento global de 401).
 */
export function handleUnauthenticated(client: QueryClient): void {
  if (client.getQueryData(SESSION_KEY) === null) return;
  client.setQueryData(NOTICE_KEY, { kind: 'expired' } satisfies AuthNotice);
  client.setQueryData(SESSION_KEY, null);
}

function onGlobalError(client: QueryClient, error: unknown): void {
  if (isApiError(error, 'UNAUTHENTICATED')) handleUnauthenticated(client);
}

export function createAppQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => onGlobalError(client, error) }),
    mutationCache: new MutationCache({ onError: (error) => onGlobalError(client, error) }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => !isApiError(error) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  });
  return client;
}

/** `undefined` = ainda carregando; `null` = sem sessao; objeto = autenticado. */
export function useSession() {
  return useQuery<AuthSessionResponse | null>({
    queryKey: SESSION_KEY,
    queryFn: ({ signal }) => authApi.getSession(signal),
    staleTime: Infinity,
  });
}

export function useAuthNotice(): AuthNotice | undefined {
  const { data } = useQuery<AuthNotice | null>({
    queryKey: NOTICE_KEY,
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
  return data ?? undefined;
}

/** Troca de usuario: descarta qualquer dado em cache antes de gravar a nova sessao. */
function replaceSession(client: QueryClient, session: AuthSessionResponse | null): void {
  client.removeQueries({
    predicate: (query) =>
      query.queryKey[0] !== SESSION_KEY[0] || query.queryKey[1] === NOTICE_KEY[1],
  });
  client.setQueryData(SESSION_KEY, session);
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => authApi.login(input),
    onSuccess: (session) => {
      replaceSession(client, session);
    },
  });
}

export function useAcceptInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptInviteRequest) => authApi.acceptInvite(input),
    onSuccess: (session) => {
      replaceSession(client, session);
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      replaceSession(client, null);
      client.setQueryData(NOTICE_KEY, { kind: 'signed-out' } satisfies AuthNotice);
    },
  });
}

export function useLogoutAll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logoutAll(),
    onSuccess: ({ revokedSessions }) => {
      replaceSession(client, null);
      client.setQueryData(NOTICE_KEY, {
        kind: 'signed-out-all',
        revokedSessions,
      } satisfies AuthNotice);
    },
  });
}
