import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildProfileSnapshot,
  createProfileStore,
  createTestDb,
  fixtureDocument,
  listV2ProfileIds,
  testSnapshot,
  type ProfileStore,
  type SnapshotBuilder,
  type TestDb,
} from './isolation/support/workspace';

/**
 * Equivalencia permanente de hash (ADR-0006 itens 4-5). `packages/db` NAO pode importar
 * `@chameleon/domain` (tests/architecture/deps-lib.ts: db -> contracts apenas), entao recebe o
 * construtor de snapshot por injecao e seus proprios testes usam um helper INDEPENDENTE (JCS +
 * node:crypto, packages/db/test/support/snapshot.ts). Este arquivo mora em `tests/` (nao e workspace:
 * a regra de matriz so se aplica a apps/* e packages/*) e prova que as DUAS implementacoes produzem o
 * mesmo hash/snapshot para as 12 fixtures v2, tanto em memoria quanto via `createProfileStore`.
 */
const FIXTURES = listV2ProfileIds();

describe('buildProfileSnapshot (@chameleon/domain) == helper independente do db', () => {
  it('ha 12 fixtures v2', () => {
    expect(FIXTURES).toHaveLength(12);
  });

  it.each([...FIXTURES])('%s: mesmo hash, mesma versao e mesmo documento canonico', (id) => {
    const document = fixtureDocument(id);
    const domain = buildProfileSnapshot(document);
    const independent = testSnapshot(document);
    expect(domain.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(independent.contentHash).toBe(domain.contentHash);
    expect(independent.schemaVersion).toBe(domain.schemaVersion);
    expect(independent.document).toEqual(domain.document);
  });

  it('os 12 hashes sao distintos (sem colisao entre perfis diferentes)', () => {
    const hashes = FIXTURES.map((id) => buildProfileSnapshot(fixtureDocument(id)).contentHash);
    expect(new Set(hashes).size).toBe(FIXTURES.length);
  });
});

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Reordena as chaves de TODOS os objetos (ordem reversa), preservando a ordem das listas. */
function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, inner]) => [key, reorderKeys(inner)]),
    );
  }
  return value;
}

/** Caminho do primeiro texto nao vazio dentro de `profile.identity` / `positioning` (campo de conteudo). */
function firstStringLeaf(
  value: unknown,
  path: (string | number)[] = [],
): (string | number)[] | null {
  if (typeof value === 'string' && value.length > 0) return path;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = firstStringLeaf(item, [...path, i]);
      if (found) return found;
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'id') continue;
      const found = firstStringLeaf(item, [...path, key]);
      if (found) return found;
    }
  }
  return null;
}

function setAt(root: unknown, path: (string | number)[], value: Json): void {
  let node = root as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path[path.length - 1]!] = value;
}

describe.each([
  ['domain (buildProfileSnapshot)', buildProfileSnapshot],
  ['independente (db/test/support)', testSnapshot],
] as [string, SnapshotBuilder][])('sensibilidade do hash: %s', (_name, build) => {
  it.each([...FIXTURES])('%s: alterar UM campo muda o hash; reordenar chaves nao muda', (id) => {
    const document = fixtureDocument(id);
    const base = build(document).contentHash;

    // reordenar chaves (objetos inteiros, em profundidade) nao altera o hash
    const reordered = reorderKeys(structuredClone(document)) as typeof document;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(document)); // o teste realmente reordenou
    expect(build(reordered).contentHash).toBe(base);

    // alterar um campo de conteudo muda o hash
    const changed = structuredClone(document);
    const path = firstStringLeaf(changed.profile);
    expect(path, `${id}: sem texto para alterar`).not.toBeNull();
    const target = ['profile', ...path!];
    setAt(changed, target, 'valor alterado pela QA');
    expect(build(changed).contentHash).not.toBe(base);
  });

  it('semantica de ausencia (ADR-0005): [] difere de ausente; chave null equivale a ausente', () => {
    const document = fixtureDocument('minimal-partial');
    const withoutAwards = structuredClone(document);
    delete (withoutAwards.profile as Record<string, unknown>).awards;
    const emptyAwards = structuredClone(document);
    (emptyAwards.profile as Record<string, unknown>).awards = [];
    const nullAwards = structuredClone(document);
    (nullAwards.profile as Record<string, unknown>).awards = null;

    const hash = (doc: typeof document) => build(doc).contentHash;
    expect(hash(emptyAwards)).not.toBe(hash(withoutAwards));
    expect(hash(nullAwards)).toBe(hash(withoutAwards));
  });

  it('o hash e estavel entre chamadas e nao muta a entrada', () => {
    const document = fixtureDocument('private-heavy');
    const frozen = JSON.stringify(document);
    const first = build(document).contentHash;
    expect(build(document).contentHash).toBe(first);
    expect(JSON.stringify(document)).toBe(frozen);
  });
});

