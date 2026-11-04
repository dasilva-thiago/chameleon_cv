import { TOP_LEVEL_COLLECTIONS } from '@chameleon/contracts';
import { changedColumns, type Row } from './codec';
import { BLOCK_COLUMNS, emptyTables, type DocumentRows } from './to-rows';
import type { DelegateName } from './specs';

/**
 * Plano de escrita (diff) entre o estado desejado (documento -> linhas) e o armazenado. PURO:
 * o relogio e o gerador de ids sao injetados. O store apenas executa o plano, na ordem
 * `CREATE_ORDER` (criacoes), `updates` e `DELETE_ORDER` (exclusoes).
 */

export type OnMissing = 'archive' | 'keep' | 'delete';

export interface PlanInput {
  desired: DocumentRows;
  existing: DocumentRows;
  onMissing: OnMissing;
  now: Date;
  generateId: () => string;
}

export interface PlannedUpdate {
  delegate: DelegateName;
  id: string;
  data: Row;
}

export type RecordCounts = Record<string, number>;

export interface ApplySummary {
  created: RecordCounts;
  updated: RecordCounts;
  unchanged: RecordCounts;
  /** Registros ausentes do documento que foram arquivados (status archived, resume_use never). */
  archived: RecordCounts;
  deleted: RecordCounts;
  /** Registros ausentes do documento mantidos como estavam (modo merge). */
  kept: RecordCounts;
  totals: {
    created: number;
    updated: number;
    unchanged: number;
    archived: number;
    deleted: number;
    kept: number;
  };
}

export interface Plan {
  profileChanges: Row;
  creates: Partial<Record<DelegateName, Row[]>>;
  updates: PlannedUpdate[];
  deletes: Partial<Record<DelegateName, string[]>>;
  summary: ApplySummary;
}

/** Ordem de criacao respeita as FKs (pais antes de filhos). */
export const CREATE_ORDER: readonly DelegateName[] = [
  'profileFact',
  'skill',
  'experience',
  'education',
  'course',
  'certification',
  'award',
  'publication',
  'volunteering',
  'profileStatement',
  'contactPoint',
  'evidence',
  'project',
  'competencyExample',
  'experienceItem',
  'languageProficiency',
  'projectItem',
  'projectCollaborator',
  'skillUsage',
  'competencyExampleSkill',
  'evidenceLink',
  'pendingItem',
  'usageRestriction',
];

/** Exclusao: dependentes antes; `profileFact` por ultimo (a cascata remove as linhas tipadas). */
export const DELETE_ORDER: readonly DelegateName[] = [
  'evidenceLink',
  'competencyExampleSkill',
  'projectCollaborator',
  'pendingItem',
  'usageRestriction',
  'evidence',
  'contactPoint',
  'profileFact',
];

const LINK_TABLES = new Set<DelegateName>(['evidenceLink', 'competencyExampleSkill']);
const PLAIN_CATEGORY: Partial<Record<DelegateName, string>> = {
  contactPoint: 'contact_point',
  evidence: 'evidence',
  pendingItem: 'pending_item',
  usageRestriction: 'restriction',
  projectCollaborator: 'collaborator',
};
const TYPED_FACT_TABLES = new Set<DelegateName>([
  'profileStatement',
  'competencyExample',
  'experience',
  'experienceItem',
  'project',
  'projectItem',
  'education',
  'course',
  'skill',
  'skillUsage',
  'languageProficiency',
  'certification',
  'award',
  'publication',
  'volunteering',
]);
/** Tabelas cujo `id` identifica um registro unico do documento. */
const RECORD_TABLES: readonly DelegateName[] = [
  'profileFact',
  'contactPoint',
  'evidence',
  'pendingItem',
  'usageRestriction',
  'projectCollaborator',
];

export function rowKey(delegate: DelegateName, row: Row): string {
  if (delegate === 'evidenceLink') return `${String(row.evidenceId)}|${String(row.factId)}`;
  if (delegate === 'competencyExampleSkill')
    return `${String(row.exampleId)}|${String(row.skillId)}`;
  return String(row.id);
}

