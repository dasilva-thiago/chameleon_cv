import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AWARD_SCOPE_VALUES,
  CERTIFICATION_CATEGORY_VALUES,
  CERTIFICATION_STATUS_VALUES,
  CONTACT_KIND_VALUES,
  CONTACT_SUBTYPE_VALUES,
  COURSE_STATUS_VALUES,
  DEGREE_TYPE_VALUES,
  defOf,
  EDUCATION_STATUS_VALUES,
  EMPLOYMENT_TYPE_VALUES,
  EVIDENCE_TYPE_VALUES,
  EXPERIENCE_ITEM_KIND_VALUES,
  FACT_KINDS,
  FACT_SOURCE_VALUES,
  FACT_STATUS_VALUES,
  FIELD_STATE_VALUES,
  IMPORT_SOURCE_FORMATS,
  LANGUAGE_LEVEL_VALUES,
  metaSchema,
  PARTICIPATION_TYPE_VALUES,
  PENDING_REASON_VALUES,
  PENDING_STATUS_VALUES,
  PRIORITY_VALUES,
  PROJECT_CATEGORY_VALUES,
  PROJECT_ITEM_KIND_VALUES,
  PROJECT_STATUS_VALUES,
  PUBLIC_ACCESS_VALUES,
  PUBLICATION_STATUS_VALUES,
  PUBLICATION_TYPE_VALUES,
  RECRUITER_SHARING_VALUES,
  RESTRICTION_RULE_VALUES,
  RESUME_USE_VALUES,
  SELF_ASSESSED_LEVEL_VALUES,
  SKILL_CATEGORY_VALUES,
  STATEMENT_KIND_VALUES,
  STUDY_MODALITY_VALUES,
  TOP_LEVEL_COLLECTIONS,
  USAGE_CONTEXT_VALUES,
  VISIBILITY_VALUES,
  WORK_MODE_VALUES,
  PROFILE_SCHEMA_VERSION,
} from '@chameleon/contracts';
import { describe, expect, it } from 'vitest';
import * as PrismaEnums from '../src/generated/prisma/enums';
import { META_KEYS } from '../src/mappers';

/**
 * Alinhamento contrato (Zod) <-> banco: os enums do Prisma e as listas fixas nos CHECKs SQL nao podem
 * divergir dos enums canonicos de `@chameleon/contracts`.
 */
const ENUMS: Record<string, readonly string[]> = {
  FactKind: FACT_KINDS,
  FactStatus: FACT_STATUS_VALUES,
  Visibility: VISIBILITY_VALUES,
  ResumeUse: RESUME_USE_VALUES,
  FactSource: FACT_SOURCE_VALUES,
  DatePrecision: ['year', 'month', 'day'],
  UsageContext: USAGE_CONTEXT_VALUES,
  EmploymentType: EMPLOYMENT_TYPE_VALUES,
  WorkMode: WORK_MODE_VALUES,
  ProjectCategory: PROJECT_CATEGORY_VALUES,
  ProjectStatus: PROJECT_STATUS_VALUES,
  PublicAccess: PUBLIC_ACCESS_VALUES,
  SelfAssessedLevel: SELF_ASSESSED_LEVEL_VALUES,
  LanguageLevel: LANGUAGE_LEVEL_VALUES,
  EducationStatus: EDUCATION_STATUS_VALUES,
  DegreeType: DEGREE_TYPE_VALUES,
  StudyModality: STUDY_MODALITY_VALUES,
  CourseStatus: COURSE_STATUS_VALUES,
  SkillCategory: SKILL_CATEGORY_VALUES,
  CertificationCategory: CERTIFICATION_CATEGORY_VALUES,
  CertificationStatus: CERTIFICATION_STATUS_VALUES,
  AwardScope: AWARD_SCOPE_VALUES,
  PublicationType: PUBLICATION_TYPE_VALUES,
  PublicationStatus: PUBLICATION_STATUS_VALUES,
  ParticipationType: PARTICIPATION_TYPE_VALUES,
  ContactKind: CONTACT_KIND_VALUES,
  ContactSubtype: CONTACT_SUBTYPE_VALUES,
  StatementKind: STATEMENT_KIND_VALUES,
  ExperienceItemKind: EXPERIENCE_ITEM_KIND_VALUES,
  ProjectItemKind: PROJECT_ITEM_KIND_VALUES,
  PendingReason: PENDING_REASON_VALUES,
  PendingStatus: PENDING_STATUS_VALUES,
  Priority: PRIORITY_VALUES,
  EvidenceType: EVIDENCE_TYPE_VALUES,
  RecruiterSharing: RECRUITER_SHARING_VALUES,
  RestrictionRule: RESTRICTION_RULE_VALUES,
  ImportSourceFormat: IMPORT_SOURCE_FORMATS,
};

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');
const constraintsSql = (): string => {
  const dir = readdirSync(MIGRATIONS).find((name) => name.endsWith('_profile_constraints'));
  if (!dir) throw new Error('migracao profile_constraints nao encontrada');
  return readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
};

describe('enums do banco = enums do contrato', () => {
  for (const [name, values] of Object.entries(ENUMS)) {
    it(name, () => {
      const generated = (PrismaEnums as unknown as Record<string, Record<string, string>>)[name];
      expect(generated, `enum ${name} ausente no schema Prisma`).toBeDefined();
      expect(Object.values(generated!).sort()).toEqual([...values].sort());
    });
  }
});

describe('listas fixas nos CHECKs SQL = contrato', () => {
  const sql = constraintsSql();

  it('chaves de meta (metaKeys)', () => {
    const shape = Object.keys(defOf(metaSchema).shape ?? {});
    expect([...META_KEYS].sort()).toEqual(shape.sort());
    for (const key of META_KEYS) expect(sql).toContain(`'${key}'`);
  });

  it('estados de campo (field_states)', () => {
    for (const state of FIELD_STATE_VALUES) expect(sql).toContain(`'${state}'`);
  });

  it('colecoes de topo que podem ser [] explicito', () => {
    for (const collection of TOP_LEVEL_COLLECTIONS) expect(sql).toContain(`'${collection.key}'`);
  });

  it('regex de chave de field_states = FIELD_NAME_REGEX do contrato', () => {
    expect(sql).toContain('^[a-z][a-z0-9_]{0,63}(\\.[a-z][a-z0-9_]{0,63}){0,2}$');
  });

  it('regex de telefone canonico = PHONE_CANONICAL_REGEX do contrato', () => {
    expect(sql).toContain('^\\+?[0-9]{7,15}$');
  });

  it('versao corrente do contrato e 2.x (CHECK de schemaVersion)', () => {
    expect(PROFILE_SCHEMA_VERSION).toMatch(/^2\./);
    expect(sql).toContain("'^2\\.[0-9]+\\.[0-9]+$'");
  });

  it('subtipos de contato por tipo cobrem o vocabulario do contrato', () => {
    for (const subtype of CONTACT_SUBTYPE_VALUES) expect(sql).toContain(`'${subtype}'`);
  });
});