describe('createProfileStore com cada construtor de snapshot (banco real)', () => {
  let testDb: TestDb;
  let withDomain: ProfileStore;
  let withIndependent: ProfileStore;
  beforeAll(async () => {
    testDb = await createTestDb();
    withDomain = createProfileStore(testDb.db, { snapshot: buildProfileSnapshot });
    withIndependent = createProfileStore(testDb.db, { snapshot: testSnapshot });
  }, 120_000);
  afterAll(async () => {
    await testDb?.drop();
  });

  it.each([...FIXTURES])(
    '%s: revisao gravada por um construtor e reconhecida pelo outro',
    async (id) => {
      const user = await testDb.db.global.user.create({
        data: { email: `${randomUUID().slice(0, 8)}@example.test` },
      });
      const document = fixtureDocument(id);
      await withDomain.saveProfileDocument(user.id, document);

      const created = await withDomain.createRevision(user.id, { reason: 'manual_save' });
      expect(created.reused).toBe(false);

      // O outro construtor chega ao MESMO hash: a revisao e reutilizada (nao cria uma segunda).
      const again = await withIndependent.createRevision(user.id, { reason: 'manual_save' });
      expect(again.reused).toBe(true);
      expect(again.revision.id).toBe(created.revision.id);
      expect(again.revision.contentHash).toBe(created.revision.contentHash);

      // Ambos validam o snapshot persistido contra o proprio hash.
      for (const store of [withDomain, withIndependent]) {
        const loaded = await store.getRevision(user.id, created.revision.id);
        expect(loaded?.verified).toBe(true);
        expect(loaded?.contentHash).toBe(created.revision.contentHash);
      }

      // O hash do snapshot persistido == hash do documento relido do banco (round-trip estavel).
      const reloaded = (await withDomain.loadProfileDocument(user.id))!.document;
      expect(buildProfileSnapshot(reloaded).contentHash).toBe(created.revision.contentHash);
      expect(testSnapshot(reloaded).contentHash).toBe(created.revision.contentHash);

      // Alterar um campo e salvar produz um novo hash e uma segunda revisao.
      const edited = structuredClone(reloaded);
      const path = firstStringLeaf(edited.profile)!;
      setAt(edited, ['profile', ...path], 'edicao da QA');
      await withDomain.saveProfileDocument(user.id, edited);
      const next = await withIndependent.createRevision(user.id, { reason: 'manual_save' });
      expect(next.reused).toBe(false);
      expect(next.revision.contentHash).not.toBe(created.revision.contentHash);
      expect(next.revision.revisionNumber).toBe(created.revision.revisionNumber + 1);
    },
  );

  it('um construtor com hash errado e detectado: verified=false (a verificacao nao e decorativa)', async () => {
    const user = await testDb.db.global.user.create({
      data: { email: `${randomUUID().slice(0, 8)}@example.test` },
    });
    await withDomain.saveProfileDocument(user.id, fixtureDocument('minimal-partial'));
    const { revision } = await withDomain.createRevision(user.id);
    const wrong: SnapshotBuilder = (document) => ({
      ...buildProfileSnapshot(document),
      contentHash: '0'.repeat(64),
    });
    const broken = createProfileStore(testDb.db, { snapshot: wrong });
    expect((await broken.getRevision(user.id, revision.id))?.verified).toBe(false);
  });
});
