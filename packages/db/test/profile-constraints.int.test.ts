import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRIVATE_MODELS } from '../src/private-models';
import { createProfileStore, type ProfileStore } from '../src/profile-store';
import { createTestDb, type TestDb } from '../src/testing';
import { fixtureDocument } from './support/profile-docs';
import { testSnapshot } from './support/snapshot';

/**
 * Constraints do agregado de perfil no schema REAL (migracoes `profile_init` + `profile_constraints`):
 * FK composta cruzada entre donos, coerencia kind x tabela tipada, contexto de uso (ADR-0007),
 * imutabilidade de ProfileRevision, formatos (field_states, telefone canonico, datas parciais).
 */

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

interface Owner {
  id: string;
  profileId: string;
}

async function makeOwner(label: string): Promise<Owner> {
  const user = await testDb.db.global.user.create({
    data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`, displayName: label },
  });
  const saved = await store.saveProfileDocument(user.id, {
    schema_version: '2.1.0',
    profile: { identity: { full_name: `Pessoa ${label}` } },
  });
  return { id: user.id, profileId: saved.profileId };
}

async function makeRichOwner(label: string): Promise<Owner> {
  const user = await testDb.db.global.user.create({
    data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`, displayName: label },
  });
  const saved = await store.saveProfileDocument(
    user.id,
    fixtureDocument('experienced-promotions-same-employer'),
  );
  return { id: user.id, profileId: saved.profileId };
}

const firstId = async (table: string, owner: Owner): Promise<string> => {
  const { rows } = await testDb.sql<{ id: string }>(
    `SELECT "id" FROM "${table}" WHERE "ownerId" = $1 LIMIT 1`,
    [owner.id],
  );
  if (!rows[0]) throw new Error(`sem linha em ${table}`);
  return rows[0].id;
};

/** Fato + linha tipada na MESMA transacao (statement multiplo = transacao implicita). */
const insertFactAndTyped = (
  owner: { id: string; profileId: string },
  kind: string,
  table: string,
  id: string,
  typedColumns = '',
  typedValues = '',
): Promise<unknown> =>
  testDb.sql(
    `INSERT INTO "ProfileFact" ("id", "ownerId", "profileId", "kind", "updatedAt")
       VALUES ('${id}', '${owner.id}', '${owner.profileId}', '${kind}', now());
     INSERT INTO "${table}" ("id", "ownerId"${typedColumns}) VALUES ('${id}', '${owner.id}'${typedValues});`,
  );