const bump = (counts: RecordCounts, category: string): void => {
  counts[category] = (counts[category] ?? 0) + 1;
};

const sum = (counts: RecordCounts): number => Object.values(counts).reduce((a, b) => a + b, 0);

/** Colecoes de topo (chave do contrato) -> categorias de registro que as compoem. */
const COLLECTION_CATEGORY = new Map<string, string>(
  TOP_LEVEL_COLLECTIONS.map((c) => [c.key, c.kind]),
);

export function planChanges(input: PlanInput): Plan {
  const { desired, existing, onMissing, now, generateId } = input;
  const creates: Partial<Record<DelegateName, Row[]>> = {};
  const updates: PlannedUpdate[] = [];
  const deletes: Partial<Record<DelegateName, string[]>> = {};

  const factKindById = new Map<string, string>();
  for (const fact of [...existing.tables.profileFact, ...desired.tables.profileFact]) {
    factKindById.set(String(fact.id), String(fact.kind));
  }
  const categoryOfId = (delegate: DelegateName, id: string): string | undefined =>
    delegate === 'profileFact' ? factKindById.get(id) : PLAIN_CATEGORY[delegate];

  /** ids de registros tocados, por tabela de registro: id -> 'created' | 'updated' */
  const touched = new Map<string, 'created' | 'updated'>();
  const touch = (id: string, how: 'created' | 'updated'): void => {
    if (touched.get(id) !== 'created') touched.set(id, how);
  };

  const existingByDelegate = (delegate: DelegateName): Map<string, Row> =>
    new Map(existing.tables[delegate].map((row) => [rowKey(delegate, row), row]));

  const desiredIdsByDelegate = new Map<DelegateName, Set<string>>();

  for (const delegate of CREATE_ORDER) {
    const current = existingByDelegate(delegate);
    const wanted = new Set<string>();
    desiredIdsByDelegate.set(delegate, wanted);

    for (const raw of desired.tables[delegate]) {
      const key = rowKey(delegate, raw);
      wanted.add(key);
      const stored = current.get(key);
      const row: Row = { ...raw };

      // Colunas gerenciadas pelo store (nao vem do documento).
      if (delegate === 'profileFact') {
        const status = String(row.status);
        row.archivedAt = status === 'archived' ? (stored?.archivedAt ?? now) : null;
        row.confirmedAt = status === 'confirmed' ? (stored?.confirmedAt ?? now) : null;
      }
      if (delegate === 'pendingItem') {
        const done = row.status === 'resolved' || row.status === 'dismissed';
        row.resolvedAt = done ? (stored?.resolvedAt ?? now) : null;
      }
      if (LINK_TABLES.has(delegate)) row.id = stored ? stored.id : generateId();

      if (!stored) {
        (creates[delegate] ??= []).push(row);
        markTouched(delegate, row, 'created');
        continue;
      }
      const columns = changedColumns(row, stored).filter((c) => c !== 'id');
      if (columns.length > 0) {
        updates.push({
          delegate,
          id: String(stored.id),
          data: Object.fromEntries(columns.map((c) => [c, row[c] ?? null])),
        });
        markTouched(delegate, row, 'updated');
      }
    }
  }

  function markTouched(delegate: DelegateName, row: Row, how: 'created' | 'updated'): void {
    if (delegate === 'profileFact' || PLAIN_CATEGORY[delegate]) touch(String(row.id), how);
    else if (TYPED_FACT_TABLES.has(delegate)) touch(String(row.id), how);
    else if (delegate === 'evidenceLink') {
      touch(String(row.factId), 'updated');
      touch(String(row.evidenceId), 'updated');
    } else if (delegate === 'competencyExampleSkill') touch(String(row.exampleId), 'updated');
  }

  // --------------------------------------------------------------- ausentes
  const archived: RecordCounts = {};
  const deleted: RecordCounts = {};
  const kept: RecordCounts = {};
  const keptKinds = new Set<string>();

  for (const delegate of [...CREATE_ORDER]) {
    const wanted = desiredIdsByDelegate.get(delegate) ?? new Set<string>();
    for (const stored of existing.tables[delegate]) {
      // Linhas tipadas de fato saem por cascata do ProfileFact (nunca isoladas: trigger de orfandade).
      if (TYPED_FACT_TABLES.has(delegate)) continue;
      const key = rowKey(delegate, stored);
      if (wanted.has(key)) continue;
      const id = String(stored.id);
      const isRecordTable = RECORD_TABLES.includes(delegate);
      const category = isRecordTable ? categoryOfId(delegate, id) : undefined;

      if (onMissing === 'keep') {
        if (isRecordTable && category) {
          bump(kept, category);
          keptKinds.add(category);
        }
        continue;
      }
      if (delegate === 'profileFact' && onMissing === 'archive') {
        if (stored.status === 'archived') {
          bump(kept, String(stored.kind));
          keptKinds.add(String(stored.kind));
        } else {
          updates.push({
            delegate,
            id,
            data: {
              status: 'archived',
              resumeUse: 'never',
              archivedAt: now,
              confirmedAt: null,
              // o arquivamento precisa aparecer no documento mesmo que o fato nao tivesse `meta`
              metaPresent: true,
              metaKeys: [
                ...new Set([
                  ...((stored.metaKeys as string[] | undefined) ?? []),
                  'status',
                  'resume_use',
                ]),
              ],
            },
          });
          bump(archived, String(stored.kind));
          keptKinds.add(String(stored.kind));
        }
        continue;
      }
      (deletes[delegate] ??= []).push(id);
      if (isRecordTable && category) bump(deleted, category);
    }
  }

  // -------------------------------------------------------------------- raiz
  const profileChanges: Row = {};
  const wantedProfile: Row = { ...desired.profile };
  const finalKinds = new Set<string>(keptKinds);
  for (const row of desired.tables.profileFact) finalKinds.add(String(row.kind));
  for (const delegate of Object.keys(PLAIN_CATEGORY) as DelegateName[]) {
    if (desired.tables[delegate].length > 0) finalKinds.add(PLAIN_CATEGORY[delegate]!);
  }
  wantedProfile.emptyCollections = (desired.profile.emptyCollections as string[]).filter(
    (key) => !finalKinds.has(COLLECTION_CATEGORY.get(key) ?? ''),
  );
  if (onMissing === 'keep') {
    // Merge: bloco/locale ausente no documento nao apaga o que ja existe.
    for (const column of [...Object.values(BLOCK_COLUMNS), 'locale']) {
      if (wantedProfile[column] === null) delete wantedProfile[column];
    }
    wantedProfile.emptyCollections = [
      ...new Set([
        ...((existing.profile.emptyCollections as string[] | undefined) ?? []),
        ...(wantedProfile.emptyCollections as string[]),
      ]),
    ].filter((key) => !finalKinds.has(COLLECTION_CATEGORY.get(key) ?? ''));
  }
  for (const column of changedColumns(wantedProfile, existing.profile)) {
    profileChanges[column] = wantedProfile[column];
  }

  // ----------------------------------------------------------------- resumo
  const created: RecordCounts = {};
  const updated: RecordCounts = {};
  const unchanged: RecordCounts = {};
  for (const delegate of RECORD_TABLES) {
    for (const row of desired.tables[delegate]) {
      const id = String(row.id);
      const category = categoryOfId(delegate, id);
      if (!category) continue;
      const how = touched.get(id);
      bump(how === 'created' ? created : how === 'updated' ? updated : unchanged, category);
    }
  }
  const summary: ApplySummary = {
    created,
    updated,
    unchanged,
    archived,
    deleted,
    kept,
    totals: {
      created: sum(created),
      updated: sum(updated),
      unchanged: sum(unchanged),
      archived: sum(archived),
      deleted: sum(deleted),
      kept: sum(kept),
    },
  };
  return { profileChanges, creates, updates, deletes, summary };
}

export function emptyStoredRows(profile: Row = {}): DocumentRows {
  return { profile, tables: emptyTables() };
}
