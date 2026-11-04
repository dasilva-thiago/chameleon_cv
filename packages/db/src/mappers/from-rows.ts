import {
  canonicalizeProfileDocument,
  PROFILE_SCHEMA_VERSION,
  TOP_LEVEL_COLLECTIONS,
  type ProfileDocument,
} from '@chameleon/contracts';
import { decodeRecord, isJsonObject, type Json, type Row } from './codec';
import { BLOCK_COLUMNS, emptyTables, type DocumentRows, type TableRows } from './to-rows';
import {
  COLLABORATOR_SPEC,
  CONTACT_SPEC,
  EVIDENCE_SPEC,
  FACT_SPEC_BY_KIND,
  type FactKindName,
} from './specs';

/**
 * Linhas -> ProfileDocument canonico 2.1.0. Funcao PURA e determinista: a ordem vem de
 * `sortOrder`/`position` (desempate por id), nunca da ordem de retorno do banco.
 */

const byOrder = (a: Row, b: Row, key = 'sortOrder'): number => {
  const diff = Number(a[key] ?? 0) - Number(b[key] ?? 0);
  if (diff !== 0) return diff;
  return String(a.id).localeCompare(String(b.id));
};

const groupBy = (rows: Row[], key: string): Map<string, Row[]> => {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== 'string') continue;
    const bucket = groups.get(value) ?? [];
    bucket.push(row);
    groups.set(value, bucket);
  }
  return groups;
};

const indexById = (rows: Row[]): Map<string, Row> => new Map(rows.map((r) => [String(r.id), r]));

/** Lista de ids de `links` ordenada pela coluna de posicao, ou `undefined` se nenhuma. */
function orderedIds(links: Row[] | undefined, positionKey: string, idKey: string): string[] {
  return (links ?? [])
    .filter((link) => typeof link[positionKey] === 'number')
    .sort((a, b) => Number(a[positionKey]) - Number(b[positionKey]))
    .map((link) => String(link[idKey]));
}