describe('FK composta cruzada: INSERT entre dois donos falha no schema real (ADR-0008)', () => {
  it('ProfileFact do dono B apontando para o perfil do dono A', async () => {
    const a = await makeOwner('a');
    const b = await makeOwner('b');
    await expect(
      testDb.sql(
        `INSERT INTO "ProfileFact" ("id", "ownerId", "profileId", "kind", "updatedAt")
           VALUES ($1, $2, $3, 'statement', now())`,
        [randomUUID(), b.id, a.profileId],
      ),
    ).rejects.toThrow(/ProfileFact_profileId_ownerId_fkey/);
  });

  it('linha tipada (ExperienceItem) de B apontando para a experiencia de A', async () => {
    const a = await makeRichOwner('a');
    const b = await makeOwner('b');
    const experienceOfA = await firstId('Experience', a);
    await expect(
      insertFactAndTyped(
        b,
        'experience_item',
        'ExperienceItem',
        randomUUID(),
        ', "experienceId", "kind", "text"',
        `, '${experienceOfA}', 'responsibility', 'x'`,
      ),
    ).rejects.toThrow(/ExperienceItem_experienceId_ownerId_fkey/);
  });

  it('SkillUsage de B referenciando a competencia de A', async () => {
    const a = await makeRichOwner('a');
    const b = await makeOwner('b');
    const skillOfA = await firstId('Skill', a);
    await expect(
      insertFactAndTyped(
        b,
        'skill_usage',
        'SkillUsage',
        randomUUID(),
        ', "skillId", "usageContext"',
        `, '${skillOfA}', 'unverified'`,
      ),
    ).rejects.toThrow(/SkillUsage_skillId_ownerId_fkey/);
  });

  it('vinculo de evidencia de A com o fato de B', async () => {
    const a = await makeRichOwner('a');
    const b = await makeRichOwner('b');
    const evidenceOfA = await firstId('Evidence', a);
    const factOfB = await firstId('ProfileFact', b);
    await expect(
      testDb.sql(
        `INSERT INTO "EvidenceLink" ("id", "evidenceId", "factId", "ownerId", "supportsPosition")
           VALUES ($1, $2, $3, $4, 0)`,
        [randomUUID(), evidenceOfA, factOfB, a.id],
      ),
    ).rejects.toThrow(/EvidenceLink_factId_ownerId_fkey/);
  });

  it('pendencia de B com alvo no fato de A', async () => {
    const a = await makeRichOwner('a');
    const b = await makeOwner('b');
    const factOfA = await firstId('ProfileFact', a);
    await expect(
      testDb.sql(
        `INSERT INTO "PendingItem" ("id", "ownerId", "profileId", "targetFactId", "subject", "updatedAt")
           VALUES ($1, $2, $3, $4, 'x', now())`,
        [randomUUID(), b.id, b.profileId, factOfA],
      ),
    ).rejects.toThrow(/PendingItem_targetFactId_ownerId_fkey/);
  });

  it('revisao e importacao de B no perfil de A', async () => {
    const a = await makeOwner('a');
    const b = await makeOwner('b');
    await expect(
      testDb.sql(
        `INSERT INTO "ProfileRevision" ("id", "ownerId", "profileId", "revisionNumber", "schemaVersion", "contentHash", "reason", "snapshot")
           VALUES ($1, $2, $3, 1, '2.1.0', repeat('a', 64), 'manual_save', '{"schema_version":"2.1.0"}')`,
        [randomUUID(), b.id, a.profileId],
      ),
    ).rejects.toThrow(/ProfileRevision_profileId_ownerId_fkey/);
    await expect(
      testDb.sql(
        `INSERT INTO "ImportRecord" ("id", "ownerId", "profileId", "sourceFormat", "targetSchemaVersion")
           VALUES ($1, $2, $3, 'yaml', '2.1.0')`,
        [randomUUID(), b.id, a.profileId],
      ),
    ).rejects.toThrow(/ImportRecord_profileId_ownerId_fkey/);
  });
});

describe('coerencia ProfileFact.kind x tabela tipada (gap da S1.1a)', () => {
  it('linha tipada Experience sobre um fato de outro kind e rejeitada', async () => {
    const owner = await makeOwner('a');
    await expect(insertFactAndTyped(owner, 'skill', 'Experience', randomUUID())).rejects.toThrow(
      /Experience_fact_kind_chk/,
    );
  });

  it('cada tabela tipada rejeita fato de kind diferente', async () => {
    const owner = await makeOwner('a');
    const cases: [string, string][] = [
      ['education', 'Course'],
      ['course', 'Education'],
      ['experience', 'Project'],
      ['project', 'Experience'],
      ['statement', 'Award'],
    ];
    for (const [kind, table] of cases) {
      await expect(insertFactAndTyped(owner, kind, table, randomUUID())).rejects.toThrow(
        new RegExp(`${table}_fact_kind_chk`),
      );
    }
  });

  it('fato sem linha tipada e rejeitado ao final da transacao', async () => {
    const owner = await makeOwner('a');
    await expect(
      testDb.sql(
        `INSERT INTO "ProfileFact" ("id", "ownerId", "profileId", "kind", "updatedAt")
           VALUES ($1, $2, $3, 'education', now())`,
        [randomUUID(), owner.id, owner.profileId],
      ),
    ).rejects.toThrow(/ProfileFact_typed_row_chk/);
  });

  it('fato + linha tipada coerentes na mesma transacao sao aceitos', async () => {
    const owner = await makeOwner('a');
    await insertFactAndTyped(owner, 'education', 'Education', randomUUID());
    const { rows } = await testDb.sql<{ n: string }>(`SELECT count(*) AS n FROM "Education"`);
    expect(rows[0]?.n).toBe('1');
  });

  it('o kind do fato e imutavel', async () => {
    const owner = await makeRichOwner('a');
    const education = await firstId('Education', owner);
    await expect(
      testDb.sql(`UPDATE "ProfileFact" SET "kind" = 'course' WHERE "id" = $1`, [education]),
    ).rejects.toThrow(/ProfileFact_kind_immutable_chk/);
  });

  it('apagar so a linha tipada (deixando o fato orfao) e rejeitado', async () => {
    const owner = await makeRichOwner('a');
    const education = await firstId('Education', owner);
    await expect(
      testDb.sql(`DELETE FROM "Education" WHERE "id" = $1`, [education]),
    ).rejects.toThrow(/Education_fact_orphan_chk/);
  });

  it('apagar o fato leva a linha tipada junto (cascata)', async () => {
    const owner = await makeRichOwner('a');
    const education = await firstId('Education', owner);
    await testDb.sql(`DELETE FROM "ProfileFact" WHERE "id" = $1`, [education]);
    const { rows } = await testDb.sql(`SELECT 1 FROM "Education" WHERE "id" = $1`, [education]);
    expect(rows).toHaveLength(0);
  });

  it('a linha tipada de competencia precisa estar no mesmo perfil do fato', async () => {
    const owner = await makeOwner('a');
    const otherProfile = randomUUID();
    await testDb.sql(
      `INSERT INTO "ProfessionalProfile" ("id", "ownerId", "isPrimary", "schemaVersion", "updatedAt")
         VALUES ($1, $2, false, '2.1.0', now())`,
      [otherProfile, owner.id],
    );
    const id = randomUUID();
    await expect(
      testDb.sql(
        `INSERT INTO "ProfileFact" ("id", "ownerId", "profileId", "kind", "updatedAt")
           VALUES ('${id}', '${owner.id}', '${owner.profileId}', 'skill', now());
         INSERT INTO "Skill" ("id", "ownerId", "profileId", "name", "normalizedKey")
           VALUES ('${id}', '${owner.id}', '${otherProfile}', 'SQL', 'sql');`,
      ),
    ).rejects.toThrow(/Skill_fact_profile_chk/);
  });
});

