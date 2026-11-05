import { z } from 'zod';
import {
  FACT_KINDS,
  RECORD_KIND_VALUES,
  factStatusSchema,
  fieldStateSchema,
  resumeUseSchema,
  visibilitySchema,
  type RecordKind,
} from '../common/enums';
import { fieldNameSchema } from '../common/primitives';
import { IMPORT_SOURCE_FORMATS, importWarningSchema } from '../profile/import-report';
import { profileDocumentSchema, profileSchema } from '../profile/v2/document';
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
  skillSchema,
  skillUsageSchema,
  statementSchema,
  volunteeringSchema,
} from '../profile/v2/records';

/**
 * DTOs do modulo de perfil (S2.1a): `/api/profile/**`. Reutilizam os schemas do contrato 2.1.0
 * (`profileDocumentSchema`, schemas de registro): nada do contrato e duplicado aqui.
 *
 * Convencoes de transporte (iguais as de `auth.ts`): sessao por cookie HttpOnly, `X-CSRF-Token` nos
 * metodos nao seguros, erros em `apiErrorBodySchema`. TODA rota deste modulo exige o consentimento
 * `profile_processing` vigente (`403 CONSENT_REQUIRED_FOR_PROFILE`). O dono vem SEMPRE da sessao:
 * nenhum DTO carrega `ownerId`. Recurso inexistente e recurso de outro dono respondem igual (`404 NOT_FOUND`);
 * ids de recurso malformados tambem.
 *
 * Ausencia (ADR-0005): em registros e blocos, omitido/`null` = nao informado; `[]` = nenhum item.
 */

// --- Primitivas ----------------------------------------------------------------------------

/** Id de registro persistido: UUID (minusculo na resposta; a API aceita qualquer caixa). */
export const profileRecordIdSchema = z.uuid();

export const recordKindSchema = z.enum(RECORD_KIND_VALUES);

/** `onMissing` do ProfileStore: o que fazer com registros do banco que o documento enviado omite. */
export const ON_MISSING_VALUES = ['keep', 'archive', 'delete'] as const;
export const onMissingSchema = z.enum(ON_MISSING_VALUES);
export type OnMissingMode = z.infer<typeof onMissingSchema>;

export const PROFILE_BLOCK_SECTIONS = [
  'identity',
  'positioning',
  'availability_preferences',
  'career_preferences',
  'resume_preferences',
  'additional_professional_context',
  'usage_rules',
  'review',
] as const;
export const PROFILE_COLLECTION_SECTIONS = [
  'contact_points',
  'statements',
  'competency_examples',
  'experiences',
  'projects',
  'education',
  'courses',
  'skills',
  'skill_usages',
  'languages',
  'certifications',
  'awards',
  'publications',
  'volunteering',
  'evidence',
  'pending_items',
] as const;
/** Todas as secoes de `profile` (blocos singleton + colecoes de topo). Igual as chaves de `profileSchema`. */
export const PROFILE_SECTIONS = [
  ...PROFILE_BLOCK_SECTIONS,
  ...PROFILE_COLLECTION_SECTIONS,
] as const;
export const profileSectionSchema = z.enum(PROFILE_SECTIONS);
export type ProfileSection = z.infer<typeof profileSectionSchema>;

export function isBlockSection(section: ProfileSection): boolean {
  return (PROFILE_BLOCK_SECTIONS as readonly string[]).includes(section);
}

/** Schema do VALOR de uma secao (bloco ou lista de registros), incluindo `null` (nao informado). */
export function profileSectionValueSchema(section: ProfileSection): z.ZodType {
  return profileSchema.shape[section];
}

// --- Registros (por tipo) ------------------------------------------------------------------

