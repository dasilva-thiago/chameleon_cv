import {
  PROFILE_SCHEMA_VERSION,
  type ImportError,
  type ImportReport,
  type ImportStep,
  type ImportWarning,
  type ImportWarningCode,
  type UnmappedEntry,
} from '@chameleon/contracts';

/** Acumulador do `ImportReport` ao longo do pipeline (parse, migracao, normalizacao, defaults). */
export class ReportBuilder {
  readonly warnings: ImportWarning[] = [];
  readonly steps: ImportStep[] = [];
  readonly errors: ImportError[] = [];
  readonly unmapped: UnmappedEntry[] = [];
  idMap: Record<string, string> = {};

  warn(
    code: ImportWarningCode,
    path: string | null,
    message: string,
    severity: 'info' | 'warning' = 'warning',
  ): void {
    this.warnings.push({ code, severity, path, message });
  }

  info(code: ImportWarningCode, path: string | null, message: string): void {
    this.warn(code, path, message, 'info');
  }

  step(id: string, from: string | null, to: string, description: string, changes: number): void {
    this.steps.push({ id, from, to, description, changes });
  }

  error(path: string, code: string, message: string): void {
    this.errors.push({ path, code, message });
  }

  addUnmapped(path: string, value: unknown, reason: string): void {
    this.unmapped.push({ path, value, reason });
  }

  count(code: ImportWarningCode): number {
    return this.warnings.filter((warning) => warning.code === code).length;
  }

  build(options: {
    sourceFormat: ImportReport['source_format'];
    sourceVersion: string | null;
    mode: ImportReport['mode'];
  }): ImportReport {
    return {
      source_format: options.sourceFormat,
      source_schema_version: options.sourceVersion,
      target_schema_version: PROFILE_SCHEMA_VERSION,
      mode: options.mode,
      steps: this.steps,
      warnings: this.warnings,
      errors: this.errors,
      unmapped: this.unmapped,
      id_map: this.idMap,
    };
  }
}
