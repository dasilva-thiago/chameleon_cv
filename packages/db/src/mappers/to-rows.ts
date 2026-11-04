import {
  isFactKind,
  normalizeTerm,
  TOP_LEVEL_COLLECTIONS,
  type ProfileDocument,
} from '@chameleon/contracts';
import { ProfileStoreError } from '../profile-store/errors';
import { encodeRecord, isJsonObject, type Json, type Row } from './codec';
import {
  COLLABORATOR_SPEC,
  CONTACT_SPEC,
  EVIDENCE_SPEC,
  FACT_SPEC_BY_KIND,
  JSON_COLUMNS,
  META_KEYS,
  type DelegateName,
  type FactKindName,
  type PlainSpec,
} from './specs';

/**
 * Documento (canonico, com UUIDs) -> linhas de todas as tabelas do agregado. Funcao PURA: sem I/O,
 * sem relogio (timestamps gerenciados, como confirmedAt/archivedAt, sao responsabilidade do store).
 */

export interface RowsContext {
  ownerId: string;
  profileId: string;
}

export type TableRows = Record<DelegateName, Row[]>;

export interface DocumentRows {
  /** Colunas escalares do ProfessionalProfile (sem id/ownerId/isPrimary/timestamps). */
  profile: Row;
  /** Linhas por tabela (ProfessionalProfile nao entra: e a raiz). */
  tables: TableRows;
}

export const DELEGATE_NAMES: readonly DelegateName[] = [
  'professionalProfile',
  'profileFact',
  'profileStatement',
  'competencyExample',
  'competencyExampleSkill',
  'experience',
  'experienceItem',
  'project',
  'projectItem',
  'projectCollaborator',
  'education',
  'course',
  'skill',
  'skillUsage',
  'languageProficiency',
  'certification',
  'award',
  'publication',
  'volunteering',
  'contactPoint',
  'evidence',
  'evidenceLink',
  'pendingItem',
  'usageRestriction',
];

export function emptyTables(): TableRows {
  return Object.fromEntries(DELEGATE_NAMES.map((name) => [name, [] as Row[]])) as TableRows;
}

const HAS_DETAILS = new Set<DelegateName>(
  (Object.entries(JSON_COLUMNS) as [DelegateName, readonly string[]][])
    .filter(([, columns]) => columns.includes('details'))
    .map(([name]) => name),
);

/** Colecao de topo de fatos (chave do contrato -> kind). */
const FACT_COLLECTIONS = TOP_LEVEL_COLLECTIONS.filter((c) => isFactKind(c.kind)) as readonly {
  key: string;
  kind: FactKindName;
}[];

/** Blocos singleton: chave do contrato -> coluna. */
export const BLOCK_COLUMNS = {
  identity: 'identity',
  positioning: 'positioning',
  availability_preferences: 'availabilityPreferences',
  career_preferences: 'careerPreferences',
  resume_preferences: 'resumePreferences',
  additional_professional_context: 'additionalContext',
  usage_rules: 'usageRules',
  review: 'review',
} as const;

const asRecords = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(isJsonObject) : [];

/** Remove repeticoes preservando a ordem (listas de referencias nao admitem duplicata no banco). */
const uniqueIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string'))]
    : [];

function detailsOf(
  delegate: DelegateName,
  details: Json | null,
  markers: Json,
  record: string,
): Json | null {
  const merged: Json = { ...(details ?? {}), ...markers };
  if (Object.keys(merged).length === 0) return null;
  if (!HAS_DETAILS.has(delegate)) {
    throw new ProfileStoreError(
      'UNMAPPED_FIELD',
      `Campo(s) sem coluna em ${record}: ${Object.keys(merged).join(', ')}. Atualize o mapeamento relacional.`,
    );
  }
  return merged;
}