describe('contexto de uso de competencias (ADR-0007)', () => {
  const insertUsage = async (
    owner: Owner,
    skillId: string,
    context: string,
    sources: Record<string, string | null> = {},
  ): Promise<unknown> => {
    const columns = Object.keys(sources);
    return insertFactAndTyped(
      owner,
      'skill_usage',
      'SkillUsage',
      randomUUID(),
      `, "skillId", "usageContext"${columns.map((c) => `, "${c}"`).join('')}`,
      `, '${skillId}', '${context}'${columns.map((c) => `, ${sources[c] ? `'${sources[c]}'` : 'NULL'}`).join('')}`,
    );
  };

  it('professional_experience sem experienceId falha; so "estudo" nao vira experiencia profissional', async () => {
    const owner = await makeRichOwner('a');
    const skill = await firstId('Skill', owner);
    const education = await firstId('Education', owner);
    await expect(insertUsage(owner, skill, 'professional_experience')).rejects.toThrow(
      /SkillUsage_context_source_chk/,
    );
    await expect(
      insertUsage(owner, skill, 'professional_experience', { educationId: education }),
    ).rejects.toThrow(/SkillUsage_context_source_chk/);
  });

  it('cada contexto exige a fonte tipada correspondente', async () => {
    const owner = await makeRichOwner('a');
    const skill = await firstId('Skill', owner);
    const education = await firstId('Education', owner);
    const experience = await firstId('Experience', owner);
    for (const context of [
      'project_experience',
      'volunteer_experience',
      'coursework',
      'certification',
    ]) {
      await expect(insertUsage(owner, skill, context)).rejects.toThrow(
        /SkillUsage_context_source_chk/,
      );
    }
    // fonte de outro tipo
    await expect(
      insertUsage(owner, skill, 'project_experience', { experienceId: experience }),
    ).rejects.toThrow(/SkillUsage_context_source_chk/);
    await expect(
      insertUsage(owner, skill, 'certification', { educationId: education }),
    ).rejects.toThrow(/SkillUsage_context_source_chk/);
  });

  it('no maximo uma fonte por uso', async () => {
    const owner = await makeRichOwner('a');
    const skill = await firstId('Skill', owner);
    const education = await firstId('Education', owner);
    const experience = await firstId('Experience', owner);
    await expect(
      insertUsage(owner, skill, 'unverified', { experienceId: experience, educationId: education }),
    ).rejects.toThrow(/SkillUsage_single_source_chk/);
  });

  it('contextos validos sao aceitos (com e sem fonte, conforme o contexto)', async () => {
    const owner = await makeRichOwner('a');
    const skill = await firstId('Skill', owner);
    const education = await firstId('Education', owner);
    const experience = await firstId('Experience', owner);
    await insertUsage(owner, skill, 'professional_experience', { experienceId: experience });
    await insertUsage(owner, skill, 'coursework', { educationId: education });
    await insertUsage(owner, skill, 'volunteer_experience', { experienceId: experience });
    await insertUsage(owner, skill, 'unverified');
    await insertUsage(owner, skill, 'conceptual_familiarity');
    await insertUsage(owner, skill, 'self_declared_knowledge', { educationId: education });
  });
});

