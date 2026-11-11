import { createRequire } from 'node:module';
/**
 * Ponte para os workspaces. `tests/` nao e um workspace (nao tem node_modules proprio, entao
 * `@chameleon/*` nao resolve a partir daqui) e a regra de dependencias (tests/architecture/deps-lib.ts)
 * so restringe arquivos DENTRO de apps/* e packages/*. Por isso a suite importa por caminho relativo,
 * concentrado neste unico arquivo: o resto da suite importa daqui.
 *
 * Proibido aqui e na suite: `@prisma/*` (fronteira do Prisma, ADR-0008 item 3).
 */
// Aumento global de tipos do Express (req.auth, req.correlationId) usado por apps/api/src.
import type {} from '../../../../apps/api/src/http/express';

export {
  GLOBAL_MODELS,
  OwnerScopeViolationError,
  PRIVATE_MODELS,
  UnscopedAccessError,
  createDb,
  isPrivateModel,
} from '../../../../packages/db/src';
export type { Db, PrivateModelName } from '../../../../packages/db/src';
export { createTestDb } from '../../../../packages/db/src/testing';
export type { TestDb } from '../../../../packages/db/src/testing';
export type { AuthSessionResponse } from '../../../../packages/contracts/src';
export { buildBaseResume, parseBaseCv } from '../../../../packages/domain/src';

// Helpers de teste da API (S1.2) e superficie publica usada para o manifesto de rotas.
export {
  LogCapture,
  TEST_PASSWORD,
  TEST_SIGNUP_CONSENTS,
  TestClient,
  buildTestApp,
  createTestAccount,
  createTwoAccounts,
  scriptedProvider,
  testConfig,
} from '../../../../apps/api/test/helpers';
export { createAiService } from '../../../../apps/api/src/ai/service';
export type { TestAccount, TestApp, TestResponse } from '../../../../apps/api/test/helpers';
export { getRouteManifest, requireAuthContext } from '../../../../apps/api/src';
export type { ApiModule, RouteManifestEntry } from '../../../../apps/api/src';
export { createInvite } from '../../../../apps/api/src/auth/invites';

export { generateToken, hashToken } from '../../../../apps/api/src/auth/tokens';

// `express` so resolve a partir de apps/api: usado apenas para montar um router "fora do registro"
// nos autotestes do gate (a API real nunca faz isso).
interface StrayRouter {
  get(path: string, handler: (req: unknown, res: { json(body: unknown): void }) => void): void;
}
export function createStrayRouter(): StrayRouter {
  const requireFromApi = createRequire(
    new URL('../../../../apps/api/package.json', import.meta.url),
  );
  const express = requireFromApi('express') as { Router(): StrayRouter };
  return express.Router();
}
