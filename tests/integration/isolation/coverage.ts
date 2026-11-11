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
/** One A x B case covers the whole professional-base module (see cross-cases.ts). */
const PROFILE_CASE = 'profile.api/cross-owner-behaves-like-not-found';

/** P1: one A x B case covers the whole jobs module (see cross-cases.ts). */
const JOBS_CASE = 'jobs.api/cross-owner-behaves-like-not-found';
/** P3/P4: one A x B case covers the resumes routes (see cross-cases.ts). */
const RESUMES_CASE = 'resumes.api/cross-owner-behaves-like-not-found';

/** IA: status and consent are per owner (see cross-cases.ts). */
const AI_CASE = 'ai.api/status-and-consent-never-cross-owners';

export const ROUTE_COVERAGE: CoverageMap = {
  'GET /api/ai': { kind: 'cross-case', caseId: AI_CASE },
  'PUT /api/ai/consent': { kind: 'cross-case', caseId: AI_CASE },
  'GET /api/jobs': { kind: 'cross-case', caseId: JOBS_CASE },
  'POST /api/jobs': { kind: 'cross-case', caseId: JOBS_CASE },
  'GET /api/jobs/:jobId': { kind: 'cross-case', caseId: JOBS_CASE },
  'PATCH /api/jobs/:jobId': { kind: 'cross-case', caseId: JOBS_CASE },
  'DELETE /api/jobs/:jobId': { kind: 'cross-case', caseId: JOBS_CASE },
  'POST /api/jobs/:jobId/resumes': { kind: 'cross-case', caseId: RESUMES_CASE },
  'GET /api/jobs/:jobId/resumes': { kind: 'cross-case', caseId: RESUMES_CASE },
  'GET /api/resumes/:resumeId': { kind: 'cross-case', caseId: RESUMES_CASE },
  'PATCH /api/resumes/:resumeId': { kind: 'cross-case', caseId: RESUMES_CASE },
  'DELETE /api/resumes/:resumeId': { kind: 'cross-case', caseId: RESUMES_CASE },
  'GET /api/resumes/:resumeId/versions/:versionId': { kind: 'cross-case', caseId: RESUMES_CASE },
  'PUT /api/resumes/:resumeId/versions/:versionId': { kind: 'cross-case', caseId: RESUMES_CASE },
  'POST /api/resumes/:resumeId/versions/:versionId/approve': {
    kind: 'cross-case',
    caseId: RESUMES_CASE,
  },
  'GET /api/resumes/:resumeId/versions/:versionId/export': {
    kind: 'cross-case',
    caseId: RESUMES_CASE,
  },
  'POST /api/resumes/:resumeId/versions': { kind: 'cross-case', caseId: RESUMES_CASE },
  'GET /api/jobs/:jobId/analysis': { kind: 'cross-case', caseId: JOBS_CASE },
  'POST /api/jobs/:jobId/analysis': { kind: 'cross-case', caseId: JOBS_CASE },
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
  'GET /api/profile': { kind: 'cross-case', caseId: PROFILE_CASE },
  'PUT /api/profile': { kind: 'cross-case', caseId: PROFILE_CASE },
  'POST /api/profile/reading': { kind: 'cross-case', caseId: PROFILE_CASE },
  'GET /api/profile/revisions': { kind: 'cross-case', caseId: PROFILE_CASE },
  'GET /api/profile/revisions/:revisionId': { kind: 'cross-case', caseId: PROFILE_CASE },
  'POST /api/profile/revisions/:revisionId/restore': { kind: 'cross-case', caseId: PROFILE_CASE },
};
