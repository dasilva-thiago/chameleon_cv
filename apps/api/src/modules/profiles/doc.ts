import {
  PROFILE_SCHEMA_VERSION,
  TOP_LEVEL_COLLECTIONS,
  cloneJson,
  isFactKind,
  listRecords,
  listReferences,
  type FactStatus,
  type PatchRecordMetaRequest,
  type ProfileDocument,
  type ProfileSection,
  type ProfileSummary,
  type RecordEntry,
  type RecordKind,
} from '@chameleon/contracts';

/**
 * Pure operations over a `ProfileDocument` (no I/O). Handlers read the document from the owner-bound store,
 * apply one of these, validate the result with the contract and save. Every function returns a COPY.
 */

export type Json = Record<string, unknown>;
export const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const emptyDocument = (): ProfileDocument => ({
  schema_version: PROFILE_SCHEMA_VERSION,
  profile: {},
});

const COLLECTION_KEY_OF_KIND = new Map<RecordKind, string>(
  TOP_LEVEL_COLLECTIONS.map((c) => [c.kind, c.key]),
);

/** Key of the nested collection that holds `child` inside its parent record. */
const CHILD_KEY: Partial<Record<RecordKind, string>> = {
  experience_item: 'items',
  project_item: 'items',
  collaborator: 'collaborators',
};

const lower = (id: string): string => id.toLowerCase();

export interface Located {
  kind: RecordKind;
  id: string;
  path: (string | number)[];
  value: Json;
  /** Parent record id for nested records; `null` otherwise. */
  parentId: string | null;
  /** Top-level section of `profile` that holds the record. */
  section: ProfileSection;
}

function toLocated(entry: RecordEntry, document: unknown): Located {
  let parentId: string | null = null;
  if (CHILD_KEY[entry.kind]) {
    const parent = getAt(document, entry.path.slice(0, -2));
    parentId = isJson(parent) && typeof parent.id === 'string' ? lower(parent.id) : null;
  }
  return {
    kind: entry.kind,
    id: lower(entry.id ?? ''),
    path: entry.path,
    value: entry.value,
    parentId,
    section: entry.path[1] as ProfileSection,
  };
}

export function getAt(root: unknown, path: readonly (string | number)[]): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

/** Finds a record by id (case-insensitive). `null` when the id is not in the document. */
export function locateRecord(document: ProfileDocument, id: string): Located | null {
  const wanted = lower(id);
  for (const entry of listRecords(document)) {
    if (entry.id !== null && lower(entry.id) === wanted) return toLocated(entry, document);
  }
  return null;
}

export function allRecords(document: ProfileDocument): Located[] {
  return listRecords(document)
    .filter((entry) => entry.id !== null)
    .map((entry) => toLocated(entry, document));
}

/** Lower-cased ids of every record in the document (for the "unknown id" rule). */
export function recordIds(document: unknown): Set<string> {
  const ids = new Set<string>();
  for (const entry of listRecords(document)) if (entry.id !== null) ids.add(lower(entry.id));
  return ids;
}

/**
 * Ids in `next` that the stored profile does not have (and that are not in `allowed`). The API never
 * adopts client-chosen ids: a record is created by omitting its id. Treating "unknown" and "someone else's"
 * identically removes the existence oracle of `ID_CONFLICT`.
 */
export function unknownIds(
  next: ProfileDocument,
  stored: ProfileDocument,
  allowed: ReadonlySet<string> = new Set(),
): string[] {
  const known = recordIds(stored);
  const out: string[] = [];
  for (const entry of listRecords(next)) {
    if (entry.id === null) continue;
    const id = lower(entry.id);
    if (!known.has(id) && !allowed.has(id)) out.push(entry.id);
  }
  return out;
}

// --- Create / replace / delete ---------------------------------------------------------------

function ensureArray(holder: Json, key: string): unknown[] {
  const current = holder[key];
  if (Array.isArray(current)) return current;
  const created: unknown[] = [];
  holder[key] = created;
  return created;
}