/** Schema de cada tipo de registro (os mesmos que validam o documento). */
export const PROFILE_RECORD_SCHEMAS: Readonly<Record<RecordKind, z.ZodType>> = {
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

/** Registros aninhados: tipo do pai exigido em `parentId` na criacao. */
export const RECORD_PARENT_KIND: Readonly<Partial<Record<RecordKind, RecordKind>>> = {
  experience_item: 'experience',
  project_item: 'project',
  collaborator: 'project',
};

/** Tipos com `meta` de governanca (status, visibilidade, uso): os "fatos" citaveis (ADR-0006). */
export const GOVERNED_RECORD_KINDS: readonly RecordKind[] = FACT_KINDS;
export function isGovernedKind(kind: RecordKind): boolean {
  return (GOVERNED_RECORD_KINDS as readonly string[]).includes(kind);
}

// --- Estado do perfil (GET /api/profile e respostas de escrita) ----------------------------

export const profileMetaSchema = z.strictObject({
  id: profileRecordIdSchema,
  /** Versao do contrato com que o perfil foi gravado (a leitura sempre emite a corrente). */
  storedSchemaVersion: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProfileMeta = z.infer<typeof profileMetaSchema>;

const countSchema = z.number().int().nonnegative();

export const profileSummarySchema = z.strictObject({
  /** Todos os registros com id (fatos + contatos, evidencias, pendencias, restricoes, colaboradores). */
  recordCount: countSchema,
  /** Fatos (registros com `meta`) por status efetivo; sem `meta` conta como `needs_review` (ADR-0006). */
  byStatus: z.strictObject({
    confirmed: countSchema,
    needs_review: countSchema,
    conflicting: countSchema,
    archived: countSchema,
  }),
  pending: z.strictObject({ open: countSchema, resolved: countSchema, dismissed: countSchema }),
  evidenceCount: countSchema,
  /** Registros por tipo (`experience`, `skill`, ...). */
  byKind: z.record(z.string(), countSchema),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

/** `GET /api/profile`. Sem perfil ainda: `exists = false`, `profile = null`, `document = null`, contagens zeradas. */
export const profileStateResponseSchema = z.strictObject({
  exists: z.boolean(),
  profile: profileMetaSchema.nullable(),
  document: profileDocumentSchema.nullable(),
  summary: profileSummarySchema,
});
export type ProfileStateResponse = z.infer<typeof profileStateResponseSchema>;

export const applySummarySchema = z.strictObject({
  created: z.record(z.string(), countSchema),
  updated: z.record(z.string(), countSchema),
  unchanged: z.record(z.string(), countSchema),
  archived: z.record(z.string(), countSchema),
  deleted: z.record(z.string(), countSchema),
  kept: z.record(z.string(), countSchema),
  totals: z.strictObject({
    created: countSchema,
    updated: countSchema,
    unchanged: countSchema,
    archived: countSchema,
    deleted: countSchema,
    kept: countSchema,
  }),
});
export type ApplySummaryDto = z.infer<typeof applySummarySchema>;

export const REVISION_REASONS = ['manual_save', 'import', 'pre_generation', 'migration'] as const;
export const revisionReasonSchema = z.enum(REVISION_REASONS);

export const revisionSummarySchema = z.strictObject({
  id: profileRecordIdSchema,
  revisionNumber: z.number().int().positive(),
  schemaVersion: z.string(),
  /** SHA-256 hex do JSON canonico do snapshot. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: revisionReasonSchema,
  createdAt: z.iso.datetime(),
});
export type RevisionSummaryDto = z.infer<typeof revisionSummarySchema>;

export const saveResultSchema = z.strictObject({
  profileCreated: z.boolean(),
  summary: applySummarySchema,
  /** Registros sem id que receberam um (novos). */
  generatedIds: countSchema,
  revision: z.strictObject({ revision: revisionSummarySchema, reused: z.boolean() }).nullable(),
});
export type SaveResultDto = z.infer<typeof saveResultSchema>;

/** Resposta das escritas de documento/secao: o que mudou + o estado resultante. */
export const profileWriteResponseSchema = z.strictObject({
  save: saveResultSchema,
  state: profileStateResponseSchema,
});
export type ProfileWriteResponse = z.infer<typeof profileWriteResponseSchema>;

// --- Documento e secoes --------------------------------------------------------------------

/**
 * `PUT /api/profile`: salva o documento inteiro. Registros SEM id sao criados (a API gera o id);
 * registros COM id precisam ja existir neste perfil (id desconhecido -> `400 VALIDATION_ERROR`,
 * sem distinguir "de outro dono"). `onMissing` (padrao `keep`): o que fazer com registros que o
 * documento omite; `archive` e `delete` so entram quando o cliente pede explicitamente.
 */
export const saveProfileRequestSchema = z.strictObject({
  document: profileDocumentSchema,
  onMissing: onMissingSchema.default('keep'),
  /** Cria (ou reutiliza, pelo hash) uma `ProfileRevision` `manual_save` na mesma transacao. */
  createRevision: z.boolean().default(false),
});
export type SaveProfileRequest = z.input<typeof saveProfileRequestSchema>;

/** `GET /api/profile/sections/:section`. */
export const profileSectionResponseSchema = z.strictObject({
  section: profileSectionSchema,
  /** Bloco (objeto), lista de registros ou `null` (nao informado). */
  value: z.unknown(),
});
export type ProfileSectionResponse = z.infer<typeof profileSectionResponseSchema>;

/**
 * `PUT /api/profile/sections/:section`: substitui o valor da secao. `value` e validado contra o schema da
 * secao (`profileSectionValueSchema`). Em colecoes, registros omitidos continuam (`onMissing: keep`).
 */
export const saveSectionRequestSchema = z.strictObject({
  value: z.unknown(),
  onMissing: onMissingSchema.default('keep'),
  createRevision: z.boolean().default(false),
});
export type SaveSectionRequest = z.input<typeof saveSectionRequestSchema>;

// --- Registros: CRUD, governanca, arquivamento, confirmacao em lote ------------------------

/** Registro serializado com o tipo, o pai (aninhados) e a secao onde mora. */
export const profileRecordResponseSchema = z.strictObject({
  kind: recordKindSchema,
  /** Id do registro pai (item de experiencia/projeto, colaborador); `null` nos demais. */
  parentId: profileRecordIdSchema.nullable(),
  /** Secao de topo que contem o registro (`experiences`, `usage_rules`, ...). */
  section: profileSectionSchema,
  record: z.record(z.string(), z.unknown()),
});
export type ProfileRecordResponse = z.infer<typeof profileRecordResponseSchema>;

export const profileRecordWriteResponseSchema = profileRecordResponseSchema.extend({
  save: saveResultSchema,
});
export type ProfileRecordWriteResponse = z.infer<typeof profileRecordWriteResponseSchema>;

/**
 * `POST /api/profile/records`: cria um registro. O id e sempre gerado pelo servidor (`record.id` presente
 * -> 400). `parentId` e obrigatorio para `experience_item` (experiencia), `project_item` e `collaborator`
 * (projeto) e proibido nos demais. `record` e validado pelo schema do `kind` (campos exatos do contrato).
 * `restriction` mora em `usage_rules.restrictions`.
 */
export interface CreateRecordRequest {
  kind: RecordKind;
  parentId?: string | undefined;
  record: Record<string, unknown>;
}
export const createRecordRequestSchema: z.ZodType<CreateRecordRequest> = z
  .strictObject({
    kind: recordKindSchema,
    parentId: profileRecordIdSchema.optional(),
    record: z.record(z.string(), z.unknown()),
  })
  .superRefine((request, ctx) => {
    const requiredParent = RECORD_PARENT_KIND[request.kind];
    if (requiredParent && !request.parentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: `parentId (${requiredParent}) e obrigatorio para ${request.kind}.`,
      });
    }
    if (!requiredParent && request.parentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: `${request.kind} nao tem registro pai.`,
      });
    }
    if (request.record.id !== undefined && request.record.id !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['record', 'id'],
        message: 'O id do registro e gerado pelo servidor: omita record.id.',
      });
    }
  });

