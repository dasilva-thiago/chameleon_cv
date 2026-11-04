import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectNoLeaks, forbiddenFor, readEverythingAs } from './support/leaks';
import { assertLogsClean } from './support/logs';
import { ProfileStoreError } from './support/workspace';
import { createWorld, type World } from './support/world';

/**
 * ADR-0008 item 5(a): cada metodo do ProfileStore, chamado como B com ids de A, tem de se comportar
 * EXATAMENTE como se o recurso nao existisse (mesmo resultado/codigo/mensagem: sem oraculo de
 * existencia) e nao pode alterar nada de A.
 */
let world: World;
beforeAll(async () => {
  world = await createWorld();
}, 120_000);
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

/** Resultado normalizado de uma chamada: valor ou {code, message} do erro. */
async function outcome<T>(call: () => Promise<T>): Promise<unknown> {
  try {
    return { ok: await call() };
  } catch (error) {
    if (error instanceof ProfileStoreError) return { error: error.code, message: error.message };
    return { unexpected: error instanceof Error ? `${error.name}: ${error.message}` : error };
  }
}

describe('ProfileStore: B com ids de A == recurso inexistente', () => {
  it('load/list/get/idMap: mesmo resultado que um id inexistente e nada de A', async () => {
    const { store, a, b } = world;
    const ghost = randomUUID();
    const pairs: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
      [
        'loadProfileDocument',
        () => store.loadProfileDocument(b.ownerId, a.profileId),
        () => store.loadProfileDocument(b.ownerId, ghost),
      ],
      [
        'listRevisions',
        () => store.listRevisions(b.ownerId, { profileId: a.profileId }),
        () => store.listRevisions(b.ownerId, { profileId: ghost }),
      ],
      [
        'getRevision',
        () => store.getRevision(b.ownerId, a.revisionId),
        () => store.getRevision(b.ownerId, ghost),
      ],
      [
        'listImportRecords',
        () => store.listImportRecords(b.ownerId, { profileId: a.profileId }),
        () => store.listImportRecords(b.ownerId, { profileId: ghost }),
      ],
      [
        'getImportIdMap',
        () => store.getImportIdMap(b.ownerId, a.profileId),
        () => store.getImportIdMap(b.ownerId, ghost),
      ],
    ];
    for (const [name, cross, missing] of pairs) {
      const crossed = await outcome(cross);
      expect(crossed, name).toEqual(await outcome(missing));
      expect(JSON.stringify(crossed), `${name} vazou dado de A`).not.toContain(a.ownerId);
    }
    // o proprio A le tudo normalmente (controle positivo)
    expect(await store.loadProfileDocument(a.ownerId, a.profileId)).not.toBeNull();
    expect((await store.getRevision(a.ownerId, a.revisionId))?.verified).toBe(true);
    expect(Object.keys(await store.getImportIdMap(a.ownerId, a.profileId)).length).toBeGreaterThan(
      5,
    );
  });

  it('metodos que escrevem: erro identico ao recurso inexistente e A fica intacto', async () => {
    const { store, a, b } = world;
    const ghost = randomUUID();
    const before = await readEverythingAs(world, a);
    const bDocument = (await store.loadProfileDocument(b.ownerId))!.document;
    const importReport = {
      source_format: 'yaml' as const,
      source_schema_version: '2.1.0',
      target_schema_version: '2.1.0',
      mode: 'strict' as const,
      steps: [],
      warnings: [],
      errors: [],
      unmapped: [],
      id_map: {},
    };

    const pairs: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
      [
        'createRevision',
        () => store.createRevision(b.ownerId, { profileId: a.profileId }),
        () => store.createRevision(b.ownerId, { profileId: ghost }),
      ],
      [
        'createImportRecord',
        () => store.createImportRecord(b.ownerId, { report: importReport, profileId: a.profileId }),
        () => store.createImportRecord(b.ownerId, { report: importReport, profileId: ghost }),
      ],
      [
        'discardImport',
        () => store.discardImport(b.ownerId, a.previewImportId),
        () => store.discardImport(b.ownerId, ghost),
      ],
      [
        'applyImport (previa de A)',
        () =>
          store.applyImport(b.ownerId, {
            document: bDocument,
            report: importReport,
            importRecordId: a.previewImportId,
          }),
        () =>
          store.applyImport(b.ownerId, {
            document: bDocument,
            report: importReport,
            importRecordId: ghost,
          }),
      ],
      [
        'applyImport (perfil de A)',
        () =>
          store.applyImport(b.ownerId, {
            document: bDocument,
            report: importReport,
            profileId: a.profileId,
          }),
        () =>
          store.applyImport(b.ownerId, {
            document: bDocument,
            report: importReport,
            profileId: ghost,
          }),
      ],
      [
        'saveProfileDocument (perfil de A)',
        () => store.saveProfileDocument(b.ownerId, bDocument, { profileId: a.profileId }),
        () => store.saveProfileDocument(b.ownerId, bDocument, { profileId: ghost }),
      ],
    ];
    for (const [name, cross, missing] of pairs) {
      const crossed = (await outcome(cross)) as Record<string, unknown>;
      expect(
        crossed.error ?? crossed.unexpected,
        `${name}: deve falhar com erro de dominio`,
      ).toBeTruthy();
      expect(crossed, name).toEqual(await outcome(missing));
      expect(JSON.stringify(crossed)).not.toContain(a.ownerId);
    }
    expect(await readEverythingAs(world, a)).toBe(before);
    // e a previa de A continua em "preview" (B nao conseguiu descarta-la)
    const previews = await world.store.listImportRecords(a.ownerId, { status: 'preview' });
    expect(previews.map((p) => p.id)).toContain(a.previewImportId);
  });

  it('B grava o documento de A: ID_CONFLICT sem revelar de quem, A e B ficam intactos', async () => {
    const { store, a, b } = world;
    const aDocument = (await store.loadProfileDocument(a.ownerId))!.document;
    const beforeA = await readEverythingAs(world, a);
    const beforeB = await readEverythingAs(world, b);

    const crossed = await outcome(() => store.saveProfileDocument(b.ownerId, aDocument));
    expect(crossed).toMatchObject({ error: 'ID_CONFLICT' });
    expect(JSON.stringify(crossed)).not.toMatch(new RegExp(a.ownerId, 'i'));
    for (const canary of a.canaries) expect(JSON.stringify(crossed)).not.toContain(canary);
    expect(JSON.stringify(crossed)).not.toMatch(/Experience|Evidence|ProfileFact/);

    expect(await readEverythingAs(world, a)).toBe(beforeA);
    expect(await readEverythingAs(world, b)).toBe(beforeB);
  });

  it('referencias de B a ids de A (evidence_ids/supports) sao rejeitadas e nao criam vinculo', async () => {
    const { store, a, b, testDb } = world;
    const aDocument = (await store.loadProfileDocument(a.ownerId))!.document;
    const aEvidenceId = aDocument.profile.evidence?.[0]?.id;
    const aExperienceId = aDocument.profile.experiences?.[0]?.id;
    expect(aEvidenceId && aExperienceId).toBeTruthy();

    const bLoaded = (await store.loadProfileDocument(b.ownerId))!;
    const attempts: Record<string, unknown>[] = [];
    const withEvidenceRef = structuredClone(bLoaded.document) as unknown as {
      profile: { experiences: { meta?: Record<string, unknown> }[] };
    };
    const bExperience = withEvidenceRef.profile.experiences[0];
    expect(bExperience).toBeTruthy();
    bExperience!.meta = { ...(bExperience!.meta ?? {}), evidence_ids: [aEvidenceId] };
    attempts.push(withEvidenceRef);

    const withSupports = structuredClone(bLoaded.document) as unknown as {
      profile: { evidence?: { id?: string; type: string; title: string; supports?: string[] }[] };
    };
    withSupports.profile.evidence = [
      ...(withSupports.profile.evidence ?? []),
      { id: randomUUID(), type: 'document', title: 'Evidencia de B', supports: [aExperienceId!] },
    ];
    attempts.push(withSupports);

    const beforeA = await readEverythingAs(world, a);
    for (const document of attempts) {
      let failure: unknown = null;
      try {
        await store.saveProfileDocument(b.ownerId, document);
      } catch (error) {
        failure = error;
      }
      expect(failure, 'o vinculo cruzado deveria ser rejeitado').not.toBeNull();
      // rejeitado pela validacao de integridade do contrato (referencia a id inexistente NO documento)
      expect((failure as Error).name).toBe('ProfileValidationError');
      expect(String((failure as Error).message)).not.toContain(a.ownerId);
      for (const canary of a.canaries) {
        expect(String((failure as Error).message)).not.toContain(canary);
      }
    }
    const { rows } = await testDb.sql<{ n: string }>(
      `SELECT count(*) AS n FROM "EvidenceLink" l
        WHERE l."ownerId" = $1::uuid
          AND (l."evidenceId" = $2::uuid OR l."factId" = $3::uuid)`,
      [b.ownerId, aEvidenceId, aExperienceId],
    );
    expect(rows[0]?.n).toBe('0');
    expect(await readEverythingAs(world, a)).toBe(beforeA);
  });

  it('o ProfileStore de B continua funcional e nao ve nada de A depois dos ataques', async () => {
    const { store, b } = world;
    const forbidden = await forbiddenFor(world, b);
    const text = await readEverythingAs(world, b);
    expectNoLeaks('leitura de B apos ataques', text, forbidden);
    const created = await store.createRevision(b.ownerId, { reason: 'pre_generation' });
    expect(created.revision.profileId).toBe(b.profileId);
  });
});
