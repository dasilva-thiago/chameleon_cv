import { randomUUID } from 'node:crypto';
import {
  awardSchema,
  certificationSchema,
  competencyExampleSchema,
  courseSchema,
  defOf,
  educationSchema,
  experienceItemSchema,
  experienceSchema,
  FACT_KINDS,
  languageSchema,
  projectItemSchema,
  projectSchema,
  publicationSchema,
  skillSchema,
  skillUsageSchema,
  statementSchema,
  volunteeringSchema,
  type ProfileDocument,
} from '@chameleon/contracts';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client';
import {
  columnsToPartialDate,
  documentToRows,
  emptyTables,
  FACT_SPECS,
  JSON_COLUMNS,
  partialDateToColumns,
  planChanges,
  prepareDocument,
  rowsToDocument,
  type DelegateName,
  type DocumentRows,
} from '../src/mappers';
import { COLLABORATOR_SPEC, CONTACT_SPEC, EVIDENCE_SPEC } from '../src/mappers/specs';
import { ProfileStoreError } from '../src/profile-store';
import { expectedAfterStore, fixtureDocument, V2_FIXTURE_IDS } from './support/profile-docs';

type AnySchema = Parameters<typeof defOf>[0];

const SCHEMAS: Record<(typeof FACT_KINDS)[number], AnySchema> = {
  statement: statementSchema,
  competency_example: competencyExampleSchema,
  experience: experienceSchema,
  experience_item: experienceItemSchema,
  project: projectSchema,
  project_item: projectItemSchema,
  education: educationSchema,
  course: courseSchema,
  skill: skillSchema,
  skill_usage: skillUsageSchema,
  language: languageSchema,
  certification: certificationSchema,
  award: awardSchema,
  publication: publicationSchema,
  volunteering: volunteeringSchema,
};

const topLevelKeys = (schema: AnySchema): string[] =>
  Object.keys(defOf(schema).shape ?? {}).filter((key) => key !== 'id' && key !== 'meta');

const scalarFields = (model: string): string[] =>
  Object.values(
    (Prisma as unknown as Record<string, Record<string, string>>)[`${model}ScalarFieldEnum`] ?? {},
  );

const MODEL_OF: Record<DelegateName, string> = {
  professionalProfile: 'ProfessionalProfile',
  profileFact: 'ProfileFact',
  profileStatement: 'ProfileStatement',
  competencyExample: 'CompetencyExample',
  competencyExampleSkill: 'CompetencyExampleSkill',
  experience: 'Experience',
  experienceItem: 'ExperienceItem',
  project: 'Project',
  projectItem: 'ProjectItem',
  projectCollaborator: 'ProjectCollaborator',
  education: 'Education',
  course: 'Course',
  skill: 'Skill',
  skillUsage: 'SkillUsage',
  languageProficiency: 'LanguageProficiency',
  certification: 'Certification',
  award: 'Award',
  publication: 'Publication',
  volunteering: 'Volunteering',
  contactPoint: 'ContactPoint',
  evidence: 'Evidence',
  evidenceLink: 'EvidenceLink',
  pendingItem: 'PendingItem',
  usageRestriction: 'UsageRestriction',
};

describe('datas parciais <-> (date, precision)', () => {
  it('nunca aumenta a precisao declarada', () => {
    for (const value of ['2004', '2004-02', '2004-02-29', '1000', '9999-12-31']) {
      const { date, precision } = partialDateToColumns(value);
      expect(columnsToPartialDate(date, precision)).toBe(value);
    }
    expect(partialDateToColumns('2004').date.toISOString()).toBe('2004-01-01T00:00:00.000Z');
    expect(partialDateToColumns('2004-07').precision).toBe('month');
  });

  it('rejeita datas inexistentes', () => {
    expect(() => partialDateToColumns('2023-02-29')).toThrow();
    expect(() => partialDateToColumns('0999')).toThrow();
  });
});