export function documentToRows(document: ProfileDocument, ctx: RowsContext): DocumentRows {
  const profile = document.profile as unknown as Json;
  const tables = emptyTables();
  const { ownerId, profileId } = ctx;

  // id -> categoria de alvo (fato, contato, evidencia) para pendencias e restricoes
  const targetKind = new Map<string, 'fact' | 'contact' | 'evidence'>();
  for (const collection of TOP_LEVEL_COLLECTIONS) {
    for (const record of asRecords(profile[collection.key])) {
      const id = record.id;
      if (typeof id !== 'string') continue;
      targetKind.set(
        id,
        collection.kind === 'contact_point'
          ? 'contact'
          : collection.kind === 'evidence'
            ? 'evidence'
            : 'fact',
      );
      for (const nestedKey of ['items']) {
        for (const child of asRecords(record[nestedKey])) {
          if (typeof child.id === 'string') targetKind.set(child.id, 'fact');
        }
      }
    }
  }

  const evidenceLinks = new Map<string, Row>();
  const upsertLink = (evidenceId: string, factId: string, patch: Row): void => {
    const key = `${evidenceId}|${factId}`;
    const link = evidenceLinks.get(key) ?? {
      ownerId,
      evidenceId,
      factId,
      supportsPosition: null,
      evidenceIdsPosition: null,
    };
    Object.assign(link, patch);
    evidenceLinks.set(key, link);
  };

  // ------------------------------------------------------------------ fatos
  function addFact(
    kind: FactKindName,
    record: Json,
    sortOrder: number,
    parent?: { prop: 'experienceId' | 'projectId'; id: string },
  ): string {
    const spec = FACT_SPEC_BY_KIND.get(kind);
    if (!spec) throw new ProfileStoreError('UNMAPPED_FIELD', `Tipo de fato sem spec: ${kind}`);
    const id = record.id as string;
    const encoded = encodeRecord(record, spec);
    const markers: Json = {};

    // --- meta -> ProfileFact
    const meta = isJsonObject(record.meta) ? record.meta : null;
    const metaKeys = meta ? META_KEYS.filter((key) => meta[key] !== undefined) : [];
    tables.profileFact.push({
      id,
      ownerId,
      profileId,
      kind,
      status: meta?.status ?? 'needs_review',
      declaredStatus: meta?.declared_status ?? null,
      visibility: meta?.visibility ?? 'private',
      resumeUse: meta?.resume_use ?? 'requires_approval',
      source: meta?.source ?? 'other',
      sourceDetail: meta?.source_detail ?? null,
      sourceExcerpt: meta?.source_excerpt ?? null,
      privateNotes: meta?.private_notes ?? null,
      fieldStates: isJsonObject(meta?.field_states) ? meta.field_states : {},
      metaPresent: meta !== null,
      metaKeys,
      sortOrder,
    });
    if (meta && Array.isArray(meta.evidence_ids)) {
      uniqueIds(meta.evidence_ids).forEach((evidenceId, position) =>
        upsertLink(evidenceId, id, { evidenceIdsPosition: position }),
      );
    }

    // --- filhos e vinculos especiais
    if (kind === 'competency_example' && Array.isArray(record.related_skill_ids)) {
      const skillIds = uniqueIds(record.related_skill_ids);
      if (skillIds.length === 0) markers.related_skill_ids = [];
      skillIds.forEach((skillId, position) =>
        tables.competencyExampleSkill.push({ ownerId, exampleId: id, skillId, position }),
      );
    }
    if (kind === 'experience' && Array.isArray(record.items)) {
      if (record.items.length === 0) markers.items = [];
      asRecords(record.items).forEach((item, index) =>
        addFact('experience_item', item, index, { prop: 'experienceId', id }),
      );
    }
    if (kind === 'project') {
      if (Array.isArray(record.items)) {
        if (record.items.length === 0) markers.items = [];
        asRecords(record.items).forEach((item, index) =>
          addFact('project_item', item, index, { prop: 'projectId', id }),
        );
      }
      if (Array.isArray(record.collaborators)) {
        if (record.collaborators.length === 0) markers.collaborators = [];
        asRecords(record.collaborators).forEach((collaborator, index) => {
          const encodedCollaborator = encodeRecord(collaborator, COLLABORATOR_SPEC);
          if (encodedCollaborator.details) {
            throw new ProfileStoreError(
              'UNMAPPED_FIELD',
              `Campo(s) sem coluna em colaborador: ${Object.keys(encodedCollaborator.details).join(', ')}.`,
            );
          }
          tables.projectCollaborator.push({
            id: collaborator.id,
            ownerId,
            projectId: id,
            ...encodedCollaborator.columns,
            sortOrder: index,
          });
        });
      }
    }

    // --- linha tipada
    const typed: Row = { id, ownerId, ...encoded.columns };
    if (parent) typed[parent.prop] = parent.id;
    if (kind === 'skill') {
      typed.profileId = profileId;
      typed.normalizedKey = normalizeTerm(String(record.name));
    }
    typed.details = detailsOf(spec.delegate, encoded.details, markers, kind);
    if (!HAS_DETAILS.has(spec.delegate)) delete typed.details;
    tables[spec.delegate].push(typed);
    return id;
  }

  for (const collection of FACT_COLLECTIONS) {
    asRecords(profile[collection.key]).forEach((record, index) =>
      addFact(collection.kind, record, index),
    );
  }

  // ------------------------------------------------- registros nao citaveis
  function addPlain(spec: PlainSpec, record: Json, sortOrder: number, markers: Json = {}): Row {
    const encoded = encodeRecord(record, spec);
    const row: Row = { id: record.id, ownerId, profileId, ...encoded.columns, sortOrder };
    const details = detailsOf(spec.delegate, encoded.details, markers, spec.delegate);
    if (HAS_DETAILS.has(spec.delegate)) row.details = details;
    tables[spec.delegate].push(row);
    return row;
  }

  asRecords(profile.contact_points).forEach((record, index) =>
    addPlain(CONTACT_SPEC, record, index),
  );

  asRecords(profile.evidence).forEach((record, index) => {
    const id = record.id as string;
    const markers: Json = {};
    if (Array.isArray(record.supports)) {
      const supports = uniqueIds(record.supports);
      if (supports.length === 0) markers.supports = [];
      supports.forEach((factId, position) =>
        upsertLink(id, factId, { supportsPosition: position }),
      );
    }
    addPlain(EVIDENCE_SPEC, record, index, markers);
  });

  const targetColumns = (recordId: unknown): Row => {
    const columns: Row = {
      targetFactId: null,
      targetContactPointId: null,
      targetEvidenceId: null,
    };
    if (typeof recordId !== 'string') return columns;
    const category = targetKind.get(recordId);
    if (category === 'contact') columns.targetContactPointId = recordId;
    else if (category === 'evidence') columns.targetEvidenceId = recordId;
    else columns.targetFactId = recordId;
    return columns;
  };

  asRecords(profile.pending_items).forEach((record, index) => {
    const target = isJsonObject(record.target) ? record.target : null;
    const details: Json = {};
    if (Array.isArray(record.known_variants)) details.known_variants = record.known_variants;
    if (target && target.record_id === undefined && target.field === undefined) details.target = {};
    tables.pendingItem.push({
      id: record.id,
      ownerId,
      profileId,
      ...targetColumns(target?.record_id),
      targetField: typeof target?.field === 'string' ? target.field : null,
      subject: record.subject,
      currentInformation: record.current_information ?? null,
      reason: record.reason ?? null,
      reasonDetail: record.reason_detail ?? null,
      safeStatement: record.safe_statement_for_now ?? null,
      confirmationMethod: record.confirmation_method ?? null,
      priority: record.priority ?? null,
      status: record.status ?? null,
      details: Object.keys(details).length > 0 ? details : null,
      sortOrder: index,
    });
  });

  // ----------------------------------------------------------- usage_rules
  const usageRules = isJsonObject(profile.usage_rules) ? profile.usage_rules : null;
  let usageRulesJson: Json | null = null;
  if (usageRules) {
    const { restrictions, ...rest } = usageRules;
    usageRulesJson = { ...rest };
    if (Array.isArray(restrictions)) {
      if (restrictions.length === 0) usageRulesJson.restrictions = [];
      asRecords(restrictions).forEach((record, index) => {
        const target = isJsonObject(record.target) ? record.target : {};
        tables.usageRestriction.push({
          id: record.id,
          ownerId,
          profileId,
          ...targetColumns(target.record_id),
          targetField: typeof target.field === 'string' ? target.field : null,
          term: typeof target.term === 'string' ? target.term : null,
          rule: record.rule,
          reason: record.reason ?? null,
          sortOrder: index,
        });
      });
    }
  }

  // ---------------------------------------------------------------- vinculos
  tables.evidenceLink.push(...evidenceLinks.values());

  // ----------------------------------------------------------------- raiz
  const profileRow: Row = {
    locale: document.locale ?? null,
    schemaVersion: document.schema_version,
    emptyCollections: TOP_LEVEL_COLLECTIONS.filter(
      (c) => Array.isArray(profile[c.key]) && (profile[c.key] as unknown[]).length === 0,
    ).map((c) => c.key),
  };
  for (const [key, column] of Object.entries(BLOCK_COLUMNS)) {
    const block = key === 'usage_rules' ? usageRulesJson : (profile[key] ?? null);
    profileRow[column] = isJsonObject(block) ? block : null;
  }
  return { profile: profileRow, tables };
}
