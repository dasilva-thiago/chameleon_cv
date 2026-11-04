import type { CoverageMap } from './support/gate';

/**
 * Manifesto de cobertura do gate de rotas (ADR-0008 item 5b): rota -> caso cruzado A/B.
 *
 * - A chave e `METHOD /caminho/completo/:param`, exatamente como `getRouteManifest(app)` a lista.
 * - `cross-case`: aponta para um id de `cross-cases.ts` (que declara a rota e e executado por
 *   http-cross-owner.test.ts). OBRIGATORIO para rota com parametro de recurso e para rota que exige sessao.
 * - `no-private-data`: so para rota publica, sem parametro e que nao muta estado, com justificativa.
 *
 * Adicionou uma rota? O route-gate.test.ts falha ate que ela apareca aqui. Ver README.md.
 */
export const ROUTE_COVERAGE: CoverageMap = {
  'GET /health': {
    kind: 'no-private-data',
    reason: 'Liveness publico: resposta constante { status: "ok" }, sem sessao nem banco.',
  },
  'GET /api/health': {
    kind: 'no-private-data',
    reason: 'Liveness publico: resposta constante { status: "ok" }, sem sessao nem banco.',
  },
  'GET /api/auth/me': { kind: 'cross-case', caseId: 'auth.me/session-never-crosses-owners' },
  'POST /api/auth/login': {
    kind: 'cross-case',
    caseId: 'auth.login/credentials-never-cross-accounts',
  },
  'POST /api/auth/logout': { kind: 'cross-case', caseId: 'auth.logout/revokes-only-own-session' },
  'POST /api/auth/logout-all': {
    kind: 'cross-case',
    caseId: 'auth.logout-all/revokes-only-own-sessions',
  },
  'POST /api/auth/invites/preview': {
    kind: 'cross-case',
    caseId: 'auth.invites/tokens-are-single-use-and-not-an-oracle',
  },
  'POST /api/auth/invites/accept': {
    kind: 'cross-case',
    caseId: 'auth.invites/tokens-are-single-use-and-not-an-oracle',
  },
};