describe('cobertura do mapeamento (contrato <-> colunas)', () => {
  it('todo kind citavel do contrato tem spec', () => {
    expect(FACT_SPECS.map((s) => s.kind).sort()).toEqual([...FACT_KINDS].sort());
  });

  for (const spec of FACT_SPECS) {
    it(`${spec.kind}: campos do contrato = colunas + specials + details (nada sem destino)`, () => {
      const contractKeys = topLevelKeys(SCHEMAS[spec.kind]);
      const mapped = new Set<string>([
        ...spec.scalars.map((s) => s.key.split('.')[0]!),
        ...spec.dates.map((d) => d.key),
        ...spec.special,
      ]);
      // chaves do spec que nao existem no contrato = spec desatualizada
      expect([...mapped].filter((key) => !contractKeys.includes(key))).toEqual([]);
      // tabela sem coluna `details` nao pode ter campo sem coluna
      const leftovers = contractKeys.filter((key) => !mapped.has(key));
      if (!JSON_COLUMNS[spec.delegate].includes('details')) expect(leftovers).toEqual([]);
    });

    it(`${spec.kind}: toda coluna da spec existe no schema Prisma`, () => {
      const columns = scalarFields(MODEL_OF[spec.delegate]);
      const props = [
        ...spec.scalars.map((s) => s.prop),
        ...spec.dates.flatMap((d) => [
          d.dateProp,
          d.precisionProp,
          ...(d.currentProp ? [d.currentProp] : []),
        ]),
      ];
      expect(props.filter((p) => !columns.includes(p))).toEqual([]);
    });
  }

  it('specs dos registros nao citaveis casam com o schema Prisma', () => {
    for (const spec of [CONTACT_SPEC, EVIDENCE_SPEC, COLLABORATOR_SPEC]) {
      const columns = scalarFields(MODEL_OF[spec.delegate]);
      const props = [
        ...spec.scalars.map((s) => s.prop),
        ...spec.dates.flatMap((d) => [d.dateProp, d.precisionProp]),
      ];
      expect(props.filter((p) => !columns.includes(p))).toEqual([]);
    }
  });

  it('toda coluna do schema e escrita pelo mapeamento em alguma fixture (sem coluna orfa)', () => {
    const written = new Map<DelegateName, Set<string>>();
    for (const id of V2_FIXTURE_IDS) {
      const { tables } = documentToRows(prepareDocument(fixtureDocument(id), randomUUID).document, {
        ownerId: randomUUID(),
        profileId: randomUUID(),
      });
      for (const [delegate, rows] of Object.entries(tables) as [
        DelegateName,
        Record<string, unknown>[],
      ][]) {
        const set = written.get(delegate) ?? new Set<string>();
        for (const row of rows) Object.keys(row).forEach((key) => set.add(key));
        written.set(delegate, set);
      }
    }
    // gerenciadas pelo store/banco, ou sem origem no documento
    const managed = new Set([
      'createdAt',
      'updatedAt',
      'confirmedAt',
      'archivedAt',
      'resolvedAt',
      'isPrimary',
    ]);
    const orphans: string[] = [];
    for (const [delegate, model] of Object.entries(MODEL_OF) as [DelegateName, string][]) {
      if (delegate === 'professionalProfile') continue;
      const set = written.get(delegate) ?? new Set<string>();
      for (const column of scalarFields(model)) {
        // id das tabelas de vinculo e gerado pelo store (planChanges)
        if (
          managed.has(column) ||
          (['evidenceLink', 'competencyExampleSkill'].includes(delegate) && column === 'id')
        )
          continue;
        if (!set.has(column)) orphans.push(`${model}.${column}`);
      }
    }
    expect(orphans).toEqual([]);
  });
});

describe('mappers puros: documento -> linhas -> documento (sem banco)', () => {
  for (const id of V2_FIXTURE_IDS) {
    it(`${id}: round-trip em memoria igual ao canonico`, () => {
      const document = fixtureDocument(id);
      const prepared = prepareDocument(document, randomUUID);
      const rows = documentToRows(prepared.document, {
        ownerId: randomUUID(),
        profileId: randomUUID(),
      });
      expect(rowsToDocument(rows)).toEqual(expectedAfterStore(document));
    });
  }

  it('a leitura nao depende da ordem em que o banco devolve as linhas', () => {
    const document = fixtureDocument('experienced-promotions-same-employer');
    const rows = documentToRows(prepareDocument(document, randomUUID).document, {
      ownerId: randomUUID(),
      profileId: randomUUID(),
    });
    const shuffled: DocumentRows = {
      profile: rows.profile,
      tables: Object.fromEntries(
        Object.entries(rows.tables).map(([name, list]) => [name, [...list].reverse()]),
      ) as DocumentRows['tables'],
    };
    expect(rowsToDocument(shuffled)).toEqual(rowsToDocument(rows));
  });
});

