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
  ProfileStoreError,
  UnscopedAccessError,
  createDb,
  createProfileStore,
  isPrivateModel,
} from '../../../../packages/db/src';
export type {
  Db,
  PrivateModelName,
  ProfileStore,
  RevisionSummary,
  SnapshotBuilder,
} from '../../../../packages/db/src';
export { createTestDb } from '../../../../packages/db/src/testing';
export type { TestDb } from '../../../../packages/db/src/testing';
export type { AuthSessionResponse } from '../../../../packages/contracts/src';
export { buildProfileSnapshot } from '../../../../packages/domain/src';
export { importProfile } from '../../../../packages/profile-io/src';
export {
  listProfileCanaries,
  listV2ProfileIds,
  loadProfileYaml,
  listProfileIds,
} from '../../../../packages/test-fixtures/src';
export type { ProfileId } from '../../../../packages/test-fixtures/src';

// Helpers de teste da API (S1.2) e superficie publica usada para o manifesto de rotas.
export {
  LogCapture,
  TEST_PASSWORD,
  TestClient,
  buildTestApp,
  createTestAccount,
  createTwoAccounts,
  testConfig,
} from '../../../../apps/api/test/helpers';
export type { TestAccount, TestApp, TestResponse } from '../../../../apps/api/test/helpers';
export { getRouteManifest, requireAuthContext } from '../../../../apps/api/src';
export type { ApiModule, RouteManifestEntry } from '../../../../apps/api/src';
export { createInvite } from '../../../../apps/api/src/auth/invites';

// Helper INDEPENDENTE de snapshot do db (JCS + node:crypto) e documentos de fixture com UUIDs.
export { testSnapshot } from '../../../../packages/db/test/support/snapshot';
export { fixtureDocument } from '../../../../packages/db/test/support/profile-docs';
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
