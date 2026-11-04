import {
  cloneJson,
  formatIssuePath,
  PROFILE_SCHEMA_VERSION,
  profileDocumentSchema,
  toProfileIssues,
  type ProfileDocument,
  type ProfileIssue,
} from '@chameleon/contracts';
import type { ReportBuilder } from './report';

export type ValidationMode = 'strict' | 'lenient';

export type ValidateResult =
  { ok: true; document: ProfileDocument } | { ok: false; issues: ProfileIssue[] };

type Json = Record<string, unknown>;

/**
 * Valida contra o contrato v2.
 *
 * - `strict` (padrao): qualquer problema, inclusive chave desconhecida, e erro.
 * - `lenient`: chaves desconhecidas viram AVISO (`UNKNOWN_KEY_UNMAPPED`) e o valor e preservado
 *   em `report.unmapped` (nada se perde em silencio). Os demais erros continuam erros.
 */
export function validateProfile(
  input: unknown,
  mode: ValidationMode = 'strict',
  report?: ReportBuilder,
): ValidateResult {
  let current = input;
  for (let pass = 0; pass < 4; pass += 1) {
    const result = profileDocumentSchema.safeParse(current);
    if (result.success) return { ok: true, document: result.data };
    if (mode === 'strict') return { ok: false, issues: toProfileIssues(result.error) };

    const unknownKeyIssues = result.error.issues.filter(
      (issue) => issue.code === 'unrecognized_keys',
    );
    if (unknownKeyIssues.length === 0) return { ok: false, issues: toProfileIssues(result.error) };

    current = cloneJson(current);
    for (const issue of unknownKeyIssues) {
      if (issue.code !== 'unrecognized_keys') continue;
      let target: unknown = current;
      for (const segment of issue.path) {
        target = (target as Record<PropertyKey, unknown> | undefined)?.[segment];
      }
      if (target === null || typeof target !== 'object') continue;
      for (const key of issue.keys) {
        const path = formatIssuePath([...issue.path, key]);
        report?.addUnmapped(
          path,
          (target as Json)[key],
          'Chave desconhecida preservada (modo lenient).',
        );
        report?.warn(
          'UNKNOWN_KEY_UNMAPPED',
          path,
          `Chave desconhecida "${key}" nao mapeada no contrato ${PROFILE_SCHEMA_VERSION}.`,
        );
        delete (target as Json)[key];
      }
    }
  }
  const last = profileDocumentSchema.safeParse(current);
  return last.success
    ? { ok: true, document: last.data }
    : { ok: false, issues: toProfileIssues(last.error) };
}
