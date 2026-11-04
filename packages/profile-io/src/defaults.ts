import {
  cloneJson,
  isFactKind,
  listRecords,
  type FactStatus,
  type Meta,
  type ProfileDocument,
  type Visibility,
} from '@chameleon/contracts';
import type { ReportBuilder } from './report';

/**
 * Defaults de GOVERNANCA aplicados somente pelo importador (ADR-0005). O contrato nao tem
 * defaults: nada aqui "parece fato confirmado".
 *
 * Para todo registro citavel:
 * - `status` = `needs_review` (o valor declarado vai para `declared_status`), EXCETO `archived`
 *   (ADR-0005, emenda 2.1.0): item declarado como arquivado permanece `archived` e recebe
 *   `resume_use: never` por garantia (nunca entra em curriculo); `conflicting` continua virando
 *   `needs_review` com `declared_status: conflicting`;
 * - `visibility` = `public`, exceto `career_narrative` (`private`), se o arquivo nao informar;
 * - `resume_use` = `allowed` (ou `never` se a visibilidade for `private`), se o arquivo nao informar;
 * - `source` = `profile_import`, se o arquivo nao informar.
 *
 * Nao recebem default: contatos (o cabecalho e escolhido por `headerSelection`), blocos de
 * preferencias (privados por construcao) e evidencias/pendencias (nao sao fatos).
 */
export interface ApplyDefaultsResult {
  document: ProfileDocument;
  /** Registros declarados `archived` que permaneceram arquivados (com `resume_use: never`). */
  archivedKept: number;
  /** Registros cujo status passou a `needs_review` nesta chamada (os que ja estavam nao contam). */
  markedNeedsReview: number;
  /** Registros cujo status declarado (diferente de `needs_review`) foi guardado agora em `declared_status`. */
  declaredStatusPreserved: number;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function applyImportDefaults(
  document: ProfileDocument,
  report?: ReportBuilder,
): ApplyDefaultsResult {
  const copy = cloneJson(document) as unknown as Json;
  let marked = 0;
  let preserved = 0;
  let archivedKept = 0;

  for (const entry of listRecords(copy)) {
    if (!isFactKind(entry.kind)) continue;
    const record = entry.value;
    const prior: Meta = isObject(record.meta) ? record.meta : {};
    const declared: FactStatus | null =
      prior.declared_status ??
      (prior.status && prior.status !== 'needs_review' ? prior.status : null);
    const visibility: Visibility =
      prior.visibility ??
      (entry.kind === 'statement' && record.kind === 'career_narrative' ? 'private' : 'public');
    if (prior.status === 'archived') {
      record.meta = {
        ...prior,
        status: 'archived',
        visibility,
        resume_use: 'never',
        source: prior.source ?? 'profile_import',
      } satisfies Meta;
      archivedKept += 1;
      continue;
    }
    const meta: Meta = {
      ...prior,
      status: 'needs_review',
      visibility,
      resume_use: prior.resume_use ?? (visibility === 'private' ? 'never' : 'allowed'),
      source: prior.source ?? 'profile_import',
    };
    if (declared !== null) meta.declared_status = declared;
    record.meta = meta;
    if (prior.status !== 'needs_review') marked += 1;
    if (declared !== null && declared !== 'needs_review' && prior.declared_status == null)
      preserved += 1;
  }

  if (report) {
    report.step(
      'apply_import_defaults',
      null,
      'needs_review',
      'Importacao: todo fato vira needs_review (archived permanece archived, com resume_use never); status declarado preservado; defaults de visibilidade e uso.',
      marked,
    );
    if (marked > 0) {
      report.info(
        'STATUS_SET_NEEDS_REVIEW',
        null,
        `${marked} registro(s) marcado(s) como needs_review; a confirmacao e uma acao explicita do usuario.`,
      );
    }
    if (archivedKept > 0) {
      report.info(
        'ARCHIVED_STATUS_KEPT',
        null,
        `${archivedKept} registro(s) declarado(s) archived permaneceram archived, com resume_use never (nunca entram em curriculo).`,
      );
    }
    if (preserved > 0) {
      report.info(
        'DECLARED_STATUS_PRESERVED',
        null,
        `${preserved} registro(s) tinham status declarado diferente de needs_review (guardado em meta.declared_status).`,
      );
    }
  }
  return {
    document: copy as unknown as ProfileDocument,
    archivedKept,
    markedNeedsReview: marked,
    declaredStatusPreserved: preserved,
  };
}