/** Appends `record` (already carrying its generated id) to the right collection. `null` if the parent is missing/invalid. */
export function insertRecord(
  document: ProfileDocument,
  kind: RecordKind,
  parentId: string | undefined,
  record: Json,
): ProfileDocument | null {
  const copy = cloneJson(document);
  const profile = copy.profile as Json;
  const topKey = COLLECTION_KEY_OF_KIND.get(kind);
  if (topKey) {
    ensureArray(profile, topKey).push(record);
    return copy;
  }
  if (kind === 'restriction') {
    const rules = isJson(profile.usage_rules) ? profile.usage_rules : (profile.usage_rules = {});
    ensureArray(rules, 'restrictions').push(record);
    return copy;
  }
  const childKey = CHILD_KEY[kind];
  const wantedParentKind = kind === 'experience_item' ? 'experience' : 'project';
  if (!childKey || !parentId) return null;
  const parent = locateRecord(copy, parentId);
  if (parent?.kind !== wantedParentKind) return null;
  ensureArray(parent.value, childKey).push(record);
  return copy;
}

const PARENT_CHILD_KEYS: Partial<Record<RecordKind, readonly string[]>> = {
  experience: ['items'],
  project: ['items', 'collaborators'],
};

/**
 * Replaces a record. For parents (`experience`, `project`) children not mentioned in the new value are kept
 * (the same `keep` semantics as the store: removing a child is an explicit DELETE).
 */
export function replaceRecord(
  document: ProfileDocument,
  located: Located,
  next: Json,
): ProfileDocument {
  const copy = cloneJson(document);
  const target = getAt(copy, located.path.slice(0, -1)) as unknown[];
  const index = located.path[located.path.length - 1] as number;
  const merged: Json = { ...next, id: located.value.id };
  for (const key of PARENT_CHILD_KEYS[located.kind] ?? []) {
    const existing = Array.isArray(located.value[key]) ? (located.value[key] as Json[]) : [];
    if (merged[key] === undefined || merged[key] === null) {
      if (existing.length > 0) merged[key] = cloneJson(existing);
    } else if (Array.isArray(merged[key])) {
      const incoming = merged[key] as Json[];
      const mentioned = new Set(
        incoming.filter((c) => typeof c.id === 'string').map((c) => lower(c.id as string)),
      );
      merged[key] = [
        ...incoming,
        ...existing.filter((c) => !mentioned.has(lower(String(c.id)))).map((c) => cloneJson(c)),
      ];
    }
  }
  target[index] = merged;
  return copy;
}

function descendantIds(located: Located): Set<string> {
  const ids = new Set<string>([located.id]);
  for (const key of PARENT_CHILD_KEYS[located.kind] ?? []) {
    const children = located.value[key];
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      if (isJson(child) && typeof child.id === 'string') ids.add(lower(child.id));
    }
  }
  return ids;
}

export interface Blocker {
  refererId: string;
  refererKind: RecordKind | 'resume_preferences';
  field: string;
}

/** List-type references are cleaned on delete; these paths end in a list index under one of these fields. */
const CLEANABLE_LIST_FIELDS = new Set([
  'supports',
  'evidence_ids',
  'related_skill_ids',
  'older_experience_ids',
  'highlight_record_ids',
]);

function removeIdsFromLists(root: Json, removed: ReadonlySet<string>): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isJson(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (CLEANABLE_LIST_FIELDS.has(key) && Array.isArray(child)) {
        const kept = child.filter(
          (item) => !(typeof item === 'string' && removed.has(lower(item))),
        );
        if (kept.length !== child.length) value[key] = kept;
      } else {
        visit(child);
      }
    }
  };
  visit(root);
}

/**
 * Removes a record (and its children). List-type references (`evidence.supports`, `meta.evidence_ids`,
 * `related_skill_ids`, resume-preference lists) are cleaned. Single references that would be left dangling
 * (`skill_usage.experience_id`, `language.certification_id`, pending/restriction targets, ...) BLOCK the
 * removal: the caller turns them into `409 RECORD_IN_USE`.
 */
