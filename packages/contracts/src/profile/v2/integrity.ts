import type { z } from 'zod';
import type { RecordKind } from '../../common/enums';
import { normalizeTerm } from '../../common/text';
import {
  additionalProfessionalContextSchema,
  availabilityPreferencesSchema,
  careerPreferencesSchema,
  identitySchema,
  positioningSchema,
  resumePreferencesSchema,
  reviewSchema,
  usageRulesSchema,
} from './blocks';
import { listRecords, listReferences, type Path, type RecordEntry } from './graph';
import { recordFieldNames } from './paths';
import {
  awardSchema,
  certificationSchema,
  collaboratorSchema,
  competencyExampleSchema,
  contactPointSchema,
  courseSchema,
  educationSchema,
  evidenceSchema,
  experienceItemSchema,
  experienceSchema,
  languageSchema,
  pendingItemSchema,
  projectItemSchema,
  projectSchema,
  publicationSchema,
  restrictionSchema,
  SKILL_USAGE_SOURCE_FIELDS,
  skillSchema,
  skillUsageSchema,
  statementSchema,
  USAGE_CONTEXT_SOURCES,
  volunteeringSchema,
} from './records';

/**
 * Validacao semantica (integridade entre registros) que o JSON Schema nao expressa
 * (ADR-0003, item 5). O JSON Schema publicado e, portanto, declaradamente um SUBCONJUNTO.
 */

const RECORD_SCHEMAS: Record<RecordKind, z.ZodType> = {
  contact_point: contactPointSchema,
  statement: statementSchema,
  competency_example: competencyExampleSchema,
  experience: experienceSchema,
  experience_item: experienceItemSchema,
  project: projectSchema,
  project_item: projectItemSchema,
  collaborator: collaboratorSchema,
  education: educationSchema,
  course: courseSchema,
  skill: skillSchema,
  skill_usage: skillUsageSchema,
  language: languageSchema,
  certification: certificationSchema,
  award: awardSchema,
  publication: publicationSchema,
  volunteering: volunteeringSchema,
  evidence: evidenceSchema,
  pending_item: pendingItemSchema,
  restriction: restrictionSchema,
};

const BLOCK_SCHEMAS: Record<string, z.ZodType> = {
  identity: identitySchema,
  positioning: positioningSchema,
  availability_preferences: availabilityPreferencesSchema,
  career_preferences: careerPreferencesSchema,
  resume_preferences: resumePreferencesSchema,
  additional_professional_context: additionalProfessionalContextSchema,
  usage_rules: usageRulesSchema,
  review: reviewSchema,
};

const recordFieldCache = new Map<RecordKind, Set<string>>();
function fieldsOfKind(kind: RecordKind): Set<string> {
  let fields = recordFieldCache.get(kind);
  if (!fields) {
    fields = recordFieldNames(RECORD_SCHEMAS[kind]);
    recordFieldCache.set(kind, fields);
  }
  return fields;
}

let blockFieldCache: Set<string> | undefined;
/** Campos de blocos singleton, como `identity.pronouns` (sem o prefixo `profile.`). */
export function singletonFieldNames(): Set<string> {
  if (!blockFieldCache) {
    const names = new Set<string>();
    for (const [blockName, schema] of Object.entries(BLOCK_SCHEMAS)) {
      for (const field of recordFieldNames(schema)) {
        if (field !== 'restrictions') names.add(`${blockName}.${field}`);
      }
    }
    blockFieldCache = names;
  }
  return blockFieldCache;
}

