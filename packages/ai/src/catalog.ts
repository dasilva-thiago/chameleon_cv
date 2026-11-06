import type { ProfileDocument, RecordKind } from '@chameleon/contracts';
import { buildMatchIndex, type IndexedFact, type MatchIndex } from '@chameleon/domain';

/**
 * The compact list of profile facts that is sent to an AI provider, and the ONLY part of the profile that is.
 *
 * Privacy rules enforced here (and tested):
 * - only facts that are confirmed, allowed in resumes and not private (`usable`) are listed;
 * - contacts, identity, notes, evidence locations, salary, restrictions and statements are never listed;
 * - each fact is cut to a short line, so no long free text leaves the machine;
 * - facts are referred to by a short ref (`F12`); the provider never sees a record id.
 */

export interface CatalogEntry {
  ref: string;
  id: string;
  kind: RecordKind;
  text: string;
}

export interface FactCatalog {
  entries: readonly CatalogEntry[];
  /** `F12` -> record id. */
  idOf: ReadonlyMap<string, string>;
  /** record id -> `F12`. */
  refOf: ReadonlyMap<string, string>;
  /** The catalog as text, one fact per line: `F12|skill|Python [projeto, curso]`. */
  text: string;
}

const LISTED_KINDS: readonly RecordKind[] = [
  'skill',
  'experience',
  'experience_item',
  'project',
  'project_item',
  'education',
  'course',
  'certification',
  'language',
  'competency_example',
  'volunteering',
];

const CONTEXT_TAG: Readonly<Record<string, string>> = {
  professional_experience: 'trabalho',
  project_experience: 'projeto',
  volunteer_experience: 'voluntariado',
  coursework: 'curso',
  certification: 'certificação',
  self_declared_knowledge: 'declarado',
  conceptual_familiarity: 'só conceitual',
  unverified: 'sem contexto',
};

const EDUCATION_STATUS: Readonly<Record<string, string>> = {
  in_progress: 'em andamento',
  completed: 'concluído',
  incomplete: 'incompleto',
  suspended: 'trancado',
};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().replace(/\s+/g, ' ') : undefined;

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function labelOf(fact: IndexedFact | undefined): string {
  return fact === undefined ? '' : fact.label;
}

function textOf(fact: IndexedFact, index: MatchIndex): string | undefined {
  const v = fact.value;
  const parent = fact.parentId !== null ? index.byId.get(fact.parentId) : undefined;
  switch (fact.kind) {
    case 'skill': {
      const name = str(v.name);
      if (name === undefined) return undefined;
      const contexts = [
        ...new Set(
          (index.usagesBySkill.get(fact.id) ?? [])
            .filter((usage) => usage.usable)
            .map((usage) => CONTEXT_TAG[usage.context] ?? usage.context),
        ),
      ];
      return contexts.length > 0 ? `${name} [${contexts.join(', ')}]` : name;
    }
    case 'experience': {
      const title = str(v.official_title) ?? str(v.display_title);
      const org = str(v.organization_public_name) ?? str(v.organization_name);
      const when = [str(v.start_date), str(v.end_date)].filter((x) => x !== undefined).join('–');
      return [
        title,
        org !== undefined ? `@ ${org}` : undefined,
        when !== '' ? `(${when})` : undefined,
      ]
        .filter((x) => x !== undefined)
        .join(' ');
    }
    case 'project': {
      const name = str(v.name);
      const what = str(v.one_line_description) ?? str(v.short_description);
      return name === undefined ? undefined : what !== undefined ? `${name}: ${what}` : name;
    }
    case 'experience_item':
    case 'project_item': {
      const text = str(v.text);
      return text === undefined ? undefined : `[${labelOf(parent)}] ${text}`;
    }
    case 'education': {
      const course = str(v.course_name) ?? str(v.field_of_study);
      if (course === undefined) return undefined;
      const status = EDUCATION_STATUS[str(v.status) ?? ''];
      return [course, str(v.institution), status].filter((x) => x !== undefined).join(', ');
    }
    case 'course': {
      const name = str(v.name);
      return name === undefined
        ? undefined
        : [name, str(v.provider)].filter((x) => x !== undefined).join(', ');
    }
    case 'certification': {
      const name = str(v.name);
      return name === undefined
        ? undefined
        : [name, str(v.issuer)].filter((x) => x !== undefined).join(', ');
    }
    case 'language': {
      const name = str(v.language);
      return name === undefined
        ? undefined
        : [name, str(v.self_described_level)].filter((x) => x !== undefined).join(': ');
    }
    case 'competency_example':
      return str(v.competency) ?? str(v.situation);
    case 'volunteering':
      return str(v.role) ?? str(v.organization_name);
    default:
      return undefined;
  }
}

/** Builds the catalog of usable facts; `maxChars` caps each line. */
export function buildFactCatalog(
  document: ProfileDocument,
  options: { maxChars?: number } = {},
): FactCatalog {
  const maxChars = options.maxChars ?? 200;
  const index = buildMatchIndex(document);
  const entries: CatalogEntry[] = [];
  const idOf = new Map<string, string>();
  const refOf = new Map<string, string>();
  for (const kind of LISTED_KINDS) {
    for (const fact of index.facts) {
      if (fact.kind !== kind || !fact.usable) continue;
      const text = textOf(fact, index);
      if (text === undefined || text === '') continue;
      const ref = `F${String(entries.length + 1)}`;
      entries.push({ ref, id: fact.id, kind, text: cut(text, maxChars) });
      idOf.set(ref, fact.id);
      refOf.set(fact.id, ref);
    }
  }
  return {
    entries,
    idOf,
    refOf,
    text: entries.map((entry) => `${entry.ref}|${entry.kind}|${entry.text}`).join('\n'),
  };
}