export function removeRecord(
  document: ProfileDocument,
  located: Located,
): { document: ProfileDocument; blockers: Blocker[] } {
  const removed = descendantIds(located);
  const blockers: Blocker[] = [];
  for (const reference of listReferences(document)) {
    if (!removed.has(lower(reference.id))) continue;
    const last = reference.path[reference.path.length - 1];
    const listField =
      typeof last === 'number' ? String(reference.path[reference.path.length - 2]) : String(last);
    if (CLEANABLE_LIST_FIELDS.has(listField)) continue;
    const owner = reference.owner;
    // pending_item / restriction targets: the owner path ends in `target`, the record is its parent.
    const recordPath =
      owner.path[owner.path.length - 1] === 'target' ? owner.path.slice(0, -1) : owner.path;
    const holder = getAt(document, recordPath);
    const refererId = isJson(holder) && typeof holder.id === 'string' ? holder.id : '';
    if (removed.has(lower(refererId))) continue; // child referencing its own parent
    blockers.push({ refererId, refererKind: owner.kind, field: String(last) });
  }
  if (blockers.length > 0) return { document, blockers };

  const copy = cloneJson(document);
  const fresh = locateRecord(copy, located.id);
  if (!fresh) return { document: copy, blockers };
  const array = getAt(copy, fresh.path.slice(0, -1)) as unknown[];
  array.splice(fresh.path[fresh.path.length - 1] as number, 1);
  if (array.length === 0) {
    // An emptied list must not turn into `[]` ("no items provided", ADR-0005): the key goes away (not provided).
    const holder = getAt(copy, fresh.path.slice(0, -2));
    const key = fresh.path[fresh.path.length - 2];
    if (isJson(holder) && typeof key === 'string') delete holder[key];
  }
  removeIdsFromLists(copy, removed);
  return { document: copy, blockers };
}

// --- Governance (meta) ---------------------------------------------------------------------------

export type MetaPatchProblem =
  { ok: true; document: ProfileDocument } | { ok: false; message: string; path: string };

/** Applies a governance patch to a FACT. `archived` forces `resume_use: never` (ADR-0005). */
export function patchMeta(
  document: ProfileDocument,
  located: Located,
  patch: PatchRecordMetaRequest,
): MetaPatchProblem {
  if (!isFactKind(located.kind)) {
    return {
      ok: false,
      path: 'recordId',
      message: 'Este tipo de registro nao tem controles de status/uso (so fatos tem).',
    };
  }
  const meta: Json = isJson(located.value.meta) ? { ...located.value.meta } : {};
  const nextStatus = (patch.status ?? meta.status ?? 'needs_review') as FactStatus;
  if (patch.status !== undefined) meta.status = patch.status;
  if (patch.visibility !== undefined) meta.visibility = patch.visibility;
  if (patch.resume_use !== undefined) meta.resume_use = patch.resume_use;
  if (nextStatus === 'archived') {
    if (patch.resume_use !== undefined && patch.resume_use !== 'never') {
      return {
        ok: false,
        path: 'resume_use',
        message:
          'Um registro arquivado nao pode ser usado em curriculo (resume_use deve ser never).',
      };
    }
    meta.resume_use = 'never';
  }
  if (patch.field_states !== undefined) {
    const states: Json = isJson(meta.field_states) ? { ...meta.field_states } : {};
    for (const [field, state] of Object.entries(patch.field_states)) {
      if (state === null) delete states[field];
      else states[field] = state;
    }
    if (Object.keys(states).length === 0) delete meta.field_states;
    else meta.field_states = states;
  }
  const copy = cloneJson(document);
  const holder = getAt(copy, located.path) as Json;
  holder.meta = meta;
  return { ok: true, document: copy };
}

/**
 * An archived fact never goes to a resume (ADR-0005 amendment): fill `resume_use: never` when it is missing and
 * report the facts that explicitly say otherwise (the caller refuses the write).
 */
export function enforceArchivedNever(document: ProfileDocument): {
  document: ProfileDocument;
  violations: string[];
} {
  const copy = cloneJson(document);
  const violations: string[] = [];
  for (const entry of listRecords(copy)) {
    if (!isFactKind(entry.kind) || !isJson(entry.value.meta)) continue;
    const meta = entry.value.meta;
    if (meta.status !== 'archived') continue;
    if (meta.resume_use === undefined || meta.resume_use === null) meta.resume_use = 'never';
    else if (meta.resume_use !== 'never') violations.push(String(entry.id));
  }
  return { document: copy, violations };
}