describe('ProfileRevision imutavel (ADR-0006)', () => {
  it('UPDATE e DELETE falham; a excecao allow_purge so vale para DELETE na transacao', async () => {
    const owner = await makeRichOwner('a');
    const { revision } = await store.createRevision(owner.id);

    await expect(
      testDb.sql(`UPDATE "ProfileRevision" SET "reason" = 'import' WHERE "id" = $1`, [revision.id]),
    ).rejects.toThrow(/ProfileRevision_immutable/);
    await expect(
      testDb.sql(`UPDATE "ProfileRevision" SET "snapshot" = '{}' WHERE "id" = $1`, [revision.id]),
    ).rejects.toThrow(/ProfileRevision_immutable|ProfileRevision_snapshot_chk/);
    await expect(
      testDb.sql(`DELETE FROM "ProfileRevision" WHERE "id" = $1`, [revision.id]),
    ).rejects.toThrow(/ProfileRevision_immutable/);
    // a excecao NAO libera UPDATE
    await expect(
      testDb.sql(
        `SET LOCAL chameleon.allow_purge = 'on'; UPDATE "ProfileRevision" SET "reason" = 'import' WHERE "id" = $1`.replace(
          '$1',
          `'${revision.id}'`,
        ),
      ),
    ).rejects.toThrow(/ProfileRevision_immutable/);
    // fora da transacao com a flag, continua imutavel
    await expect(
      testDb.sql(`DELETE FROM "ProfileRevision" WHERE "id" = $1`, [revision.id]),
    ).rejects.toThrow(/ProfileRevision_immutable/);
    expect((await store.listRevisions(owner.id)).map((r) => r.id)).toEqual([revision.id]);

    // exclusao de conta: DELETE em transacao com a flag
    await testDb.sql(
      `SET LOCAL chameleon.allow_purge = 'on'; DELETE FROM "ProfileRevision" WHERE "id" = '${revision.id}'`,
    );
    expect(await store.listRevisions(owner.id)).toEqual([]);
  });

  it('o cliente escopado (Prisma) tambem nao consegue alterar nem apagar a revisao', async () => {
    const owner = await makeRichOwner('a');
    const { revision } = await store.createRevision(owner.id);
    const scoped = testDb.db.forOwner(owner.id);
    await expect(
      scoped.profileRevision.update({ where: { id: revision.id }, data: { reason: 'import' } }),
    ).rejects.toThrow(/ProfileRevision_immutable/);
    await expect(scoped.profileRevision.deleteMany({ where: { id: revision.id } })).rejects.toThrow(
      /ProfileRevision_immutable/,
    );
  });

  it('o snapshot declara a mesma versao do contrato da coluna schemaVersion', async () => {
    const owner = await makeOwner('a');
    await expect(
      testDb.sql(
        `INSERT INTO "ProfileRevision" ("id", "ownerId", "profileId", "revisionNumber", "schemaVersion", "contentHash", "reason", "snapshot")
           VALUES ($1, $2, $3, 1, '2.1.0', repeat('a', 64), 'manual_save', '{"schema_version":"2.0.0"}')`,
        [randomUUID(), owner.id, owner.profileId],
      ),
    ).rejects.toThrow(/ProfileRevision_snapshot_chk/);
    await expect(
      testDb.sql(
        `INSERT INTO "ProfileRevision" ("id", "ownerId", "profileId", "revisionNumber", "schemaVersion", "contentHash", "reason", "snapshot")
           VALUES ($1, $2, $3, 1, '2.1.0', 'XYZ', 'manual_save', '{"schema_version":"2.1.0"}')`,
        [randomUUID(), owner.id, owner.profileId],
      ),
    ).rejects.toThrow(/ProfileRevision_contentHash_chk/);
  });

  it('excluir a conta apaga TODO o agregado (so com allow_purge); sem a flag a conta nao some', async () => {
    const owner = await makeRichOwner('a');
    const other = await makeRichOwner('b');
    await store.createRevision(owner.id);
    await store.createRevision(other.id);

    // sem a flag: a cascata esbarra no trigger de imutabilidade da revisao
    await expect(testDb.sql(`DELETE FROM "User" WHERE "id" = $1`, [owner.id])).rejects.toThrow(
      /ProfileRevision_immutable/,
    );

    await testDb.sql(
      `SET LOCAL chameleon.allow_purge = 'on'; DELETE FROM "User" WHERE "id" = '${owner.id}'`,
    );
    for (const model of PRIVATE_MODELS) {
      const { rows } = await testDb.sql<{ n: string }>(
        `SELECT count(*) AS n FROM "${model}" WHERE "ownerId" = $1`,
        [owner.id],
      );
      expect(rows[0]?.n, `${model} ainda tem linhas do dono excluido`).toBe('0');
    }
    // o outro dono permanece intacto
    expect(await store.loadProfileDocument(other.id)).not.toBeNull();
    expect(await store.listRevisions(other.id)).toHaveLength(1);
  });
});