export function rowsToDocument(
  rows: DocumentRows | { profile: Row; tables: TableRows },
): ProfileDocument {
  const tables = { ...emptyTables(), ...rows.tables };
  const profileRow = rows.profile;

  const factsById = indexById(tables.profileFact);
  const factOf = (id: unknown): Row => {
    const fact = factsById.get(String(id));
    if (!fact) throw new Error(`Linha tipada sem ProfileFact: ${String(id)}`);
    return fact;
  };

  const linksByFact = groupBy(tables.evidenceLink, 'factId');
  const linksByEvidence = groupBy(tables.evidenceLink, 'evidenceId');
  const exampleSkills = groupBy(tables.competencyExampleSkill, 'exampleId');

  const metaOf = (fact: Row): Json | null => {
    if (fact.metaPresent !== true) return null;
    const keys = new Set(Array.isArray(fact.metaKeys) ? (fact.metaKeys as string[]) : []);
    const meta: Json = {};
    if (keys.has('status')) meta.status = fact.status;
    if (keys.has('declared_status') && fact.declaredStatus)
      meta.declared_status = fact.declaredStatus;
    if (keys.has('visibility')) meta.visibility = fact.visibility;
    if (keys.has('resume_use')) meta.resume_use = fact.resumeUse;
    if (keys.has('source')) meta.source = fact.source;
    if (keys.has('source_detail') && fact.sourceDetail !== null)
      meta.source_detail = fact.sourceDetail;
    if (keys.has('source_excerpt') && fact.sourceExcerpt !== null)
      meta.source_excerpt = fact.sourceExcerpt;
    if (keys.has('evidence_ids')) {
      meta.evidence_ids = orderedIds(
        linksByFact.get(String(fact.id)),
        'evidenceIdsPosition',
        'evidenceId',
      );
    }
    if (keys.has('field_states')) meta.field_states = fact.fieldStates ?? {};
    if (keys.has('private_notes') && fact.privateNotes !== null)
      meta.private_notes = fact.privateNotes;
    return meta;
  };

  // ---- construtores de registro por kind (recursivos para itens)
  const typedRows = (kind: FactKindName): Row[] => {
    const spec = FACT_SPEC_BY_KIND.get(kind)!;
    return tables[spec.delegate];
  };
  const typedByParent = (kind: FactKindName, parentKey: string): Map<string, Row[]> =>
    groupBy(typedRows(kind), parentKey);

  const itemsOfExperience = typedByParent('experience_item', 'experienceId');
  const itemsOfProject = typedByParent('project_item', 'projectId');
  const collaboratorsOfProject = groupBy(tables.projectCollaborator, 'projectId');

  const sortByFact = (rows: Row[]): Row[] =>
    [...rows].sort((a, b) => {
      const diff = Number(factOf(a.id).sortOrder) - Number(factOf(b.id).sortOrder);
      return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
    });

  function buildFact(kind: FactKindName, row: Row): Json {
    const spec = FACT_SPEC_BY_KIND.get(kind)!;
    const record = decodeRecord(row, row.details, spec);
    const id = String(row.id);
    record.id = id;
    const meta = metaOf(factOf(id));
    if (meta) record.meta = meta;

    if (kind === 'competency_example') {
      const ids = orderedIds(exampleSkills.get(id), 'position', 'skillId');
      if (ids.length > 0) record.related_skill_ids = ids;
    }
    if (kind === 'experience') {
      const items = sortByFact(itemsOfExperience.get(id) ?? []).map((item) =>
        buildFact('experience_item', item),
      );
      if (items.length > 0) record.items = items;
    }
    if (kind === 'project') {
      const items = sortByFact(itemsOfProject.get(id) ?? []).map((item) =>
        buildFact('project_item', item),
      );
      if (items.length > 0) record.items = items;
      const collaborators = [...(collaboratorsOfProject.get(id) ?? [])]
        .sort((a, b) => byOrder(a, b))
        .map((row2) => ({ id: String(row2.id), ...decodeRecord(row2, null, COLLABORATOR_SPEC) }));
      if (collaborators.length > 0) record.collaborators = collaborators;
    }
    return record;
  }

  const profile: Json = {};
  const emptyKeys = new Set(
    Array.isArray(profileRow.emptyCollections) ? (profileRow.emptyCollections as string[]) : [],
  );

  const topLevel: Record<string, Json[]> = {};
  for (const collection of TOP_LEVEL_COLLECTIONS) {
    const key = collection.key;
    let records: Json[] = [];
    switch (collection.kind) {
      case 'contact_point':
        records = [...tables.contactPoint]
          .sort((a, b) => byOrder(a, b))
          .map((row) => ({ id: String(row.id), ...decodeRecord(row, null, CONTACT_SPEC) }));
        break;
      case 'evidence':
        records = [...tables.evidence]
          .sort((a, b) => byOrder(a, b))
          .map((row) => {
            const record: Json = {
              id: String(row.id),
              ...decodeRecord(row, row.details, EVIDENCE_SPEC),
            };
            const supports = orderedIds(
              linksByEvidence.get(String(row.id)),
              'supportsPosition',
              'factId',
            );
            if (supports.length > 0) record.supports = supports;
            return record;
          });
        break;
      case 'pending_item':
        records = [...tables.pendingItem]
          .sort((a, b) => byOrder(a, b))
          .map((row) => {
            const details = isJsonObject(row.details) ? row.details : {};
            const record: Json = { id: String(row.id), subject: row.subject };
            const targetId = row.targetFactId ?? row.targetContactPointId ?? row.targetEvidenceId;
            const target: Json = {};
            if (typeof targetId === 'string') target.record_id = targetId;
            if (typeof row.targetField === 'string') target.field = row.targetField;
            if (Object.keys(target).length > 0) record.target = target;
            else if (details.target !== undefined) record.target = details.target;
            const columns: [string, string][] = [
              ['currentInformation', 'current_information'],
              ['reason', 'reason'],
              ['reasonDetail', 'reason_detail'],
              ['safeStatement', 'safe_statement_for_now'],
              ['confirmationMethod', 'confirmation_method'],
              ['priority', 'priority'],
              ['status', 'status'],
            ];
            for (const [column, field] of columns) {
              if (row[column] !== null && row[column] !== undefined) record[field] = row[column];
            }
            if (details.known_variants !== undefined)
              record.known_variants = details.known_variants;
            return record;
          });
        break;
      default: {
        const kind = collection.kind as FactKindName;
        records = sortByFact(typedRows(kind)).map((row) => buildFact(kind, row));
      }
    }
    topLevel[key] = records;
    if (records.length > 0) profile[key] = records;
    else if (emptyKeys.has(key)) profile[key] = [];
  }

  // ---- blocos singleton
  for (const [key, column] of Object.entries(BLOCK_COLUMNS)) {
    const stored = profileRow[column];
    if (!isJsonObject(stored)) {
      if (key === 'usage_rules' && tables.usageRestriction.length > 0) {
        profile[key] = { restrictions: buildRestrictions() };
      }
      continue;
    }
    const block: Json = { ...stored };
    if (key === 'usage_rules') {
      const restrictions = buildRestrictions();
      if (restrictions.length > 0) block.restrictions = restrictions;
      // `restrictions: []` explicito ja vem do proprio JSON
    }
    profile[key] = block;
  }

  function buildRestrictions(): Json[] {
    return [...tables.usageRestriction]
      .sort((a, b) => byOrder(a, b))
      .map((row) => {
        const target: Json = {};
        const targetId = row.targetFactId ?? row.targetContactPointId ?? row.targetEvidenceId;
        if (typeof targetId === 'string') target.record_id = targetId;
        if (typeof row.targetField === 'string') target.field = row.targetField;
        if (typeof row.term === 'string') target.term = row.term;
        const record: Json = { id: String(row.id), target, rule: row.rule };
        if (row.reason !== null && row.reason !== undefined) record.reason = row.reason;
        return record;
      });
  }

  const document: Json = { schema_version: PROFILE_SCHEMA_VERSION };
  if (typeof profileRow.locale === 'string') document.locale = profileRow.locale;
  document.profile = profile;
  return canonicalizeProfileDocument(document as unknown as ProfileDocument);
}
