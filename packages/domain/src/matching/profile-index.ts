import {
  listRecords,
  type FactStatus,
  type ProfileDocument,
  type RecordKind,
  type UsageContext,
} from '@chameleon/contracts';
import { haystackOf } from './text';

type Json = Record<string, unknown>;

export interface IndexedFact {
  id: string;
  kind: RecordKind;
  value: Json;
  status: FactStatus;
  /** Confirmado, permitido em curriculo e nao privado: pode sustentar uma afirmacao. */
  usable: boolean;
  /** Existe, mas aguarda confirmacao (nao pode sustentar nada ainda). */
  pending: boolean;
  requiresApproval: boolean;
  label: string;
  /** Frases curtas que identificam o registro (nomes, titulos, area). */
  names: string[];
  /** Texto de busca do registro inteiro (tokens). */
  haystack: string;
  parentId: string | null;
}

export interface SkillUsageView {
  usageId: string;
  context: UsageContext;
  usable: boolean;
  sourceId: string | null;
}

export interface MatchIndex {
  facts: IndexedFact[];
  byId: ReadonlyMap<string, IndexedFact>;
  skills: IndexedFact[];
  usagesBySkill: ReadonlyMap<string, SkillUsageView[]>;
}

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Chaves que nunca entram no texto de busca (governanca, ids, links, datas). */
const SKIP_KEYS = /^(meta|field_states|id|evidence_ids|supports)$|_id$|_ids$|url|date|link/i;

function leaves(value: unknown, depth: number, out: string[]): void {
  if (typeof value === 'string') {
    if (value.trim() !== '') out.push(value);
    return;
  }
  if (depth <= 0) return;
  if (Array.isArray(value)) {
    for (const item of value) leaves(item, depth - 1, out);
    return;
  }
  if (isJson(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (!SKIP_KEYS.test(key)) leaves(child, depth - 1, out);
    }
  }
}

const NAME_KEY =
  /(^|_)(name|title|degree|field|area|program|major|subject|qualification|language|role|industry)(_|$)/i;
const NOT_NAME_KEY = /organization|issuer|institution|manager|collaborator|description|notes/i;

function namesOf(kind: RecordKind, value: Json): string[] {
  if (kind === 'skill') {
    const aliases = Array.isArray(value.aliases)
      ? value.aliases.filter((a) => typeof a === 'string')
      : [];
    return [str(value.name), ...aliases.map(str)].filter((n): n is string => n !== undefined);
  }
  const names: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (!NAME_KEY.test(key) || NOT_NAME_KEY.test(key)) continue;
    const text = str(child);
    if (text !== undefined && text.length <= 80) names.push(text);
  }
  return names;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function labelOf(kind: RecordKind, value: Json, names: string[]): string {
  if (kind === 'experience') {
    const title = str(value.display_title) ?? str(value.official_title) ?? 'Experiência';
    const org = str(value.organization_public_name) ?? str(value.organization_name);
    return truncate(org !== undefined ? `${title} — ${org}` : title, 120);
  }
  if (kind === 'experience_item' || kind === 'project_item') {
    return truncate(str(value.text) ?? 'Item', 120);
  }
  if (kind === 'competency_example') {
    return truncate(str(value.competency) ?? str(value.situation) ?? 'Exemplo de competência', 120);
  }
  const first = names[0];
  if (first !== undefined) return truncate(first, 120);
  const texts: string[] = [];
  leaves(value, 2, texts);
  return truncate(texts[0] ?? kind, 120);
}

function parentKey(path: readonly (string | number)[]): string {
  return path.slice(0, -2).join('/');
}

export function buildMatchIndex(document: ProfileDocument): MatchIndex {
  const entries = listRecords(document);
  const idByPath = new Map<string, string>();
  for (const entry of entries) {
    if (entry.id !== null) idByPath.set(entry.path.join('/'), entry.id.toLowerCase());
  }

  const facts: IndexedFact[] = [];
  for (const entry of entries) {
    if (entry.id === null) continue;
    const value = entry.value;
    const meta = isJson(value.meta) ? value.meta : {};
    const rawStatus = meta.status;
    const status: FactStatus =
      rawStatus === 'confirmed' || rawStatus === 'conflicting' || rawStatus === 'archived'
        ? rawStatus
        : 'needs_review';
    const resumeUse = meta.resume_use;
    const visibility = meta.visibility;
    const allowed = resumeUse !== 'never' && visibility !== 'private';
    const names = namesOf(entry.kind, value);
    const texts: string[] = [];
    leaves(value, 3, texts);
    const parent = entry.path.length > 3 ? idByPath.get(parentKey(entry.path)) : undefined;
    facts.push({
      id: entry.id.toLowerCase(),
      kind: entry.kind,
      value,
      status,
      usable: status === 'confirmed' && allowed,
      pending: (status === 'needs_review' || status === 'conflicting') && allowed,
      requiresApproval: resumeUse === 'requires_approval',
      label: labelOf(entry.kind, value, names),
      names,
      haystack: haystackOf(texts.join(' \n ')),
      parentId: parent ?? null,
    });
  }

  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const skills = facts.filter((fact) => fact.kind === 'skill' && fact.status !== 'archived');
  const usagesBySkill = new Map<string, SkillUsageView[]>();
  for (const fact of facts) {
    if (fact.kind !== 'skill_usage') continue;
    const skillId = str(fact.value.skill_id)?.toLowerCase();
    const context = str(fact.value.usage_context) as UsageContext | undefined;
    if (skillId === undefined || context === undefined) continue;
    const source =
      [
        'experience_id',
        'project_id',
        'education_id',
        'course_id',
        'certification_id',
        'volunteering_id',
      ]
        .map((key) => str(fact.value[key]))
        .find((id) => id !== undefined)
        ?.toLowerCase() ?? null;
    const list = usagesBySkill.get(skillId) ?? [];
    list.push({ usageId: fact.id, context, usable: fact.usable, sourceId: source });
    usagesBySkill.set(skillId, list);
  }
  return { facts, byId, skills, usagesBySkill };
}