describe('formatos e coerencia por CHECK', () => {
  it('field_states: chaves aninhadas validas passam; formato/estado invalidos falham (CHECK)', async () => {
    const owner = await makeRichOwner('a');
    const fact = await firstId('ProfileFact', owner);
    const set = (json: string) =>
      testDb.sql(`UPDATE "ProfileFact" SET "fieldStates" = $1::jsonb WHERE "id" = $2`, [
        json,
        fact,
      ]);

    await set(
      '{"end_date":"not_applicable","metric.value":"needs_confirmation","business.portfolio_url":"declined"}',
    );
    await expect(set('{"Bad-Key":"declined"}')).rejects.toThrow(/ProfileFact_fieldStates_chk/);
    await expect(set('{"a.b.c.d":"declined"}')).rejects.toThrow(/ProfileFact_fieldStates_chk/);
    await expect(set('{"metric.":"declined"}')).rejects.toThrow(/ProfileFact_fieldStates_chk/);
    await expect(set('{"metric.value":"banana"}')).rejects.toThrow(/ProfileFact_fieldStates_chk/);
    await expect(set('{"metric.value":1}')).rejects.toThrow(/ProfileFact_fieldStates_chk/);
    await expect(set('["declined"]')).rejects.toThrow(/ProfileFact_fieldStates_chk/);
  });

  it('field_states dos blocos singleton seguem o mesmo formato', async () => {
    const owner = await makeOwner('a');
    await expect(
      testDb.sql(
        `UPDATE "ProfessionalProfile" SET "identity" = '{"field_states":{"X Y":"declined"}}' WHERE "id" = $1`,
        [owner.profileId],
      ),
    ).rejects.toThrow(/ProfessionalProfile_field_states_chk/);
    await expect(
      testDb.sql(`UPDATE "ProfessionalProfile" SET "careerPreferences" = '[]' WHERE "id" = $1`, [
        owner.profileId,
      ]),
    ).rejects.toThrow(/ProfessionalProfile_blocks_object_chk/);
  });

  it('telefone: somente a forma canonica; subtipo coerente com o tipo de contato', async () => {
    const owner = await makeOwner('a');
    const insert = (kind: string, subtype: string | null, value: string) =>
      testDb.sql(
        `INSERT INTO "ContactPoint" ("id", "ownerId", "profileId", "kind", "subtype", "value", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [randomUUID(), owner.id, owner.profileId, kind, subtype, value],
      );
    await insert('phone', 'mobile', '+5512912345678');
    await insert('phone', null, '12912345678');
    for (const bad of [
      '(12) 91234-5678',
      '+55 12 91234-5678',
      '123456',
      '+1234567890123456',
      'abc1234567',
    ]) {
      await expect(insert('phone', null, bad)).rejects.toThrow(/ContactPoint_phone_canonical_chk/);
    }
    await insert('email', 'professional', 'a@example.test');
    await expect(insert('email', 'linkedin', 'a@example.test')).rejects.toThrow(
      /ContactPoint_subtype_kind_chk/,
    );
    await expect(insert('link', 'mobile', 'https://example.test')).rejects.toThrow(
      /ContactPoint_subtype_kind_chk/,
    );
    await expect(insert('phone', 'github', '+5512912345678')).rejects.toThrow(
      /ContactPoint_subtype_kind_chk/,
    );
  });

  it('nivel descritivo de idioma (2.1.0): ate 200 caracteres; nunca vira CEFR', async () => {
    const owner = await makeOwner('a');
    const insertLanguage = (level: string) =>
      insertFactAndTyped(
        owner,
        'language',
        'LanguageProficiency',
        randomUUID(),
        ', "languageLabel", "selfDescribedLevel"',
        `, 'Ingles', '${level}'`,
      );
    await insertLanguage('a'.repeat(200));
    await expect(insertLanguage('a'.repeat(201))).rejects.toThrow(
      /LanguageProficiency_selfDescribedLevel_chk/,
    );
  });

  it('datas parciais: data e precisao andam juntas; precisao coerente com o dia; present exclui o fim', async () => {
    const owner = await makeOwner('a');
    const insertEducation = (cols: string, vals: string) =>
      insertFactAndTyped(owner, 'education', 'Education', randomUUID(), cols, vals);
    await insertEducation(', "startDate", "startPrecision"', `, '2020-01-01', 'year'`);
    await insertEducation(', "startDate", "startPrecision"', `, '2020-05-01', 'month'`);
    await expect(insertEducation(', "startDate"', `, '2020-01-01'`)).rejects.toThrow(
      /Education_startDate_precision_chk/,
    );
    await expect(insertEducation(', "startPrecision"', `, 'year'`)).rejects.toThrow(
      /Education_startDate_precision_chk/,
    );
    await expect(
      insertEducation(', "startDate", "startPrecision"', `, '2020-05-01', 'year'`),
    ).rejects.toThrow(/Education_startDate_year_chk/);
    await expect(
      insertEducation(', "startDate", "startPrecision"', `, '2020-05-07', 'month'`),
    ).rejects.toThrow(/Education_startDate_month_chk/);

    const insertExperience = (cols: string, vals: string) =>
      insertFactAndTyped(owner, 'experience', 'Experience', randomUUID(), cols, vals);
    await insertExperience(', "isCurrent"', ', true');
    await expect(
      insertExperience(', "isCurrent", "endDate", "endPrecision"', `, true, '2020-01-01', 'year'`),
    ).rejects.toThrow(/Experience_isCurrent_chk/);
  });

  it('arquivado <=> archivedAt; alvo unico de pendencia/restricao; restricao exige alvo', async () => {
    const owner = await makeRichOwner('a');
    const fact = await firstId('ProfileFact', owner);
    const contact = await firstId('ContactPoint', owner);
    await expect(
      testDb.sql(`UPDATE "ProfileFact" SET "status" = 'archived' WHERE "id" = $1`, [fact]),
    ).rejects.toThrow(/ProfileFact_archived_chk/);
    await expect(
      testDb.sql(`UPDATE "ProfileFact" SET "archivedAt" = now() WHERE "id" = $1`, [fact]),
    ).rejects.toThrow(/ProfileFact_archived_chk/);
    await testDb.sql(
      `UPDATE "ProfileFact" SET "status" = 'archived', "archivedAt" = now() WHERE "id" = $1`,
      [fact],
    );

    await expect(
      testDb.sql(
        `INSERT INTO "PendingItem" ("id", "ownerId", "profileId", "targetFactId", "targetContactPointId", "subject", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'x', now())`,
        [randomUUID(), owner.id, owner.profileId, fact, contact],
      ),
    ).rejects.toThrow(/PendingItem_single_target_chk/);
    await expect(
      testDb.sql(
        `INSERT INTO "UsageRestriction" ("id", "ownerId", "profileId", "rule", "updatedAt")
           VALUES ($1, $2, $3, 'never_include', now())`,
        [randomUUID(), owner.id, owner.profileId],
      ),
    ).rejects.toThrow(/UsageRestriction_has_target_chk/);
    await expect(
      testDb.sql(
        `INSERT INTO "UsageRestriction" ("id", "ownerId", "profileId", "rule", "term", "targetField", "updatedAt")
           VALUES ($1, $2, $3, 'never_include', 'x', 'identity.pronouns', now())`,
        [randomUUID(), owner.id, owner.profileId],
      ),
    ).rejects.toThrow(/UsageRestriction_has_target_chk/);
  });

  it('versao do contrato, colecoes vazias e relatorio de importacao', async () => {
    const owner = await makeOwner('a');
    await expect(
      testDb.sql(`UPDATE "ProfessionalProfile" SET "schemaVersion" = '1.0.0' WHERE "id" = $1`, [
        owner.profileId,
      ]),
    ).rejects.toThrow(/ProfessionalProfile_schemaVersion_chk/);
    await testDb.sql(`UPDATE "ProfessionalProfile" SET "schemaVersion" = '2.0.0' WHERE "id" = $1`, [
      owner.profileId,
    ]);
    await expect(
      testDb.sql(
        `UPDATE "ProfessionalProfile" SET "emptyCollections" = ARRAY['banana'] WHERE "id" = $1`,
        [owner.profileId],
      ),
    ).rejects.toThrow(/ProfessionalProfile_emptyCollections_chk/);
    await expect(
      testDb.sql(
        `INSERT INTO "ImportRecord" ("id", "ownerId", "profileId", "sourceFormat", "targetSchemaVersion", "status")
           VALUES ($1, $2, $3, 'yaml', '2.1.0', 'applied')`,
        [randomUUID(), owner.id, owner.profileId],
      ),
    ).rejects.toThrow(/ImportRecord_applied_chk/);
    await expect(
      testDb.sql(
        `INSERT INTO "ImportRecord" ("id", "ownerId", "profileId", "sourceFormat", "targetSchemaVersion", "steps")
           VALUES ($1, $2, $3, 'yaml', '2.1.0', '{}')`,
        [randomUUID(), owner.id, owner.profileId],
      ),
    ).rejects.toThrow(/ImportRecord_json_types_chk/);
  });

  it('um unico perfil primario por dono', async () => {
    const owner = await makeOwner('a');
    await expect(
      testDb.sql(
        `INSERT INTO "ProfessionalProfile" ("id", "ownerId", "isPrimary", "schemaVersion", "updatedAt")
           VALUES ($1, $2, true, '2.1.0', now())`,
        [randomUUID(), owner.id],
      ),
    ).rejects.toThrow(/ProfessionalProfile_primary_key/);
  });
});

describe('catalogo do agregado de perfil', () => {
  it('todo model novo esta registrado como privado, com ownerId e UNIQUE (id, ownerId)', async () => {
    const aggregate = [
      'ProfessionalProfile',
      'ProfileFact',
      'ProfileStatement',
      'CompetencyExample',
      'CompetencyExampleSkill',
      'Experience',
      'ExperienceItem',
      'Project',
      'ProjectItem',
      'ProjectCollaborator',
      'Education',
      'Course',
      'Skill',
      'SkillUsage',
      'LanguageProficiency',
      'Certification',
      'Award',
      'Publication',
      'Volunteering',
      'ContactPoint',
      'Evidence',
      'EvidenceLink',
      'PendingItem',
      'UsageRestriction',
      'ProfileRevision',
      'ImportRecord',
    ];
    expect(aggregate.filter((m) => !(PRIVATE_MODELS as readonly string[]).includes(m))).toEqual([]);
    const { rows } = await testDb.sql<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = ANY($1)
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'ownerId' AND NOT a.attisdropped)
          AND EXISTS (
            SELECT 1 FROM pg_index i
             WHERE i.indrelid = c.oid AND i.indisunique AND i.indnatts = 2
               AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) k JOIN pg_attribute a
                          ON a.attrelid = c.oid AND a.attnum = k ORDER BY a.attname::text) = ARRAY['id', 'ownerId'])`,
      [aggregate],
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...aggregate].sort());
  });
});
