import type { Prisma } from './generated/prisma/client';

/**
 * Registro central de isolamento (ADR-0008). TODO model do schema precisa estar em exatamente um
 * dos dois conjuntos abaixo; `test/private-models.test.ts` falha caso contrario.
 *
 * - PRIVATE_MODELS: dado privado de um dono. Tem coluna `ownerId`, `@@unique([id, ownerId])` e FKs
 *   compostas. So pode ser usado via `db.forOwner(ownerId)`; o cliente sem escopo lanca erro.
 * - GLOBAL_MODELS: sem dono (raiz de identidade ou anterior a ele). Cada entrada justifica a excecao.
 *
 * Ao adicionar um model: registre-o aqui no mesmo commit.
 */
type ModelName = Prisma.ModelName;

export const PRIVATE_MODELS = [
  'Credential',
  'Session',
  'ConsentRecord',
  'AuditEvent',
  // Agregado de perfil (S1.1b)
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
] as const satisfies readonly ModelName[];

export const GLOBAL_MODELS = {
  User: 'Raiz do dono: User.id e o ownerId dos demais. Acessado pela camada de auth.',
  Invite: 'Convite de cadastro: existe antes de haver usuario/dono (ADR-0009).',
} as const satisfies Partial<Record<ModelName, string>>;

/**
 * Relacoes de modelos GLOBAIS que levam a modelos privados (ex.: User.sessions). Atravessa-las a
 * partir do modelo global (include/select/where/data aninhado) contornaria o escopo, entao o
 * forOwner e o cliente global as rejeitam. O teste do registro confere esta lista contra o schema.
 */
export const PRIVATE_RELATIONS_OF_GLOBAL = {
  User: ['credentials', 'sessions', 'consentRecords', 'auditEvents', 'profiles'],
  Invite: [],
} as const satisfies Record<keyof typeof GLOBAL_MODELS, readonly string[]>;

const PRIVATE_RELATION_KEYS: ReadonlySet<string> = new Set(
  Object.values(PRIVATE_RELATIONS_OF_GLOBAL).flat(),
);

export function isPrivateRelationKey(key: string): boolean {
  return PRIVATE_RELATION_KEYS.has(key);
}

export type PrivateModelName = (typeof PRIVATE_MODELS)[number];
export type GlobalModelName = keyof typeof GLOBAL_MODELS;

const PRIVATE_SET: ReadonlySet<string> = new Set(PRIVATE_MODELS);

export function isPrivateModel(model: string): model is PrivateModelName {
  return PRIVATE_SET.has(model);
}