/** `PUT /api/profile/records/:recordId`: substitui o registro (o tipo vem do registro existente; `record.id`, se enviado, deve ser o da rota). */
export const replaceRecordRequestSchema = z.strictObject({
  record: z.record(z.string(), z.unknown()),
});
export type ReplaceRecordRequest = z.infer<typeof replaceRecordRequestSchema>;

/**
 * `PATCH /api/profile/records/:recordId/meta`: controles de governanca de um FATO. Ao menos um campo.
 * `field_states` e um patch por chave (`null` remove o estado). `status: archived` implica
 * `resume_use: never`; um registro arquivado so aceita `resume_use: never`.
 */
export const patchRecordMetaRequestSchema = z
  .strictObject({
    status: factStatusSchema.optional(),
    visibility: visibilitySchema.optional(),
    resume_use: resumeUseSchema.optional(),
    field_states: z.record(fieldNameSchema, fieldStateSchema.nullable()).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Informe ao menos um campo.' });
export type PatchRecordMetaRequest = z.infer<typeof patchRecordMetaRequestSchema>;

export const MAX_CONFIRM_BATCH = 500;
/**
 * `POST /api/profile/confirmations`: confirma (needs_review -> confirmed) EXATAMENTE os ids listados.
 * Nao existe "confirmar tudo". Ids repetidos sao rejeitados.
 */
export const confirmRecordsRequestSchema = z
  .strictObject({
    recordIds: z.array(profileRecordIdSchema).min(1).max(MAX_CONFIRM_BATCH),
  })
  .refine(
    (body) => new Set(body.recordIds.map((id) => id.toLowerCase())).size === body.recordIds.length,
    {
      path: ['recordIds'],
      message: 'Ids repetidos.',
    },
  );
export type ConfirmRecordsRequest = z.infer<typeof confirmRecordsRequestSchema>;

export const CONFIRM_SKIP_REASONS = ['not_found', 'not_a_fact', 'not_needs_review'] as const;
export const confirmRecordsResponseSchema = z.strictObject({
  /** Ids confirmados agora. */
  confirmed: z.array(profileRecordIdSchema),
  /** Ids ignorados; `not_found` cobre inexistente e de outro dono (indistinguiveis). */
  skipped: z.array(
    z.strictObject({ recordId: profileRecordIdSchema, reason: z.enum(CONFIRM_SKIP_REASONS) }),
  ),
  summary: profileSummarySchema,
});
export type ConfirmRecordsResponse = z.infer<typeof confirmRecordsResponseSchema>;

/** `DELETE /api/profile/records/:recordId` e a unica remocao definitiva de registro. */
export const deleteRecordResponseSchema = z.strictObject({
  deleted: z.strictObject({ kind: recordKindSchema, id: profileRecordIdSchema }),
  save: saveResultSchema,
  summary: profileSummarySchema,
});
export type DeleteRecordResponse = z.infer<typeof deleteRecordResponseSchema>;

// --- Evidencias e pendencias ---------------------------------------------------------------

export const recordRefSchema = z.strictObject({
  recordId: profileRecordIdSchema,
  kind: recordKindSchema,
});
export type RecordRef = z.infer<typeof recordRefSchema>;

export const evidenceEntrySchema = z.strictObject({
  record: z.record(z.string(), z.unknown()),
  /** Uniao de `evidence.supports` e dos fatos que citam a evidencia em `meta.evidence_ids` (a mesma relacao). */
  links: z.array(recordRefSchema),
});
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;

/** `GET /api/profile/evidence`. */
export const evidenceListResponseSchema = z.strictObject({
  evidence: z.array(evidenceEntrySchema),
});
export type EvidenceListResponse = z.infer<typeof evidenceListResponseSchema>;

/** `GET /api/profile/evidence/:evidenceId/links` e respostas de `POST`/`DELETE` de vinculo. */
export const evidenceLinksResponseSchema = z.strictObject({
  evidenceId: profileRecordIdSchema,
  links: z.array(recordRefSchema),
});
export type EvidenceLinksResponse = z.infer<typeof evidenceLinksResponseSchema>;

/** `POST /api/profile/evidence/:evidenceId/links`: vincula a evidencia a um FATO do perfil. */
export const linkEvidenceRequestSchema = z.strictObject({ recordId: profileRecordIdSchema });
export type LinkEvidenceRequest = z.infer<typeof linkEvidenceRequestSchema>;

export const PENDING_STATUS_FILTERS = ['open', 'resolved', 'dismissed', 'all'] as const;
/** `GET /api/profile/pending?status=open|resolved|dismissed|all` (padrao `open`). */
export const pendingListQuerySchema = z.strictObject({
  status: z.enum(PENDING_STATUS_FILTERS).default('open'),
});
export type PendingListQuery = z.input<typeof pendingListQuerySchema>;

export const pendingEntrySchema = z.strictObject({
  record: z.record(z.string(), z.unknown()),
  /** Tipo do registro-alvo (`target.record_id`), se existir no perfil. */
  targetKind: recordKindSchema.nullable(),
});
export type PendingEntry = z.infer<typeof pendingEntrySchema>;

export const pendingListResponseSchema = z.strictObject({
  pending: z.array(pendingEntrySchema),
  counts: z.strictObject({ open: countSchema, resolved: countSchema, dismissed: countSchema }),
});
export type PendingListResponse = z.infer<typeof pendingListResponseSchema>;

/** `PATCH /api/profile/pending/:pendingId`: muda so o estado da pendencia (o resto: `PUT /records/:id`). */
export const patchPendingRequestSchema = z.strictObject({
  status: z.enum(['open', 'resolved', 'dismissed']),
});
export type PatchPendingRequest = z.infer<typeof patchPendingRequestSchema>;

// --- Revisoes ------------------------------------------------------------------------------

/** `POST /api/profile/revisions`. `201` quando cria; `200` + `reused: true` quando o hash nao mudou. */
export const createRevisionRequestSchema = z.strictObject({
  reason: z.enum(['manual_save', 'pre_generation']).default('manual_save'),
});
export type CreateRevisionRequest = z.input<typeof createRevisionRequestSchema>;

export const createRevisionResponseSchema = z.strictObject({
  revision: revisionSummarySchema,
  reused: z.boolean(),
});
export type CreateRevisionResponse = z.infer<typeof createRevisionResponseSchema>;

/** `GET /api/profile/revisions?limit=&before=` (paginacao por numero de revisao, mais novas primeiro). */
export const listRevisionsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
});
export type ListRevisionsQuery = z.input<typeof listRevisionsQuerySchema>;

