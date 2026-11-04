import { randomUUID } from 'node:crypto';
import {
  canonicalizeProfileDocument,
  cloneJson,
  ProfileValidationError,
  type ImportReport,
  type ProfileDocument,
} from '@chameleon/contracts';
import { listProfileCanaries } from '@chameleon/test-fixtures';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createProfileStore,
  ProfileStoreError,
  type ProfileStore,
  type SaveResult,
} from '../src/profile-store';
import { createTestDb, type TestDb } from '../src/testing';
import {
  expectedAfterStore,
  fixtureDocument,
  freshIds,
  V2_FIXTURE_IDS,
} from './support/profile-docs';
import { testSnapshot } from './support/snapshot';

let testDb: TestDb;
let store: ProfileStore;

beforeAll(async () => {
  testDb = await createTestDb();
  store = createProfileStore(testDb.db, { snapshot: testSnapshot });
});
afterAll(async () => {
  await testDb.drop();
});
beforeEach(async () => {
  await testDb.truncateAll();
});

const makeUser = async (label = 'u') =>
  testDb.db.global.user.create({
    data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`, displayName: label },
  });

const wrap = (
  profile: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): ProfileDocument =>
  ({ schema_version: '2.1.0', ...extra, profile }) as unknown as ProfileDocument;

const countOf = async (table: string, ownerId: string): Promise<number> => {
  const { rows } = await testDb.sql<{ n: string }>(
    `SELECT count(*) AS n FROM "${table}" WHERE "ownerId" = $1`,
    [ownerId],
  );
  return Number(rows[0]?.n);
};

const loadDocument = async (ownerId: string): Promise<ProfileDocument> => {
  const loaded = await store.loadProfileDocument(ownerId);
  if (!loaded) throw new Error('perfil nao encontrado');
  return loaded.document;
};

describe('perfil parcial, vazio e semantica de ausencia (ADR-0005)', () => {
  it('perfil vazio e valido e volta vazio', async () => {
    const user = await makeUser();
    const saved = await store.saveProfileDocument(user.id, wrap({}));
    expect(saved.summary.totals).toMatchObject({ created: 0, updated: 0, unchanged: 0 });
    expect(await loadDocument(user.id)).toEqual(wrap({}));
  });

  it('[] ("nenhum item") e diferente de ausente, em colecoes e em listas internas', async () => {
    const user = await makeUser();
    const experienceId = randomUUID();
    const projectId = randomUUID();
    const document = wrap({
      experiences: [],
      awards: [],
      projects: [
        {
          id: projectId,
          name: 'P',
          items: [],
          collaborators: [],
          known_limitations: [],
        },
      ],
      education: [{ id: randomUUID(), institution: 'Escola', relevant_coursework: [] }],
      usage_rules: { restrictions: [] },
      identity: {},
    });
    await store.saveProfileDocument(user.id, document);
    const loaded = await loadDocument(user.id);
    expect(loaded).toEqual(document);
    expect(loaded.profile.experiences).toEqual([]);
    expect(loaded.profile.skills).toBeUndefined();
    expect(experienceId).toBeDefined();
  });

  it('colecao [] deixa de constar quando passa a ter registros e volta ao esvaziar', async () => {
    const user = await makeUser();
    await store.saveProfileDocument(user.id, wrap({ education: [] }));
    const id = randomUUID();
    await store.saveProfileDocument(user.id, wrap({ education: [{ id, institution: 'X' }] }));
    expect((await loadDocument(user.id)).profile.education).toHaveLength(1);
    await store.saveProfileDocument(user.id, wrap({ education: [] }), { onMissing: 'delete' });
    expect((await loadDocument(user.id)).profile.education).toEqual([]);
  });

  it('registro sem meta nao ganha meta na leitura; governanca efetiva e a mais restritiva', async () => {
    const user = await makeUser();
    const id = randomUUID();
    await store.saveProfileDocument(user.id, wrap({ courses: [{ id, name: 'Curso' }] }));
    expect((await loadDocument(user.id)).profile.courses?.[0]).toEqual({ id, name: 'Curso' });
    const { rows } = await testDb.sql(
      `SELECT "status", "visibility", "resumeUse", "source", "metaPresent" FROM "ProfileFact" WHERE "id" = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      status: 'needs_review',
      visibility: 'private',
      resumeUse: 'requires_approval',
      source: 'other',
      metaPresent: false,
    });
  });

  it('meta parcial e vazio voltam exatamente como declarados', async () => {
    const user = await makeUser();
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    const document = wrap({
      courses: [
        { id: a, name: 'A', meta: {} },
        { id: b, name: 'B', meta: { status: 'confirmed', evidence_ids: [], field_states: {} } },
        {
          id: c,
          name: 'C',
          meta: {
            status: 'conflicting',
            declared_status: 'confirmed',
            source_detail: 'doc.pdf p.1',
          },
        },
      ],
    });
    await store.saveProfileDocument(user.id, document);
    expect(await loadDocument(user.id)).toEqual(document);
  });

  it('ordem das colecoes e dos itens e preservada (nao depende do banco)', async () => {
    const user = await makeUser();
    const ids = Array.from({ length: 12 }, () => randomUUID());
    const itemIds = Array.from({ length: 8 }, () => randomUUID());
    const experienceId = randomUUID();
    const document = wrap({
      courses: [...ids].reverse().map((id, index) => ({ id, name: `Curso ${index}` })),
      experiences: [
        {
          id: experienceId,
          official_title: 'T',
          items: itemIds.map((id, index) => ({
            id,
            kind: 'responsibility',
            text: `Item ${index}`,
          })),
        },
      ],
    });
    await store.saveProfileDocument(user.id, document);
    expect(await loadDocument(user.id)).toEqual(document);
  });
});

