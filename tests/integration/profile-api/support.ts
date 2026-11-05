import {
  buildTestApp,
  createTestAccount,
  createTestDb,
  type TestAccount,
  type TestApp,
  type TestDb,
  type TestResponse,
} from '../isolation/support/workspace';

/**
 * Bridge for the profile API suite (S2.1a). `tests/` is not a workspace, so everything comes from the
 * isolation bridge or by relative path (allowed here; the dependency rule only restricts apps/* and packages/*).
 */
export {
  createTestAccount,
  importProfile,
  listProfileIds,
  listV2ProfileIds,
  loadProfileYaml,
  type TestAccount,
  type TestApp,
  type TestDb,
  type TestResponse,
} from '../isolation/support/workspace';
export { loadProfile, serializeProfile } from '../../../packages/profile-io/src';
export {
  edgeProfilePath,
  listEdgeProfiles,
  loadEdgeProfileYaml,
} from '../../../packages/test-fixtures/src';

export interface ProfileWorld {
  testDb: TestDb;
  built: TestApp;
  newAccount(label: string): Promise<TestAccount>;
  /**
   * Another app (different module limits) over the SAME database: no extra database clone. Its `drop` is a
   * no-op; the owner world drops the database.
   */
  withApp(options: Parameters<typeof buildTestApp>[1]): ProfileWorld;
  drop(): Promise<void>;
}

let counter = 0;

function worldOver(
  testDb: TestDb,
  options: Parameters<typeof buildTestApp>[1],
  ownsDatabase: boolean,
): ProfileWorld {
  const built = buildTestApp(testDb.db, options);
  return {
    testDb,
    built,
    newAccount: (label) => {
      counter += 1;
      return createTestAccount(
        { app: built.app, config: built.config, db: testDb.db },
        { email: `${label}-${counter}@example.test` },
      );
    },
    withApp: (extra) => worldOver(testDb, extra, false),
    drop: () => (ownsDatabase ? testDb.drop() : Promise.resolve()),
  };
}

export async function createProfileWorld(
  options: Parameters<typeof buildTestApp>[1] = {},
): Promise<ProfileWorld> {
  return worldOver(await createTestDb(), options, true);
}

export type Body = Record<string, unknown>;
export const bodyOf = (response: TestResponse): Body => response.body as Body;

/** `{status, error: {code, message, details}}` without the per-request `requestId`: the shape clients depend on. */
export function errorShape(response: TestResponse): unknown {
  const error = (bodyOf(response).error ?? {}) as Record<string, unknown>;
  const { requestId: _ignored, ...rest } = error;
  return { status: response.status, error: rest };
}
