import {
  cloneJson,
  listRecords,
  remapIds,
  type ProfileDocument,
  type RecordKind,
} from '@chameleon/contracts';
import { isUuid, newId } from '@chameleon/domain';
import type { ReportBuilder } from './report';

export interface AssignIdsOptions {
  /** Gerador de ids novos (padrao: UUID v7). Injetavel para testes deterministicos. */
  generate?: () => string;
  /** Mapa `id local -> id definitivo` de importacoes anteriores (reimportacao idempotente). */
  existingIdMap?: Readonly<Record<string, string>>;
}

export interface AssignIdsResult {
  document: ProfileDocument;
  /** `id local -> UUID`. Ids que ja eram UUID nao entram no mapa. */
  idMap: Record<string, string>;
  generated: number;
}

/**
 * Garante que todo registro tenha um UUID:
 * - id local (ex.: `EXP-001`) -> mapeado para um UUID, e TODAS as referencias sao reescritas;
 * - id ausente -> UUID novo;
 * - id que ja e UUID -> mantido (reimportacao de arquivo exportado e idempotente).
 */
export function assignIds(
  document: ProfileDocument,
  options: AssignIdsOptions = {},
  report?: ReportBuilder,
): AssignIdsResult {
  const generate = options.generate ?? newId;
  const idMap: Record<string, string> = {};

  const mapper = (id: string, _kind: RecordKind): string => {
    if (isUuid(id)) return id;
    const known = options.existingIdMap?.[id];
    const next = known ?? generate();
    idMap[id] = next;
    return next;
  };
  const remapped = remapIds(document, mapper);

  let generated = 0;
  const filled = cloneJson(remapped) as unknown as Record<string, unknown>;
  for (const entry of listRecords(filled)) {
    if (entry.id === null) {
      entry.value.id = generate();
      generated += 1;
    }
  }

  if (report) {
    report.idMap = { ...report.idMap, ...idMap };
    report.step(
      'assign_ids',
      null,
      'uuid',
      'Ids locais mapeados para UUID; ids ausentes gerados.',
      Object.keys(idMap).length + generated,
    );
    if (Object.keys(idMap).length > 0) {
      report.info(
        'ID_REMAPPED',
        null,
        `${Object.keys(idMap).length} id(s) local(is) mapeado(s) para UUID.`,
      );
    }
    if (generated > 0) {
      report.info('ID_GENERATED', null, `${generated} registro(s) sem id receberam um UUID.`);
    }
  }
  return { document: filled as unknown as ProfileDocument, idMap, generated };
}