describe('campos do contrato 2.1.0 e casos de borda', () => {
  it('telefone vai para a forma canonica; self_described_level nunca vira CEFR; field_states aninhados', async () => {
    const user = await makeUser();
    const experienceId = randomUUID();
    const itemId = randomUUID();
    const languageId = randomUUID();
    const document = wrap({
      contact_points: [
        { id: randomUUID(), kind: 'phone', subtype: 'mobile', value: '+55 (12) 91234-5678' },
        { id: randomUUID(), kind: 'phone', value: '(415) 555-2671' },
        { id: randomUUID(), kind: 'phone', value: '00351 912 345 678' },
      ],
      languages: [
        {
          id: languageId,
          language: 'Ingles',
          self_described_level: 'avancado',
          overall_level: 'B2',
        },
        { id: randomUUID(), language: 'Espanhol', self_described_level: 'nivel medio' },
      ],
      experiences: [
        {
          id: experienceId,
          official_title: 'Analista',
          business: { activity: 'consultoria' },
          items: [
            {
              id: itemId,
              kind: 'achievement',
              text: 'Reduzi o tempo de atendimento',
              metric: { name: 'Tempo', baseline: '2h' },
              meta: { field_states: { 'metric.value': 'needs_confirmation' } },
            },
          ],
          meta: {
            field_states: { end_date: 'not_applicable', 'business.portfolio_url': 'declined' },
          },
        },
      ],
    });
    const saved = await store.saveProfileDocument(user.id, document);
    expect(saved.phonesNormalized).toBe(3);
    const loaded = await loadDocument(user.id);
    expect(loaded.profile.contact_points?.map((c) => c.value)).toEqual([
      '+5512912345678',
      '4155552671',
      '+351912345678',
    ]);
    expect(loaded).toEqual(expectedAfterStore(document));
    const language = loaded.profile.languages?.[0];
    expect(language?.self_described_level).toBe('avancado');
    expect(language?.overall_level).toBe('B2');
    expect(loaded.profile.languages?.[1]).toMatchObject({ self_described_level: 'nivel medio' });
    expect(loaded.profile.languages?.[1]?.overall_level).toBeUndefined();
    const { rows } = await testDb.sql<{ fieldStates: unknown }>(
      `SELECT "fieldStates" FROM "ProfileFact" WHERE "id" = $1`,
      [itemId],
    );
    expect(rows[0]?.fieldStates).toEqual({ 'metric.value': 'needs_confirmation' });
  });

  it('textos longos, unicode e emoji sao preservados byte a byte', async () => {
    const user = await makeUser();
    const long = 'Responsável pela operação — ação, coração, 日本語, 😀🚀. '
      .repeat(150)
      .slice(0, 10_000);
    const document = wrap({
      statements: [{ id: randomUUID(), kind: 'full_summary', text: long }],
      education: [
        { id: randomUUID(), institution: 'Universidade de São Paulo — "USP" \'x\' \\ \n tab\t' },
      ],
    });
    await store.saveProfileDocument(user.id, document);
    expect(await loadDocument(user.id)).toEqual(document);
  });

  it('datas parciais: a precisao declarada e mantida, incluindo 29/02 e fim "present"', async () => {
    const user = await makeUser();
    const document = wrap({
      experiences: [
        { id: randomUUID(), official_title: 'A', start_date: '2004', end_date: '2006-03' },
        { id: randomUUID(), official_title: 'B', start_date: '2020-02-29', end_date: 'present' },
        { id: randomUUID(), official_title: 'C', start_date: '1999-12' },
      ],
    });
    await store.saveProfileDocument(user.id, document);
    const loaded = await loadDocument(user.id);
    expect(loaded).toEqual(document);
    const { rows } = await testDb.sql<{ startPrecision: string; isCurrent: boolean }>(
      `SELECT "startPrecision", "isCurrent" FROM "Experience" ORDER BY "startPrecision"`,
    );
    expect(rows.map((r) => r.startPrecision).sort()).toEqual(['day', 'month', 'year']);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
  });

  it('ids em maiusculas viram minusculas; ids ausentes sao gerados; referencias coerentes', async () => {
    const user = await makeUser();
    const skillId = randomUUID().toUpperCase();
    const document = wrap({
      skills: [{ id: skillId, name: 'SQL' }],
      skill_usages: [{ skill_id: skillId, usage_context: 'unverified' }],
      courses: [{ name: 'Sem id' }],
    });
    const saved = await store.saveProfileDocument(user.id, document);
    expect(saved.generatedIds).toBe(2);
    const loaded = await loadDocument(user.id);
    expect(loaded.profile.skills?.[0]?.id).toBe(skillId.toLowerCase());
    expect(loaded.profile.skill_usages?.[0]?.skill_id).toBe(skillId.toLowerCase());
    expect(loaded.profile.courses?.[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('referencias repetidas em listas sao colapsadas (limitacao documentada)', async () => {
    const user = await makeUser();
    const skillId = randomUUID();
    const exampleId = randomUUID();
    await store.saveProfileDocument(
      user.id,
      wrap({
        skills: [{ id: skillId, name: 'SQL' }],
        competency_examples: [
          { id: exampleId, competency: 'Dados', related_skill_ids: [skillId, skillId] },
        ],
      }),
    );
    expect(
      (await loadDocument(user.id)).profile.competency_examples?.[0]?.related_skill_ids,
    ).toEqual([skillId]);
  });

  it('competencias duplicadas (mesma chave normalizada) em gravacoes separadas -> DUPLICATE_SKILL', async () => {
    const user = await makeUser();
    await store.saveProfileDocument(
      user.id,
      wrap({ skills: [{ id: randomUUID(), name: 'Node.js' }] }),
    );
    await expect(
      store.saveProfileDocument(
        user.id,
        wrap({ skills: [{ id: randomUUID(), name: 'NODE.JS' }] }),
        { onMissing: 'keep' },
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SKILL' });
  });
});

describe('payloads invalidos e legados', () => {
  it('documento invalido nao grava nada', async () => {
    const user = await makeUser();
    await expect(
      store.saveProfileDocument(
        user.id,
        wrap({ education: [{ id: randomUUID(), institution: '' }] }),
      ),
    ).rejects.toBeInstanceOf(ProfileValidationError);
    await expect(
      store.saveProfileDocument(user.id, wrap({ typo_experinces: [] })),
    ).rejects.toBeInstanceOf(ProfileValidationError);
    await expect(
      store.saveProfileDocument(user.id, { schema_version: '1.0.0', profile: {} }),
    ).rejects.toBeInstanceOf(ProfileValidationError);
    await expect(
      store.saveProfileDocument(user.id, { schema_version: '2.0.0', profile: {} }),
    ).rejects.toBeInstanceOf(ProfileValidationError);
    await expect(store.saveProfileDocument(user.id, 'texto')).rejects.toBeInstanceOf(
      ProfileValidationError,
    );
    expect(await countOf('ProfessionalProfile', user.id)).toBe(0);
  });

  it('id local (nao UUID) e recusado com NON_UUID_ID e nada e gravado', async () => {
    const user = await makeUser();
    await expect(
      store.saveProfileDocument(
        user.id,
        wrap({ education: [{ id: 'EDU-001', institution: 'X' }] }),
      ),
    ).rejects.toMatchObject({ code: 'NON_UUID_ID' });
    expect(await countOf('ProfessionalProfile', user.id)).toBe(0);
  });

  it('referencia quebrada e recusada pelo contrato; falha no meio reverte a transacao inteira', async () => {
    const user = await makeUser();
    await expect(
      store.saveProfileDocument(
        user.id,
        wrap({
          skill_usages: [{ skill_id: randomUUID(), usage_context: 'unverified' }],
        }),
      ),
    ).rejects.toBeInstanceOf(ProfileValidationError);

    // falha provocada no banco no meio da gravacao (nome de competencia duplicado entre ids):
    const first = await store.saveProfileDocument(
      user.id,
      wrap({
        education: [{ id: randomUUID(), institution: 'Antes' }],
        skills: [{ id: randomUUID(), name: 'SQL' }],
      }),
    );
    await expect(
      store.saveProfileDocument(
        user.id,
        wrap({
          courses: [{ id: randomUUID(), name: 'Novo' }],
          skills: [{ id: randomUUID(), name: 'sql' }],
        }),
        { onMissing: 'keep' },
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SKILL' });
    expect(await countOf('Course', user.id)).toBe(0);
    expect(await countOf('Education', user.id)).toBe(1);
    expect(first.profileId).toBeDefined();
  });

  it('perfil gravado como 2.0.0 (legado) e lido como 2.1.0 corrente', async () => {
    const user = await makeUser();
    const saved = await store.saveProfileDocument(
      user.id,
      wrap({ identity: { full_name: 'Ana' } }),
    );
    await testDb.sql(`UPDATE "ProfessionalProfile" SET "schemaVersion" = '2.0.0' WHERE "id" = $1`, [
      saved.profileId,
    ]);
    const loaded = await store.loadProfileDocument(user.id);
    expect(loaded?.storedSchemaVersion).toBe('2.0.0');
    expect(loaded?.document.schema_version).toBe('2.1.0');
    expect(loaded?.document.profile.identity?.full_name).toBe('Ana');
  });

  it('perfil inexistente / de outro dono: PROFILE_NOT_FOUND ou null, sem diferenca', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const saved = await store.saveProfileDocument(a.id, wrap({ identity: { full_name: 'A' } }));
    expect(await store.loadProfileDocument(b.id)).toBeNull();
    expect(await store.loadProfileDocument(b.id, saved.profileId)).toBeNull();
    expect(await store.loadProfileDocument(b.id, randomUUID())).toBeNull();
    for (const profileId of [saved.profileId, randomUUID()]) {
      await expect(store.saveProfileDocument(b.id, wrap({}), { profileId })).rejects.toMatchObject({
        code: 'PROFILE_NOT_FOUND',
      });
      await expect(store.createRevision(b.id, { profileId })).rejects.toMatchObject({
        code: 'PROFILE_NOT_FOUND',
      });
    }
  });
});

describe('atualizacao, idempotencia e registros ausentes', () => {
  it('regravar o mesmo documento nao cria, nao altera e nao toca o perfil (idempotente)', async () => {
    const user = await makeUser();
    const document = fixtureDocument('non-tech-nurse');
    const first = await store.saveProfileDocument(user.id, document);
    const before = await store.loadProfileDocument(user.id);
    const second = await store.saveProfileDocument(user.id, document);
    const after = await store.loadProfileDocument(user.id);

    expect(second.profileCreated).toBe(false);
    expect(second.summary.totals.created).toBe(0);
    expect(second.summary.totals.updated).toBe(0);
    expect(second.summary.totals.archived + second.summary.totals.deleted).toBe(0);
    expect(second.summary.totals.unchanged).toBe(
      first.summary.totals.created + first.summary.totals.updated,
    );
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(after?.document).toEqual(before?.document);
  });

  it('alterar um campo atualiza apenas aquele registro', async () => {
    const user = await makeUser();
    const document = fixtureDocument('experienced-promotions-same-employer');
    const first = await store.saveProfileDocument(user.id, document);
    const edited = cloneJson(document);
    const experience = edited.profile.experiences?.[1];
    expect(experience).toBeDefined();
    if (experience) experience.display_title = 'Titulo editado';
    const second = await store.saveProfileDocument(user.id, edited);
    expect(second.summary.updated).toEqual({ experience: 1 });
    expect(second.summary.totals.created).toBe(0);
    expect(second.summary.totals.unchanged).toBe(first.summary.totals.created - 1);
    expect((await loadDocument(user.id)).profile.experiences?.[1]?.display_title).toBe(
      'Titulo editado',
    );
  });

  it('mudar status/visibilidade/uso persiste e marca confirmedAt/archivedAt', async () => {
    const user = await makeUser();
    const id = randomUUID();
    const document = wrap({
      courses: [
        {
          id,
          name: 'C',
          meta: { status: 'needs_review', visibility: 'public', resume_use: 'allowed' },
        },
      ],
    });
    await store.saveProfileDocument(user.id, document);
    const row = async () =>
      (
        await testDb.sql<{
          status: string;
          confirmedAt: Date | null;
          archivedAt: Date | null;
          visibility: string;
        }>(
          `SELECT "status", "confirmedAt", "archivedAt", "visibility" FROM "ProfileFact" WHERE "id" = $1`,
          [id],
        )
      ).rows[0]!;
    expect((await row()).confirmedAt).toBeNull();

    const confirmed = cloneJson(document);
    confirmed.profile.courses![0]!.meta = {
      status: 'confirmed',
      visibility: 'private',
      resume_use: 'allowed',
    };
    await store.saveProfileDocument(user.id, confirmed);
    const afterConfirm = await row();
    expect(afterConfirm.status).toBe('confirmed');
    expect(afterConfirm.visibility).toBe('private');
    expect(afterConfirm.confirmedAt).not.toBeNull();

    const archived = cloneJson(document);
    archived.profile.courses![0]!.meta = { status: 'archived', resume_use: 'never' };
    await store.saveProfileDocument(user.id, archived);
    const afterArchive = await row();
    expect(afterArchive.archivedAt).not.toBeNull();
    expect(afterArchive.confirmedAt).toBeNull();
  });

  it('onMissing: archive (padrao) arquiva fatos e remove nao-fatos; keep mantem; delete remove', async () => {
    const user = await makeUser();
    const keep = randomUUID();
    const gone = randomUUID();
    const contact = randomUUID();
    const full = wrap({
      courses: [
        { id: keep, name: 'Fica' },
        { id: gone, name: 'Sai', meta: { status: 'confirmed', resume_use: 'allowed' } },
      ],
      contact_points: [{ id: contact, kind: 'email', value: 'a@example.test' }],
    });
    await store.saveProfileDocument(user.id, full);
    const partial = wrap({ courses: [{ id: keep, name: 'Fica' }] });

    // keep (merge): nada some
    const merged = await store.saveProfileDocument(user.id, partial, { onMissing: 'keep' });
    expect(merged.summary.kept).toEqual({ course: 1, contact_point: 1 });
    expect((await loadDocument(user.id)).profile.courses).toHaveLength(2);

    // archive: fato arquivado com resume_use never; contato removido
    const archived = await store.saveProfileDocument(user.id, partial);
    expect(archived.summary.archived).toEqual({ course: 1 });
    expect(archived.summary.deleted).toEqual({ contact_point: 1 });
    const loaded = await loadDocument(user.id);
    expect(loaded.profile.contact_points).toBeUndefined();
    const archivedCourse = loaded.profile.courses?.find((c) => c.id === gone);
    expect(archivedCourse?.meta).toMatchObject({ status: 'archived', resume_use: 'never' });

    // regravar o mesmo documento nao arquiva de novo
    const again = await store.saveProfileDocument(user.id, partial);
    expect(again.summary.totals.archived).toBe(0);

    // delete: remocao definitiva do fato e da linha tipada
    const removed = await store.saveProfileDocument(user.id, partial, { onMissing: 'delete' });
    expect(removed.summary.deleted).toEqual({ course: 1 });
    expect((await loadDocument(user.id)).profile.courses).toHaveLength(1);
    expect(await countOf('Course', user.id)).toBe(1);
    expect(await countOf('ProfileFact', user.id)).toBe(1);
  });

  it('remover uma experiencia (delete) leva itens, usos e vinculos coerentes e nao deixa orfaos', async () => {
    const user = await makeUser();
    const document = fixtureDocument('experienced-promotions-same-employer');
    await store.saveProfileDocument(user.id, document);
    const trimmed = cloneJson(document);
    const removedExperience = trimmed.profile.experiences!.pop()!;
    // coerencia do contrato: usos e referencias que apontavam para ela saem junto
    const ids = new Set([
      removedExperience.id!,
      ...(removedExperience.items ?? []).map((i) => i.id!),
    ]);
    trimmed.profile.skill_usages = trimmed.profile.skill_usages?.filter(
      (u) => !u.experience_id || !ids.has(u.experience_id),
    );
    for (const project of trimmed.profile.projects ?? []) {
      if (project.related_experience_id && ids.has(project.related_experience_id))
        delete project.related_experience_id;
    }
    trimmed.profile.pending_items = trimmed.profile.pending_items?.filter(
      (p) => !p.target?.record_id || !ids.has(p.target.record_id),
    );
    trimmed.profile.usage_rules = trimmed.profile.usage_rules
      ? {
          ...trimmed.profile.usage_rules,
          restrictions: trimmed.profile.usage_rules.restrictions?.filter(
            (r) => !r.target.record_id || !ids.has(r.target.record_id),
          ),
        }
      : trimmed.profile.usage_rules;
    for (const evidence of trimmed.profile.evidence ?? []) {
      evidence.supports = evidence.supports?.filter((id) => !ids.has(id));
    }
    for (const record of [
      ...(trimmed.profile.experiences ?? []),
      ...(trimmed.profile.projects ?? []),
    ]) {
      if (record.meta?.evidence_ids) record.meta.evidence_ids = [...record.meta.evidence_ids];
    }
    const result = await store.saveProfileDocument(user.id, canonicalizeProfileDocument(trimmed), {
      onMissing: 'delete',
    });
    expect(result.summary.deleted.experience).toBe(1);
    const loaded = await loadDocument(user.id);
    expect(loaded.profile.experiences?.some((e) => e.id === removedExperience.id)).toBe(false);
    const { rows } = await testDb.sql<{ n: string }>(
      `SELECT count(*) AS n FROM "ProfileFact" f WHERE f."kind" = 'experience_item'
         AND NOT EXISTS (SELECT 1 FROM "ExperienceItem" i WHERE i."id" = f."id")`,
    );
    expect(rows[0]?.n).toBe('0');
  });
});

describe('revisoes imutaveis com hash canonico (ADR-0006)', () => {
  it('cria a revisao 1, reutiliza se o hash nao mudou e cria a 2 quando muda', async () => {
    const user = await makeUser();
    const document = fixtureDocument('career-changer-teacher-to-data');
    await store.saveProfileDocument(user.id, document);

    const first = await store.createRevision(user.id, { reason: 'manual_save' });
    expect(first.reused).toBe(false);
    expect(first.revision.revisionNumber).toBe(1);
    expect(first.revision.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.revision.schemaVersion).toBe('2.1.0');

    const again = await store.createRevision(user.id, { reason: 'pre_generation' });
    expect(again.reused).toBe(true);
    expect(again.revision.id).toBe(first.revision.id);

    const edited = cloneJson(document);
    edited.profile.identity = { ...edited.profile.identity, full_name: 'Nome Alterado' };
    await store.saveProfileDocument(user.id, edited);
    const second = await store.createRevision(user.id, { reason: 'pre_generation' });
    expect(second.reused).toBe(false);
    expect(second.revision.revisionNumber).toBe(2);
    expect(second.revision.contentHash).not.toBe(first.revision.contentHash);

    const list = await store.listRevisions(user.id);
    expect(list.map((r) => r.revisionNumber)).toEqual([2, 1]);
    expect(await store.listRevisions(user.id, { limit: 1, beforeRevisionNumber: 2 })).toHaveLength(
      1,
    );
  });

  it('o hash e estavel: igual ao do documento em memoria, ao recarregar e ao regravar do zero', async () => {
    const user = await makeUser();
    const document = fixtureDocument('non-tech-logistics');
    await store.saveProfileDocument(user.id, document);
    const { revision } = await store.createRevision(user.id);
    const expected = expectedAfterStore(document);
    expect(revision.contentHash).toBe(testSnapshot(expected).contentHash);

    // a revisao armazenada confere com o proprio hash e com a leitura atual
    const stored = await store.getRevision(user.id, revision.id);
    expect(stored?.verified).toBe(true);
    expect(stored?.snapshot).toEqual(expected);

    // do zero: apaga tudo (truncate) e regrava os MESMOS ids -> mesmo hash
    await testDb.truncateAll();
    const user2 = await makeUser('segundo');
    await store.saveProfileDocument(user2.id, document);
    const again = await store.createRevision(user2.id);
    expect(again.revision.contentHash).toBe(revision.contentHash);
  });

  it('o snapshot e uma copia: editar o perfil depois nao altera a revisao (Adendo 6.3)', async () => {
    const user = await makeUser();
    const document = fixtureDocument('student-no-employment');
    await store.saveProfileDocument(user.id, document);
    const { revision } = await store.createRevision(user.id);
    const before = await store.getRevision(user.id, revision.id);

    const edited = cloneJson(document);
    edited.profile.education![0]!.institution = 'Outra Instituicao';
    await store.saveProfileDocument(user.id, edited, { onMissing: 'delete' });

    const after = await store.getRevision(user.id, revision.id);
    expect(after?.snapshot).toEqual(before?.snapshot);
    expect(after?.verified).toBe(true);
    expect((await loadDocument(user.id)).profile.education?.[0]?.institution).toBe(
      'Outra Instituicao',
    );
  });

  it('salvar com revision cria a revisao na mesma transacao', async () => {
    const user = await makeUser();
    const saved = await store.saveProfileDocument(user.id, fixtureDocument('minimal-partial'), {
      revision: 'manual_save',
    });
    expect(saved.revision?.revision.revisionNumber).toBe(1);
    expect(saved.revision?.reused).toBe(false);
    const second = await store.saveProfileDocument(user.id, fixtureDocument('minimal-partial'), {
      revision: 'manual_save',
    });
    // ids diferentes (freshIds) => conteudo diferente => nova revisao
    expect(second.revision?.revision.revisionNumber).toBeGreaterThanOrEqual(1);
  });
});

describe('isolamento entre donos (ADR-0008) com canarios das fixtures', () => {
  it('um dono nunca ve dados, revisoes ou importacoes do outro via ProfileStore', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const docA = fixtureDocument('private-heavy');
    const docB = fixtureDocument('freelancer-confidential-clients');
    await store.saveProfileDocument(a.id, docA, { revision: 'manual_save' });
    await store.saveProfileDocument(b.id, docB, { revision: 'manual_save' });

    const canariesA = listProfileCanaries('private-heavy');
    const canariesB = listProfileCanaries('freelancer-confidential-clients');
    expect(canariesA.length).toBeGreaterThan(5);
    expect(canariesB.length).toBeGreaterThan(3);

    const ownerA = await store.loadProfileDocument(a.id);
    const ownerB = await store.loadProfileDocument(b.id);
    const jsonA = JSON.stringify(ownerA?.document);
    const jsonB = JSON.stringify(ownerB?.document);
    for (const canary of canariesA) {
      expect(jsonA).toContain(canary);
      expect(jsonB).not.toContain(canary);
    }
    for (const canary of canariesB) {
      expect(jsonB).toContain(canary);
      expect(jsonA).not.toContain(canary);
    }

    // revisoes: cada dono so lista e le as suas; o id do outro = nao encontrado (sem oraculo)
    const revisionsA = await store.listRevisions(a.id);
    const revisionsB = await store.listRevisions(b.id);
    expect(revisionsA).toHaveLength(1);
    expect(revisionsB).toHaveLength(1);
    expect(await store.getRevision(a.id, revisionsB[0]!.id)).toBeNull();
    expect(await store.getRevision(a.id, randomUUID())).toBeNull();
    const snapshotA = JSON.stringify((await store.getRevision(a.id, revisionsA[0]!.id))?.snapshot);
    for (const canary of canariesB) expect(snapshotA).not.toContain(canary);

    // importacoes
    const report = importReport({});
    const recordB = await store.createImportRecord(b.id, { report });
    expect(await store.listImportRecords(a.id)).toEqual([]);
    await expect(store.discardImport(a.id, recordB.id)).rejects.toMatchObject({
      code: 'IMPORT_NOT_FOUND',
    });
    await expect(
      store.applyImport(a.id, { document: docA, report, importRecordId: recordB.id }),
    ).rejects.toMatchObject({ code: 'IMPORT_NOT_FOUND' });

    // no banco: nenhuma linha de A carrega o ownerId de B e vice-versa (por tabela de fato)
    const { rows } = await testDb.sql<{ n: string }>(
      `SELECT count(*) AS n FROM "ProfileFact" f JOIN "ProfessionalProfile" p ON p."id" = f."profileId" WHERE p."ownerId" <> f."ownerId"`,
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('todas as fixtures v2 gravadas para o mesmo dono nao vazam entre perfis de donos diferentes', async () => {
    const owners = await Promise.all(
      V2_FIXTURE_IDS.map((id) => makeUser(id).then((user) => ({ id, user }))),
    );
    for (const { id, user } of owners) {
      await store.saveProfileDocument(user.id, fixtureDocument(id));
    }
    for (const { id, user } of owners) {
      const json = JSON.stringify((await store.loadProfileDocument(user.id))?.document);
      for (const other of owners) {
        if (other.id === id) continue;
        for (const canary of listProfileCanaries(other.id)) {
          expect(json, `${canary} de ${other.id} apareceu no perfil de ${id}`).not.toContain(
            canary,
          );
        }
      }
    }
  });
});

describe('ids ja usados por outro dono (arquivo exportado por outra pessoa)', () => {
  it('falha com ID_CONFLICT sem revelar de quem; com regenerateConflictingIds grava ids novos', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const document = fixtureDocument('imprecise-dates');
    await store.saveProfileDocument(a.id, document);

    const failure = await store.saveProfileDocument(b.id, document).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ProfileStoreError);
    expect((failure as ProfileStoreError).code).toBe('ID_CONFLICT');
    expect((failure as Error).message).not.toMatch(a.id);
    expect(await store.loadProfileDocument(b.id)).toBeNull();

    const saved = await store.saveProfileDocument(b.id, document, {
      regenerateConflictingIds: true,
    });
    expect(Object.keys(saved.idRemap).length).toBeGreaterThan(5);
    const loadedB = await loadDocument(b.id);
    const loadedA = await loadDocument(a.id);
    expect(loadedA).toEqual(expectedAfterStore(document));
    // mesmo conteudo, ids diferentes
    expect(JSON.stringify(loadedB)).not.toContain(document.profile.experiences![0]!.id!);
    expect(loadedB.profile.experiences).toHaveLength(document.profile.experiences!.length);
  });
});

function importReport(
  idMap: Record<string, string>,
  overrides: Partial<ImportReport> = {},
): ImportReport {
  return {
    source_format: 'yaml',
    source_schema_version: '2.0.0',
    target_schema_version: '2.1.0',
    mode: 'strict',
    steps: [
      { id: 'parse', from: null, to: 'object', description: 'Leitura de YAML', changes: 1 },
      {
        id: 'v2_0_0_to_v2_1_0',
        from: '2.0.0',
        to: '2.1.0',
        description: 'Atualizacao aditiva',
        changes: 0,
      },
    ],
    warnings: [
      {
        code: 'SCHEMA_VERSION_UPGRADED',
        severity: 'info',
        path: 'schema_version',
        message: '2.0.0 -> 2.1.0',
      },
      { code: 'ARCHIVED_STATUS_KEPT', severity: 'info', path: null, message: 'archived mantido' },
    ],
    errors: [],
    unmapped: [{ path: 'profile.extra', value: { x: 1 }, reason: 'lenient' }],
    id_map: idMap,
    ...overrides,
  };
}

describe('importacao: ImportRecord, id_map e reimportacao idempotente', () => {
  it('aplicar cria ImportRecord (versoes, passos, avisos, id_map), revisao e documento', async () => {
    const user = await makeUser();
    const document = fixtureDocument('conflicting-facts');
    const idMap = { 'EXP-001': document.profile.experiences![0]!.id! };
    const result = await store.applyImport(user.id, { document, report: importReport(idMap) });

    expect(result.importRecord.status).toBe('applied');
    expect(result.importRecord.sourceSchemaVersion).toBe('2.0.0');
    expect(result.importRecord.targetSchemaVersion).toBe('2.1.0');
    expect(result.importRecord.steps.map((s) => s.id)).toEqual(['parse', 'v2_0_0_to_v2_1_0']);
    expect(result.importRecord.warnings.map((w) => w.code)).toEqual([
      'SCHEMA_VERSION_UPGRADED',
      'ARCHIVED_STATUS_KEPT',
    ]);
    expect(result.importRecord.idMap).toEqual(idMap);
    expect(result.importRecord.unmapped).toHaveLength(1);
    expect(result.importRecord.revisionId).toBe(result.revision.revision.id);
    expect(result.importRecord.appliedAt).not.toBeNull();
    expect(result.importRecord.summary.totals?.created).toBeGreaterThan(10);
    expect(result.revision.revision.revisionNumber).toBe(1);
    expect(await loadDocument(user.id)).toEqual(expectedAfterStore(document));
    expect(await store.getImportIdMap(user.id)).toEqual(idMap);
  });

  it('reimportar o mesmo documento: 0 criados, 0 alterados, revisao reutilizada, novo ImportRecord', async () => {
    const user = await makeUser();
    const document = fixtureDocument('non-tech-nurse');
    const first = await store.applyImport(user.id, {
      document,
      report: importReport({ 'X-1': randomUUID() }),
    });
    const second = await store.applyImport(user.id, {
      document,
      report: importReport({ 'X-2': randomUUID() }),
    });

    expect(first.save.summary.totals.created).toBeGreaterThan(10);
    expect(second.save.summary.totals.created).toBe(0);
    expect(second.save.summary.totals.updated).toBe(0);
    expect(second.save.summary.totals.deleted + second.save.summary.totals.archived).toBe(0);
    expect(second.revision.reused).toBe(true);
    expect(second.revision.revision.id).toBe(first.revision.revision.id);
    expect(await store.listImportRecords(user.id)).toHaveLength(2);
    // ids locais de importacoes anteriores acumulam (para o existingIdMap do profile-io)
    expect(Object.keys(await store.getImportIdMap(user.id)).sort()).toEqual(['X-1', 'X-2']);
  });

  it('modo merge preserva o que o arquivo omite; replace arquiva', async () => {
    const user = await makeUser();
    const base = wrap({
      courses: [
        { id: randomUUID(), name: 'Um' },
        { id: randomUUID(), name: 'Dois' },
      ],
    });
    await store.applyImport(user.id, { document: base, report: importReport({}) });
    const onlyOne = wrap({ courses: [base.profile.courses![0]!] });

    const merged = await store.applyImport(user.id, {
      document: onlyOne,
      report: importReport({}),
    });
    expect(merged.save.summary.kept).toEqual({ course: 1 });
    expect((await loadDocument(user.id)).profile.courses).toHaveLength(2);

    const replaced = await store.applyImport(user.id, {
      document: onlyOne,
      report: importReport({}),
      mode: 'replace',
    });
    expect(replaced.save.summary.archived).toEqual({ course: 1 });
    const courses = (await loadDocument(user.id)).profile.courses ?? [];
    expect(courses.find((c) => c.name === 'Dois')?.meta).toMatchObject({ status: 'archived' });
  });

  it('previa -> aplicar -> nao reaplica; previa descartada nao aplica', async () => {
    const user = await makeUser();
    await store.saveProfileDocument(user.id, wrap({ identity: { full_name: 'Ana' } }));
    const preview = await store.createImportRecord(user.id, { report: importReport({}) });
    expect(preview.status).toBe('preview');
    expect(preview.appliedAt).toBeNull();

    const document = wrap({
      identity: { full_name: 'Ana' },
      courses: [{ id: randomUUID(), name: 'C' }],
    });
    const applied = await store.applyImport(user.id, {
      document,
      report: importReport({}),
      importRecordId: preview.id,
    });
    expect(applied.importRecord.id).toBe(preview.id);
    expect(applied.importRecord.status).toBe('applied');
    await expect(
      store.applyImport(user.id, {
        document,
        report: importReport({}),
        importRecordId: preview.id,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_NOT_APPLICABLE' });
    await expect(store.discardImport(user.id, preview.id)).rejects.toMatchObject({
      code: 'IMPORT_NOT_APPLICABLE',
    });

    const other = await store.createImportRecord(user.id, { report: importReport({}) });
    const discarded = await store.discardImport(user.id, other.id);
    expect(discarded.status).toBe('discarded');
    await expect(
      store.applyImport(user.id, { document, report: importReport({}), importRecordId: other.id }),
    ).rejects.toMatchObject({ code: 'IMPORT_NOT_APPLICABLE' });
    expect(
      (await store.listImportRecords(user.id, { status: 'applied' })).map((r) => r.id),
    ).toEqual([preview.id]);
  });

  it('importar documento que e exportado de outro dono regenera ids e ajusta o id_map', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const document = fixtureDocument('no-links-no-portfolio');
    await store.saveProfileDocument(a.id, document);
    const experienceId = document.profile.experiences![0]!.id!;
    const result = await store.applyImport(b.id, {
      document,
      report: importReport({ 'EXP-001': experienceId }),
      regenerateConflictingIds: true,
    });
    const remapped = result.save.idRemap[experienceId];
    expect(remapped).toBeDefined();
    expect(result.importRecord.idMap['EXP-001']).toBe(remapped);
    expect(await store.getImportIdMap(b.id)).toEqual({ 'EXP-001': remapped });
  });
});

describe('archived mantido e usos/evidencias nas fixtures', () => {
  it('fato archived da fixture permanece archived (com archivedAt) apos salvar e ler', async () => {
    const user = await makeUser();
    const document = fixtureDocument('private-heavy');
    await store.saveProfileDocument(user.id, document);
    const loaded = await loadDocument(user.id);
    const archivedItems = loaded.profile.experiences
      ?.flatMap((e) => e.items ?? [])
      .concat(loaded.profile.projects?.flatMap((p) => p.items ?? []) as never[])
      .filter((item) => item.meta?.status === 'archived');
    expect(archivedItems?.length).toBeGreaterThan(0);
    const { rows } = await testDb.sql<{ n: string }>(
      `SELECT count(*) AS n FROM "ProfileFact" WHERE "status" = 'archived' AND "archivedAt" IS NOT NULL AND "ownerId" = $1`,
      [user.id],
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('SkillUsage com contexto e fonte persiste cada um dos 8 contextos presentes nas fixtures', async () => {
    const user = await makeUser();
    const contexts = new Set<string>();
    for (const id of V2_FIXTURE_IDS) {
      const owner = await makeUser(id);
      await store.saveProfileDocument(owner.id, fixtureDocument(id));
      const { rows } = await testDb.sql<{ usageContext: string }>(
        `SELECT DISTINCT "usageContext" FROM "SkillUsage" WHERE "ownerId" = $1`,
        [owner.id],
      );
      rows.forEach((r) => contexts.add(r.usageContext));
    }
    expect([...contexts].sort()).toEqual([
      'certification',
      'conceptual_familiarity',
      'coursework',
      'professional_experience',
      'project_experience',
      'self_declared_knowledge',
      'unverified',
      'volunteer_experience',
    ]);
    expect(user.id).toBeDefined();
  });

  it('vinculos de evidencia nos dois sentidos (supports e meta.evidence_ids) voltam na mesma ordem', async () => {
    const user = await makeUser();
    const document = fixtureDocument('private-heavy');
    await store.saveProfileDocument(user.id, document);
    const loaded = await loadDocument(user.id);
    const original = expectedAfterStore(document);
    expect(loaded.profile.evidence).toEqual(original.profile.evidence);
    expect(await countOf('EvidenceLink', user.id)).toBeGreaterThan(0);
  });
});

describe('resultado de saveProfileDocument', () => {
  it('informa criado/atualizado/inalterado por tipo de registro', async () => {
    const user = await makeUser();
    const document = fixtureDocument('conflicting-facts');
    const result: SaveResult = await store.saveProfileDocument(user.id, document);
    expect(result.profileCreated).toBe(true);
    expect(result.summary.created.experience).toBe(document.profile.experiences!.length);
    expect(result.summary.created.pending_item).toBe(document.profile.pending_items!.length);
    expect(result.summary.totals.created).toBeGreaterThan(20);
    expect(freshIds(document)).toBeDefined();
  });
});