export const listRevisionsResponseSchema = z.strictObject({
  revisions: z.array(revisionSummarySchema),
  /** Passe em `before` para a pagina seguinte; `null` = fim. */
  nextBefore: z.number().int().positive().nullable(),
});
export type ListRevisionsResponse = z.infer<typeof listRevisionsResponseSchema>;

/** `GET /api/profile/revisions/:revisionId`. */
export const revisionDetailResponseSchema = z.strictObject({
  revision: revisionSummarySchema,
  /** Snapshot imutavel, na versao do contrato em `revision.schemaVersion`. */
  snapshot: z.record(z.string(), z.unknown()),
  /** O hash recalculado a partir do snapshot confere com `revision.contentHash`. */
  verified: z.boolean(),
});
export type RevisionDetailResponse = z.infer<typeof revisionDetailResponseSchema>;

// --- Importacao ----------------------------------------------------------------------------

export const IMPORT_TEXT_FORMATS = ['auto', 'yaml', 'json'] as const;
export const IMPORT_STATUSES = ['preview', 'applied', 'discarded'] as const;

/**
 * `POST /api/profile/imports/preview` com `Content-Type: application/json`. O texto e DADO nao confiavel:
 * limite `UPLOAD_MAX_BYTES` (413), parse seguro do profile-io. Tambem aceito (corpo = o proprio texto):
 * `text/yaml`, `application/yaml`, `application/x-yaml` (formato yaml) e `text/plain` (formato `auto`); nesse caso
 * `mode` vem da query `?mode=strict|lenient`.
 */
