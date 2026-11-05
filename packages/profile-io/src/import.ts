import {
  canonicalizeProfileDocument,
  listRecords,
  PROFILE_SCHEMA_VERSION,
  type ImportReport,
  type ProfileDocument,
} from '@chameleon/contracts';
import { applyImportDefaults } from './defaults';
import { assignIds } from './ids';
import type { ParseLimits } from './limits';
import { migrateLegacyToCurrent, migratePreviousToCurrent } from './migrate';
import { normalizeProfileData } from './normalize';
import { parseProfileText, type FormatHint, type ProfileTextFormat } from './parse';
import { buildImportPreview, type ImportPreview } from './preview';
import { ReportBuilder } from './report';
import { validateProfile, type ValidationMode } from './validate';
import { detectSchemaVersion } from './version';

export interface LoadOptions {
  /**
   * Formato do texto; `auto` (padrao) detecta (`{` = JSON; anotacao `<!-- path: ... -->` = Markdown;
   * senao YAML). Ignorado para objetos.
   */
  format?: ProfileTextFormat | 'auto';
  /** Nome/tipo do arquivo, quando conhecidos: a extensao `.md` seleciona o Markdown anotado. */
  hint?: FormatHint;
  /** `strict` (padrao) rejeita chaves desconhecidas; `lenient` as preserva em `report.unmapped`. */
  mode?: ValidationMode;
  limits?: Partial<ParseLimits>;
}

export interface ImportOptions extends LoadOptions {
  /** Perfil atual, para o diff da pre-visualizacao (modo merge). */
  existing?: ProfileDocument | null;
  /** Gerador de ids (padrao: UUID v7). Injetavel em testes. */
  generateId?: () => string;
  /** Mapa `id local -> UUID` de importacoes anteriores (reimportacao idempotente). */
  existingIdMap?: Readonly<Record<string, string>>;
}

export interface LoadResult {
  ok: boolean;
  report: ImportReport;
  /** Documento na versao corrente validado e canonico, SEM defaults de importacao nem ids definitivos. */
  document: ProfileDocument | null;
}

export interface ImportResult extends LoadResult {
  /** Documento pronto para aplicar: needs_review, UUIDs e `meta` padrao. */
  preview: ImportPreview | null;
}

/** Annotated Markdown is recorded as its own `source_format` (the `parse_markdown` step is kept too). */
const MARKDOWN_REPORT_SOURCE_FORMAT: ImportReport['source_format'] = 'markdown';

interface Pipeline {
  report: ReportBuilder;
  sourceFormat: ImportReport['source_format'];
  sourceVersion: string | null;
  mode: ValidationMode;
}

/**
 * Reimportacao sobre um perfil existente: registros SEM id no arquivo nao podem ser casados com os
 * existentes (nao ha casamento heuristico por conteudo) e viram registros novos, o que pode duplicar
 * informacao. Avisa uma vez, com a contagem por tipo; nao altera o comportamento (ids novos).
 */
function warnIdsMissing(document: ProfileDocument, report: ReportBuilder): void {
  const byKind = new Map<string, number>();
  for (const entry of listRecords(document)) {
    if (entry.id === null) byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  }
  if (byKind.size === 0) return;
  const total = [...byKind.values()].reduce((sum, n) => sum + n, 0);
  const kinds = [...byKind].map(([kind, n]) => `${kind}: ${n}`).join(', ');
  report.warn(
    'IDS_MISSING_REIMPORT_RISK',
    null,
    `${total} registro(s) do arquivo nao tem id (${kinds}). Como ja existe um perfil, eles nao podem ser casados com os registros existentes e serao tratados como NOVOS, o que pode duplicar informacoes ja cadastradas. Para atualizar em vez de duplicar, reimporte um arquivo exportado pelo sistema (com ids) ou acrescente ids aos registros.`,
  );
}

const finish = (pipeline: Pipeline): ImportReport =>
  pipeline.report.build({
    sourceFormat: pipeline.sourceFormat,
    sourceVersion: pipeline.sourceVersion,
    mode: pipeline.mode,
  });

/**
 * Pipeline de leitura (ADR-0004): parse -> detectar versao -> migrar -> normalizar -> validar ->
 * forma canonica. Nao aplica defaults de governanca nem atribui ids (ver `importProfile`).
 */
