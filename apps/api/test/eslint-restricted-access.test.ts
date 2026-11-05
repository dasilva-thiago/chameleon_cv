import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Lint probe for the restricted-access rules in eslint.config.js (ADR-0008 items 2 and 3): fixture
 * strings are linted through the ESLint API with the repository's real config, as if they lived in
 * a given file. `.mjs` paths keep the probe off the (slow) type-aware project service; the
 * restricted-syntax rules are not type aware.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: ROOT });

async function violations(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}${filePath}` });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-syntax')
    .map((m) => m.message);
}

const MODULE_FILE = 'apps/api/src/modules/profiles/probe.mjs';
const AUTH_FILE = 'apps/api/src/auth/probe.mjs';
const DB_FILE = 'packages/db/src/probe.mjs';
const TEST_FILE = 'apps/api/test/probe.mjs';

/** Every way of reaching an unrestricted handle or raw SQL that the rule must flag in a module. */
const FORBIDDEN: Record<string, string> = {
  'db.global': 'db.global.user.findMany();',
  'db.unsafeRaw': 'db.unsafeRaw.session.findMany();',
  'optional chaining': 'db?.global.user.findMany();',
  'nested object': 'this.deps.db.unsafeRaw.session.findMany();',
  "computed string 'unsafeRaw'": "db['unsafeRaw'].session.findMany();",
  "computed string 'global'": "db['global'].user.findMany();",
  'computed template literal': 'db[`unsafeRaw`].session.findMany();',
  $queryRaw: 'db.$queryRaw`select 1`;',
  $queryRawUnsafe: 'db.$queryRawUnsafe("select 1");',
  "computed '$queryRawUnsafe'": "db['$queryRawUnsafe']('select 1');",
  $executeRaw: 'db.$executeRaw`select 1`;',
  $executeRawUnsafe: 'db.$executeRawUnsafe("select 1");',
  $queryRawTyped: 'db.$queryRawTyped(sql);',
  $runCommandRaw: 'db.$runCommandRaw({});',
  'dynamic key on a db object': 'db[key].findMany();',
  'dynamic key on a nested db object': 'this.deps.db[key].findMany();',
  'destructuring global': 'const { global } = db;',
  'destructuring unsafeRaw renamed': 'const { unsafeRaw: raw } = db;',
  'destructuring quoted key': "const { 'global': g } = db;",
  'destructuring computed key': "const { ['unsafeRaw']: raw } = db;",
  'destructuring $queryRaw': 'const { $queryRaw } = db;',
  'destructured parameter': 'function f({ unsafeRaw }) { return unsafeRaw; }',
};

describe('restricted database access lint rules', () => {
  beforeAll(async () => {
    // Sanity: the harness reports a violation at all (guards against a silently empty config).
    expect(await violations('db.global.user.findMany();', MODULE_FILE)).not.toEqual([]);
  }, 60_000);

  for (const [name, code] of Object.entries(FORBIDDEN)) {
    it(`flags ${name} in a domain module`, async () => {
      expect(await violations(code, MODULE_FILE), code).not.toEqual([]);
    });
  }

  it('flags the same forms in other production code (web, packages)', async () => {
    for (const file of ['apps/web/src/probe.mjs', 'packages/domain/src/probe.mjs']) {
      for (const code of Object.values(FORBIDDEN)) {
        expect(await violations(code, file), `${file}: ${code}`).not.toEqual([]);
      }
    }
  });

  it('allows the auth module and packages/db', async () => {
    for (const file of [AUTH_FILE, DB_FILE]) {
      for (const code of Object.values(FORBIDDEN)) {
        expect(await violations(code, file), `${file}: ${code}`).toEqual([]);
      }
    }
  });

  it('flags raw SQL members everywhere but packages/db and auth, tests included', async () => {
    expect(await violations('db.$queryRaw`select 1`;', TEST_FILE)).not.toEqual([]);
    expect(await violations("db['$executeRawUnsafe']('x');", TEST_FILE)).not.toEqual([]);
  });

  it('lets test files use the unrestricted client (db.global) to inspect state', async () => {
    expect(await violations('await testDb.db.global.invite.update({});', TEST_FILE)).toEqual([]);
  });

  it('does not flag ordinary code (no false positives)', async () => {
    const ok = [
      'const x = items[index];',
      'const y = map[key];',
      'const user = await req.auth.db.consentRecord.findFirst({});',
      'const scoped = db.forOwner(ownerId);',
      'const { forOwner } = db;',
      'const g = globalThis;',
    ].join('\n');
    expect(await violations(ok, MODULE_FILE)).toEqual([]);
  });
});