const formatPath = (path: Path): string =>
  path.reduce<string>(
    (acc, segment) =>
      typeof segment === 'number' ? `${acc}[${segment}]` : acc ? `${acc}.${segment}` : segment,
    '',
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkTargetField(
  record: RecordEntry,
  byId: Map<string, RecordEntry>,
  ctx: z.RefinementCtx,
): void {
  const target = record.value.target;
  if (!isObject(target) || typeof target.field !== 'string') return;
  const fieldPath = [...record.path, 'target', 'field'];
  if (typeof target.record_id === 'string') {
    const referenced = byId.get(target.record_id);
    if (!referenced) return; // a referencia inexistente ja e reportada em outro ponto
    if (!fieldsOfKind(referenced.kind).has(target.field)) {
      ctx.addIssue({
        code: 'custom',
        message: `target.field "${target.field}" nao existe em registros do tipo ${referenced.kind}.`,
        path: fieldPath,
      });
    }
  } else {
    const normalized = target.field.replace(/^profile\./, '');
    if (!singletonFieldNames().has(normalized)) {
      ctx.addIssue({
        code: 'custom',
        message: `target.field "${target.field}" nao e um campo conhecido do perfil (ex.: identity.pronouns).`,
        path: fieldPath,
      });
    }
  }
}

function checkSkillUsage(
  usage: RecordEntry,
  byId: Map<string, RecordEntry>,
  ctx: z.RefinementCtx,
): void {
  const value = usage.value;
  const context = value.usage_context;
  if (typeof context !== 'string') return;
  const provided = SKILL_USAGE_SOURCE_FIELDS.filter(
    (field) => typeof value[field] === 'string' && value[field] !== '',
  );
  if (provided.length > 1) {
    ctx.addIssue({
      code: 'custom',
      message: `skill_usage aceita no maximo uma fonte, recebeu ${provided.length}: ${provided.join(', ')}.`,
      path: usage.path,
    });
    return;
  }
  const rule = USAGE_CONTEXT_SOURCES[context];
  if (!rule) return;
  const source = provided[0];
  if (source === undefined) {
    if (rule.required) {
      ctx.addIssue({
        code: 'custom',
        message: `usage_context "${context}" exige uma fonte (${rule.allowed.join(' ou ')}).`,
        path: usage.path,
      });
    }
    return;
  }
  if (!rule.allowed.includes(source)) {
    ctx.addIssue({
      code: 'custom',
      message: `usage_context "${context}" nao aceita a fonte ${source} (aceita: ${rule.allowed.join(' ou ')}).`,
      path: [...usage.path, source],
    });
    return;
  }
  // volunteer_experience via experiencia: a experiencia precisa ser voluntaria.
  if (context === 'volunteer_experience' && source === 'experience_id') {
    const experience = byId.get(String(value.experience_id));
    if (experience?.kind === 'experience' && experience.value.employment_type !== 'volunteer') {
      ctx.addIssue({
        code: 'custom',
        message:
          'volunteer_experience com experience_id exige experiencia com employment_type "volunteer".',
        path: [...usage.path, 'experience_id'],
      });
    }
  }
}

export function checkProfileIntegrity(document: unknown, ctx: z.RefinementCtx): void {
  const records = listRecords(document);

  // 1. ids unicos em todo o documento
  const byId = new Map<string, RecordEntry>();
  for (const record of records) {
    if (record.id === null) continue;
    const first = byId.get(record.id);
    if (first) {
      ctx.addIssue({
        code: 'custom',
        message: `Id duplicado "${record.id}" (primeira ocorrencia em ${formatPath(first.path)}).`,
        path: [...record.path, 'id'],
      });
    } else {
      byId.set(record.id, record);
    }
  }

  // 2. referencias resolvem e apontam para o tipo certo
  for (const reference of listReferences(document)) {
    const target = byId.get(reference.id);
    if (!target) {
      ctx.addIssue({
        code: 'custom',
        message: `Referencia para id inexistente "${reference.id}".`,
        path: reference.path,
      });
    } else if (!reference.targets.includes(target.kind)) {
      ctx.addIssue({
        code: 'custom',
        message: `Referencia "${reference.id}" aponta para ${target.kind}, mas so aceita: ${reference.targets.join(', ')}.`,
        path: reference.path,
      });
    }
  }

  // 3. competencias: chave normalizada unica por perfil
  const skillKeys = new Map<string, RecordEntry>();
  for (const record of records) {
    if (record.kind !== 'skill' || typeof record.value.name !== 'string') continue;
    const key = normalizeTerm(record.value.name);
    const first = skillKeys.get(key);
    if (first) {
      ctx.addIssue({
        code: 'custom',
        message: `Competencia duplicada "${record.value.name}" (igual a ${formatPath(first.path)}); mantenha uma e use skill_usages para os contextos.`,
        path: [...record.path, 'name'],
      });
    } else {
      skillKeys.set(key, record);
    }
  }

  // 4. contexto de uso de competencia coerente com a fonte (ADR-0007)
  for (const record of records) {
    if (record.kind === 'skill_usage') checkSkillUsage(record, byId, ctx);
    if (record.kind === 'pending_item' || record.kind === 'restriction') {
      checkTargetField(record, byId, ctx);
    }
  }
}
