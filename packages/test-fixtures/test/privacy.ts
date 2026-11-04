/**
 * Classificacao de privacidade de um caminho do documento v2, derivada do PROPRIO contrato
 * (`listRecords` + `meta`/campos de governanca), nao de heuristica por nome de campo.
 *
 * Regras (blocks.ts, records.ts, ADR-0005, ADR-0014):
 * - blocos `availability_preferences`, `career_preferences` e `usage_rules`, `identity.pronouns` e
 *   `experiences[].exit_reason` sao privados POR CONSTRUCAO;
 * - `meta.private_notes` nunca vai a IA nem a documentos;
 * - registro (ou qualquer registro ancestral) com `meta.visibility` private/conditional,
 *   `meta.resume_use` never/requires_approval ou status/declared_status `archived`;
 * - contato com `visibility` private/conditional ou `include_by_default: false`;
 * - evidencia com `is_public: false` ou `recruiter_sharing` not_allowed/restricted.
 */
import { listRecords, type RecordEntry } from '@chameleon/contracts';

export type PathPart = string | number;
type Json = Record<string, unknown>;

const PRIVATE_BLOCKS = new Set(['availability_preferences', 'career_preferences', 'usage_rules']);

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const recordCache = new WeakMap<object, RecordEntry[]>();
function recordsOf(document: unknown): RecordEntry[] {
  if (!isObject(document)) return [];
  let records = recordCache.get(document);
  if (!records) {
    records = listRecords(document);
    recordCache.set(document, records);
  }
  return records;
}

/** Motivo pelo qual o proprio registro nao pode sair no curriculo (ou `null` se for publico). */
export function restrictionOf(record: RecordEntry): string | null {
  const value = record.value;
  const meta = isObject(value.meta) ? value.meta : {};
  if (meta.visibility === 'private' || meta.visibility === 'conditional') {
    return `meta.visibility=${String(meta.visibility)}`;
  }
  if (meta.resume_use === 'never' || meta.resume_use === 'requires_approval') {
    return `meta.resume_use=${String(meta.resume_use)}`;
  }
  if (meta.status === 'archived' || meta.declared_status === 'archived') return 'archived';
  if (record.kind === 'contact_point') {
    if (value.visibility === 'private' || value.visibility === 'conditional') {
      return `contact.visibility=${String(value.visibility)}`;
    }
    if (value.include_by_default === false) return 'contact.include_by_default=false';
  }
  if (record.kind === 'evidence') {
    if (value.is_public === false) return 'evidence.is_public=false';
    if (value.recruiter_sharing === 'not_allowed' || value.recruiter_sharing === 'restricted') {
      return `evidence.recruiter_sharing=${String(value.recruiter_sharing)}`;
    }
  }
  return null;
}

/**
 * Por que o valor em `path` e privado/condicional/never/requires_approval/archived segundo o contrato,
 * ou `null` quando ele iria para o curriculo (= vazamento se contiver um canario).
 */
export function privacyReason(document: unknown, path: readonly PathPart[]): string | null {
  if (path[0] !== 'profile') return null;
  const block = String(path[1]);
  if (PRIVATE_BLOCKS.has(block)) return `bloco privado: ${block}`;
  if (path[1] === 'identity' && path[2] === 'pronouns') return 'identity.pronouns';
  if (path.includes('meta') && path[path.length - 1] === 'private_notes')
    return 'meta.private_notes';

  const records = recordsOf(document);
  const chain = records.filter(
    (record) =>
      record.path.length <= path.length && record.path.every((part, i) => part === path[i]),
  );
  const leaf = chain[chain.length - 1];
  if (leaf?.kind === 'experience' && path[path.length - 1] === 'exit_reason') {
    return 'experiences[].exit_reason';
  }
  for (const record of chain) {
    const reason = restrictionOf(record);
    if (reason) return `${record.kind}: ${reason}`;
  }
  return null;
}