/** Effective status of a fact; a fact without `meta` is `needs_review` (ADR-0006: the most restrictive). */
export function statusOf(value: Json): FactStatus {
  const status = isJson(value.meta) ? value.meta.status : undefined;
  return (status as FactStatus | undefined) ?? 'needs_review';
}

// --- Evidence links (one relation declared on both sides) ------------------------------------------------

export interface LinkRef {
  recordId: string;
  kind: RecordKind;
}

/** Records linked to an evidence: `evidence.supports` UNION facts that cite it in `meta.evidence_ids`. */
export function evidenceLinks(document: ProfileDocument, evidenceId: string): LinkRef[] {
  const wanted = lower(evidenceId);
  const out = new Map<string, LinkRef>();
  const records = allRecords(document);
  const byId = new Map(records.map((r) => [r.id, r]));
  const evidence = byId.get(wanted);
  if (evidence && Array.isArray(evidence.value.supports)) {
    for (const target of evidence.value.supports) {
      const found = typeof target === 'string' ? byId.get(lower(target)) : undefined;
      if (found) out.set(found.id, { recordId: found.id, kind: found.kind });
    }
  }
  for (const record of records) {
    const meta = record.value.meta;
    if (
      isJson(meta) &&
      Array.isArray(meta.evidence_ids) &&
      meta.evidence_ids.some((id) => typeof id === 'string' && lower(id) === wanted)
    ) {
      out.set(record.id, { recordId: record.id, kind: record.kind });
    }
  }
  return [...out.values()];
}

export function addEvidenceLink(
  document: ProfileDocument,
  evidence: Located,
  target: Located,
): ProfileDocument {
  const copy = cloneJson(document);
  const holder = getAt(copy, evidence.path) as Json;
  const supports = Array.isArray(holder.supports) ? (holder.supports as string[]) : [];
  if (!supports.some((id) => lower(id) === target.id)) supports.push(target.id);
  holder.supports = supports;
  return copy;
}

/** Removes the link on both sides (`evidence.supports` and the fact's `meta.evidence_ids`). */
export function removeEvidenceLink(
  document: ProfileDocument,
  evidenceId: string,
  targetId: string,
): ProfileDocument {
  const copy = cloneJson(document);
  const evidence = locateRecord(copy, evidenceId);
  if (evidence && Array.isArray(evidence.value.supports)) {
    evidence.value.supports = (evidence.value.supports as string[]).filter(
      (id) => lower(id) !== lower(targetId),
    );
  }
  const target = locateRecord(copy, targetId);
  if (target && isJson(target.value.meta) && Array.isArray(target.value.meta.evidence_ids)) {
    target.value.meta.evidence_ids = (target.value.meta.evidence_ids as string[]).filter(
      (id) => lower(id) !== lower(evidenceId),
    );
  }
  return copy;
}

// --- Summary ----------------------------------------------------------------------------------------

export function emptySummary(): ProfileSummary {
  return {
    recordCount: 0,
    byStatus: { confirmed: 0, needs_review: 0, conflicting: 0, archived: 0 },
    pending: { open: 0, resolved: 0, dismissed: 0 },
    evidenceCount: 0,
    byKind: {},
  };
}

export function summarize(document: ProfileDocument | null): ProfileSummary {
  const summary = emptySummary();
  if (!document) return summary;
  for (const entry of listRecords(document)) {
    if (entry.id === null) continue;
    summary.recordCount += 1;
    summary.byKind[entry.kind] = (summary.byKind[entry.kind] ?? 0) + 1;
    if (isFactKind(entry.kind)) summary.byStatus[statusOf(entry.value)] += 1;
    if (entry.kind === 'evidence') summary.evidenceCount += 1;
    if (entry.kind === 'pending_item') {
      const status = entry.value.status;
      summary.pending[status === 'resolved' || status === 'dismissed' ? status : 'open'] += 1;
    }
  }
  return summary;
}