export const importPreviewRequestSchema = z.strictObject({
  format: z.enum(IMPORT_TEXT_FORMATS).default('auto'),
  text: z.string().min(1),
  /** `strict` rejeita chaves desconhecidas; `lenient` as preserva em `unmapped` com aviso. */
  mode: z.enum(['strict', 'lenient']).default('strict'),
});
export type ImportPreviewRequest = z.input<typeof importPreviewRequestSchema>;

export const importPreviewQuerySchema = z.strictObject({
  mode: z.enum(['strict', 'lenient']).default('strict'),
});

const importErrorViewSchema = z.strictObject({
  path: z.string(),
  code: z.string(),
  /** Texto fixo por codigo: nunca ecoa o conteudo enviado. */
  message: z.string(),
});

const importStepViewSchema = z.strictObject({
  id: z.string(),
  from: z.string().nullable(),
  to: z.string(),
  description: z.string(),
  changes: countSchema,
});

/** Espelho de `ImportPreview` (`@chameleon/profile-io`); um teste da API confere a compatibilidade. */
export const importPreviewSchema = z.strictObject({
  source_schema_version: z.string().nullable(),
  target_schema_version: z.string(),
  totals: z.strictObject({
    records: countSchema,
    create: countSchema,
    update: countSchema,
    unchanged: countSchema,
    discarded: countSchema,
    needs_review: countSchema,
  }),
  collections: z.record(
    z.string(),
    z.strictObject({
      incoming: countSchema,
      create: countSchema,
      update: countSchema,
      unchanged: countSchema,
    }),
  ),
  singletons: z.record(z.string(), z.strictObject({ fields_set: countSchema })),
  records: z.array(
    z.strictObject({
      kind: recordKindSchema,
      id: z.string(),
      path: z.string(),
      /** Tipo + posicao no arquivo (`experience #2`); nunca conteudo. */
      label: z.string(),
      action: z.enum(['create', 'update', 'unchanged']),
      changed_fields: z.array(z.string()),
      declared_status: z.string().nullable(),
    }),
  ),
  discarded: z.array(z.strictObject({ path: z.string(), reason: z.string() })),
  warnings_by_code: z.record(z.string(), countSchema),
  unmapped_count: countSchema,
  /** Registros do perfil atual que o arquivo nao menciona (continuam no `merge`; em `replace` sao arquivados/removidos). */
  untouched_existing: countSchema,
});
export type ImportPreviewDto = z.infer<typeof importPreviewSchema>;