describe('prepareDocument', () => {
  const base = (profile: Record<string, unknown>): unknown => ({
    schema_version: '2.1.0',
    profile,
  });

  it('exige UUID em todo id e nao ecoa dados', () => {
    expect.assertions(2);
    try {
      prepareDocument(base({ education: [{ id: 'EDU-001', institution: 'X' }] }), randomUUID);
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileStoreError);
      expect((error as ProfileStoreError).code).toBe('NON_UUID_ID');
    }
  });

  it('gera ids ausentes, normaliza UUID para minusculas e telefone para a forma canonica', () => {
    const upper = randomUUID().toUpperCase();
    const prepared = prepareDocument(
      base({
        education: [{ id: upper, institution: 'X' }],
        courses: [{ name: 'Sem id' }],
        contact_points: [{ kind: 'phone', value: '+55 (12) 91234-5678' }],
      }),
      randomUUID,
    );
    expect(prepared.generatedIds).toBe(2);
    expect(prepared.phonesNormalized).toBe(1);
    const profile = prepared.document.profile;
    expect(profile.education?.[0]?.id).toBe(upper.toLowerCase());
    expect(profile.contact_points?.[0]?.value).toBe('+5512912345678');
  });

  it('rejeita documento que viola o contrato (legado, versao antiga, chave desconhecida)', () => {
    expect(() => prepareDocument({ schema_version: '1.0.0', profile: {} }, randomUUID)).toThrow();
    expect(() => prepareDocument({ schema_version: '2.0.0', profile: {} }, randomUUID)).toThrow();
    expect(() => prepareDocument(base({ typo_experinces: [] }), randomUUID)).toThrow();
    expect(() => prepareDocument(base({ education: [{ institution: '' }] }), randomUUID)).toThrow();
  });
});

describe('planChanges', () => {
  const owner = randomUUID();
  const profileId = randomUUID();
  const docOf = (profile: Record<string, unknown>): ProfileDocument =>
    prepareDocument({ schema_version: '2.1.0', profile }, randomUUID).document;
  const rowsOf = (document: ProfileDocument): DocumentRows =>
    documentToRows(document, { ownerId: owner, profileId });
  const now = new Date('2026-01-01T00:00:00Z');
  const empty = (): DocumentRows => ({ profile: {}, tables: emptyTables() });

  it('perfil novo: tudo e criado', () => {
    const education = { id: randomUUID(), institution: 'Escola' };
    const plan = planChanges({
      desired: rowsOf(docOf({ education: [education] })),
      existing: empty(),
      onMissing: 'archive',
      now,
      generateId: randomUUID,
    });
    expect(plan.summary.created).toEqual({ education: 1 });
    expect(plan.creates.profileFact).toHaveLength(1);
    expect(plan.creates.education).toHaveLength(1);
  });

  it('estado igual: nada a escrever', () => {
    const document = docOf({ education: [{ id: randomUUID(), institution: 'Escola' }] });
    const stored = rowsOf(document);
    const plan = planChanges({
      desired: rowsOf(document),
      existing: stored,
      onMissing: 'archive',
      now,
      generateId: randomUUID,
    });
    expect(plan.updates).toEqual([]);
    expect(plan.profileChanges).toEqual({});
    expect(plan.summary.totals).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it('ausentes: archive arquiva fatos, keep mantem, delete remove', () => {
    const id = randomUUID();
    const stored = rowsOf(docOf({ education: [{ id, institution: 'Escola' }] }));
    const desired = rowsOf(docOf({}));
    const run = (onMissing: 'archive' | 'keep' | 'delete') =>
      planChanges({ desired, existing: stored, onMissing, now, generateId: randomUUID });

    const archived = run('archive');
    expect(archived.summary.archived).toEqual({ education: 1 });
    const archiveUpdate = archived.updates.find((u) => u.delegate === 'profileFact' && u.id === id);
    expect(archiveUpdate?.data).toMatchObject({ status: 'archived', resumeUse: 'never' });
    expect(run('keep').summary.kept).toEqual({ education: 1 });
    expect(run('keep').updates).toEqual([]);
    expect(run('delete').deletes.profileFact).toEqual([id]);
  });
});