export function loadProfile(
  input: string | Record<string, unknown>,
  options: LoadOptions = {},
): LoadResult {
  const mode = options.mode ?? 'strict';
  const report = new ReportBuilder();
  const pipeline: Pipeline = { report, sourceFormat: 'object', sourceVersion: null, mode };
  const fail = (): LoadResult => ({ ok: false, report: finish(pipeline), document: null });

  let data: unknown = input;
  if (typeof input === 'string') {
    const parsed = parseProfileText(input, {
      format: options.format,
      hint: options.hint,
      limits: options.limits,
    });
    pipeline.sourceFormat =
      parsed.format === 'markdown' ? MARKDOWN_REPORT_SOURCE_FORMAT : parsed.format;
    if (!parsed.ok) {
      for (const error of parsed.errors) report.error('', error.code, error.message);
      return fail();
    }
    data = parsed.data;
    if (parsed.format === 'markdown') {
      report.warnings.push(...(parsed.warnings ?? []));
      report.unmapped.push(...(parsed.unmapped ?? []));
      report.step(
        'parse_markdown',
        null,
        'object',
        'Leitura do Markdown anotado (ancoras <!-- path: ... -->) com limites de seguranca.',
        1,
      );
    } else {
      report.step(
        'parse',
        null,
        'object',
        `Leitura de ${parsed.format.toUpperCase()} com limites de seguranca.`,
        1,
      );
    }
  }

  const detection = detectSchemaVersion(data);
  pipeline.sourceVersion = detection.version;
  switch (detection.kind) {
    case 'missing':
      report.error('schema_version', 'VERSION_MISSING', detection.message);
      return fail();
    case 'invalid':
      report.error('schema_version', 'VERSION_INVALID', detection.message);
      return fail();
    case 'future':
      report.error('schema_version', 'VERSION_FUTURE', detection.message);
      return fail();
    case 'unsupported':
      report.error('schema_version', 'VERSION_UNSUPPORTED', detection.message);
      return fail();
    case 'legacy': {
      const migrated = migrateLegacyToCurrent(data, report);
      if (!migrated.ok) {
        for (const error of migrated.errors) report.error(error.path, error.code, error.message);
        return fail();
      }
      data = migrated.data;
      break;
    }
    case 'previous': {
      const upgraded = migratePreviousToCurrent(data, detection.version, report);
      if (!upgraded.ok) {
        for (const error of upgraded.errors) report.error(error.path, error.code, error.message);
        return fail();
      }
      data = upgraded.data;
      break;
    }
    case 'current':
      break;
  }

  const normalized = normalizeProfileData(data, report);
  const validation = validateProfile(normalized.data, mode, report);
  if (!validation.ok) {
    for (const issue of validation.issues) report.error(issue.path, issue.code, issue.message);
    return fail();
  }
  const document = canonicalizeProfileDocument(validation.document);
  report.step(
    'validate',
    null,
    PROFILE_SCHEMA_VERSION,
    `Validacao contra o contrato ${PROFILE_SCHEMA_VERSION} (${mode}).`,
    0,
  );
  return { ok: true, report: finish(pipeline), document };
}

/**
 * Importacao completa: `loadProfile` + defaults de governanca (`needs_review`, visibilidade, uso,
 * origem) + ids definitivos (UUID) + pre-visualizacao. Nada e persistido aqui.
 * `result.document` e o documento que seria aplicado.
 */
export function importProfile(
  input: string | Record<string, unknown>,
  options: ImportOptions = {},
): ImportResult {
  const loaded = loadProfile(input, options);
  if (!loaded.ok || !loaded.document) return { ...loaded, preview: null };

  // reabre o relatorio para acrescentar os passos finais
  const report = new ReportBuilder();
  report.steps.push(...loaded.report.steps);
  report.warnings.push(...loaded.report.warnings);
  report.errors.push(...loaded.report.errors);
  report.unmapped.push(...loaded.report.unmapped);

  if (options.existing) warnIdsMissing(loaded.document, report);
  const withDefaults = applyImportDefaults(loaded.document, report);
  const withIds = assignIds(
    withDefaults.document,
    { generate: options.generateId, existingIdMap: options.existingIdMap },
    report,
  );
  const document = canonicalizeProfileDocument(withIds.document);

  // autoverificacao: o documento final precisa continuar valido
  const check = validateProfile(document, 'strict');
  if (!check.ok) {
    for (const issue of check.issues)
      report.error(issue.path, `FINAL_${issue.code}`, issue.message);
    const failed = report.build({
      sourceFormat: loaded.report.source_format,
      sourceVersion: loaded.report.source_schema_version,
      mode: loaded.report.mode,
    });
    return { ok: false, report: failed, document: null, preview: null };
  }

  const finalReport = report.build({
    sourceFormat: loaded.report.source_format,
    sourceVersion: loaded.report.source_schema_version,
    mode: loaded.report.mode,
  });
  finalReport.id_map = withIds.idMap;
  const preview = buildImportPreview(document, finalReport, options.existing);
  return { ok: true, report: finalReport, document, preview };
}