export const unmappedEntryViewSchema = z.strictObject({
  path: z.string(),
  /** Valor descartado: dado DO DONO (so ele o recebe). Limitado a 200 entradas na resposta. */
  value: z.unknown(),
  reason: z.string(),
});

export const importRecordSchema = z.strictObject({
  id: profileRecordIdSchema,
  status: z.enum(IMPORT_STATUSES),
  sourceFormat: z.enum(IMPORT_SOURCE_FORMATS),
  sourceSchemaVersion: z.string().nullable(),
  targetSchemaVersion: z.string(),
  mode: z.enum(['strict', 'lenient']),
  steps: z.array(importStepViewSchema),
  warnings: z.array(importWarningSchema),
  errors: z.array(importErrorViewSchema),
  /** id local do arquivo -> UUID gravado. */
  idMap: z.record(z.string(), z.string()),
  unmappedCount: countSchema,
  /** Contagens da aplicacao (so apos `applied`). */
  summary: applySummarySchema.partial(),
  revisionId: profileRecordIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  appliedAt: z.iso.datetime().nullable(),
});
export type ImportRecordDto = z.infer<typeof importRecordSchema>;

/** `201` de `POST /api/profile/imports/preview`. Nada foi aplicado. */
export const importPreviewResponseSchema = z.strictObject({
  importRecord: importRecordSchema,
  preview: importPreviewSchema,
  /** Mesmos avisos de `importRecord.warnings`, em destaque para a tela. */
  warnings: z.array(importWarningSchema),
  unmapped: z.array(unmappedEntryViewSchema),
  /** A previa fica disponivel para aplicar por este tempo (ISO). Depois: `409 IMPORT_PREVIEW_EXPIRED`. */
  expiresAt: z.iso.datetime(),
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

/** `GET /api/profile/imports/:importRecordId`. `preview` so existe enquanto a previa esta em memoria. */
export const importDetailResponseSchema = z.strictObject({
  importRecord: importRecordSchema,
  preview: importPreviewSchema.nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type ImportDetailResponse = z.infer<typeof importDetailResponseSchema>;

export const listImportsQuerySchema = z.strictObject({
  status: z.enum(IMPORT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListImportsQuery = z.input<typeof listImportsQuerySchema>;

export const listImportsResponseSchema = z.strictObject({
  imports: z.array(importRecordSchema),
});
export type ListImportsResponse = z.infer<typeof listImportsResponseSchema>;

/**
 * `POST /api/profile/imports/:importRecordId/apply`. `merge` nunca remove nada. `replace` arquiva fatos
 * ausentes do arquivo e REMOVE contatos, evidencias, pendencias e restricoes ausentes: exige
 * `confirmReplace: true`. Em ambos, tudo que foi importado fica `needs_review` (`archived` continua
 * `archived`), exceto registros sem mudanca, que mantem a governanca atual. Uma revisao do estado
 * anterior e criada antes de aplicar.
 */
export const applyImportRequestSchema = z
  .strictObject({
    mode: z.enum(['merge', 'replace']),
    confirmReplace: z.boolean().default(false),
    /** Se algum id do arquivo ja pertence a outra pessoa (arquivo exportado por outra conta), gera ids novos em vez de `409 ID_CONFLICT`. */
    regenerateConflictingIds: z.boolean().default(false),
  })
  .refine((body) => body.mode !== 'replace' || body.confirmReplace, {
    path: ['confirmReplace'],
    message: 'replace exige confirmReplace: true.',
  });
export type ApplyImportRequest = z.input<typeof applyImportRequestSchema>;

export const applyImportResponseSchema = z.strictObject({
  importRecord: importRecordSchema,
  save: saveResultSchema,
  /** Revisao criada ao aplicar. */
  revision: z.strictObject({ revision: revisionSummarySchema, reused: z.boolean() }),
  /** Revisao do estado ANTERIOR (para voltar atras); `null` se nao havia perfil. */
  previousRevision: revisionSummarySchema.nullable(),
  /** Ids regenerados por conflito (contagem). */
  idRemapCount: countSchema,
  summary: profileSummarySchema,
});
export type ApplyImportResponse = z.infer<typeof applyImportResponseSchema>;

export const discardImportResponseSchema = z.strictObject({ importRecord: importRecordSchema });
export type DiscardImportResponse = z.infer<typeof discardImportResponseSchema>;

// --- Exportacao ----------------------------------------------------------------------------

export const EXPORT_FORMATS = ['yaml', 'json'] as const;
/** `GET /api/profile/export?format=yaml|json` (padrao `yaml`). Corpo = o documento 2.1.0 canonico. */
export const exportQuerySchema = z.strictObject({
  format: z.enum(EXPORT_FORMATS).default('yaml'),
});
export type ExportQuery = z.input<typeof exportQuerySchema>;

export const EXPORT_CONTENT_TYPES = {
  yaml: 'application/yaml; charset=utf-8',
  json: 'application/json; charset=utf-8',
} as const;
