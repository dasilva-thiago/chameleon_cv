import type { ImportReport, ProfileDocument } from '@chameleon/contracts';
import type { ApplySummary, OnMissing } from '../mappers/plan';

/**
 * Funcao que monta o snapshot (forma canonica + hash). Injetada porque `packages/db` so pode
 * depender de `@chameleon/contracts` (tests/architecture/deps-lib.ts): quem compoe o ProfileStore
 * (apps/api, testes) passa `buildProfileSnapshot` de `@chameleon/domain`.
 */
export type SnapshotBuilder = (document: ProfileDocument) => {
  schemaVersion: string;
  /** SHA-256 hex (64) do JSON canonico RFC 8785 do documento canonico. */
  contentHash: string;
  document: ProfileDocument;
};

export interface ProfileStoreDeps {
  snapshot: SnapshotBuilder;
  /** UUID v7 por padrao; injetavel para testes deterministicos. */
  generateId?: () => string;
  now?: () => Date;
}

export type RevisionReason = 'manual_save' | 'import' | 'pre_generation' | 'migration';

export interface LoadedProfile {
  profileId: string;
  /** Documento canonico 2.1.0 (validado contra o contrato). */
  document: ProfileDocument;
  /** Versao do contrato com que o perfil foi gravado (a leitura sempre emite a corrente). */
  storedSchemaVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveOptions {
  /** Perfil de destino; omitido = perfil primario do dono (criado se nao existir). */
  profileId?: string;
  /**
   * O que fazer com registros que existem no banco mas nao estao no documento.
   * `archive` (padrao): fatos ficam `archived` + `resume_use: never` (ADR-0006: arquivar e o padrao);
   * demais registros (contatos, evidencias, pendencias, restricoes) sao removidos.
   * `keep`: nada e removido (merge). `delete`: remocao definitiva (acao explicita do usuario).
   */
  onMissing?: OnMissing;
  /**
   * Se algum id do documento ja pertencer a outro dono (ex.: arquivo exportado por outra pessoa), a
   * gravacao falha com `ID_CONFLICT` (sem revelar de quem). Com `true`, repete a gravacao gerando
   * ids novos para os registros ainda nao existentes neste perfil; o mapa vem em `idRemap`.
   */
  regenerateConflictingIds?: boolean;
  /** Cria uma ProfileRevision na mesma transacao. */
  revision?: RevisionReason;
}

export interface SaveResult {
  profileId: string;
  /** `true` quando o perfil foi criado por esta gravacao. */
  profileCreated: boolean;
  summary: ApplySummary;
  /** Registros sem id que receberam um (contagem; os ids estao no documento lido de volta). */
  generatedIds: number;
  /** Telefones gravados na forma canonica. */
  phonesNormalized: number;
  /** id do documento -> id gravado, quando `regenerateConflictingIds` foi necessario. */
  idRemap: Record<string, string>;
  revision: RevisionResult | null;
}

export interface RevisionSummary {
  id: string;
  profileId: string;
  revisionNumber: number;
  schemaVersion: string;
  contentHash: string;
  reason: RevisionReason;
  createdAt: Date;
}

export interface RevisionResult {
  revision: RevisionSummary;
  /** `true` quando o hash nao mudou e a ultima revisao foi reutilizada. */
  reused: boolean;
}

export interface RevisionWithSnapshot extends RevisionSummary {
  /** ProfileDocument armazenado (na versao em `schemaVersion`). Imutavel. */
  snapshot: ProfileDocument;
  /** O hash recalculado a partir do snapshot confere com `contentHash`. */
  verified: boolean;
}

export interface CreateRevisionOptions {
  profileId?: string;
  reason?: RevisionReason;
}

export interface ListRevisionsOptions {
  profileId?: string;
  limit?: number;
  /** Devolve revisoes com numero menor que este (paginacao por cursor). */
  beforeRevisionNumber?: number;
}

export type ImportStatus = 'preview' | 'applied' | 'discarded';

export interface ImportRecordView {
  id: string;
  profileId: string;
  sourceFormat: ImportReport['source_format'];
  sourceSchemaVersion: string | null;
  targetSchemaVersion: string;
  mode: ImportReport['mode'];
  status: ImportStatus;
  steps: ImportReport['steps'];
  warnings: ImportReport['warnings'];
  errors: ImportReport['errors'];
  idMap: Record<string, string>;
  unmapped: ImportReport['unmapped'];
  summary: Partial<ApplySummary>;
  revisionId: string | null;
  createdAt: Date;
  appliedAt: Date | null;
}

export interface CreateImportRecordInput {
  report: ImportReport;
  profileId?: string;
}

export interface ApplyImportInput {
  /** `ImportResult.document` do profile-io (canonico, com UUIDs e defaults de importacao). */
  document: ProfileDocument;
  report: ImportReport;
  /** `merge` (padrao): nada que o arquivo omite e removido. `replace`: omitidos sao arquivados. */
  mode?: 'merge' | 'replace';
  profileId?: string;
  /** ImportRecord em `preview` criado antes (senao um novo e criado ja como `applied`). */
  importRecordId?: string;
  regenerateConflictingIds?: boolean;
}

export interface ApplyImportResult {
  importRecord: ImportRecordView;
  save: SaveResult;
  revision: RevisionResult;
}

export interface ListImportsOptions {
  profileId?: string;
  limit?: number;
  status?: ImportStatus;
}

export interface ProfileStore {
  /** Aplica um ProfileDocument validado (UUIDs) como linhas, em uma transacao. */
  saveProfileDocument(
    ownerId: string,
    document: unknown,
    options?: SaveOptions,
  ): Promise<SaveResult>;
  /** Linhas -> ProfileDocument 2.1.0 canonico. `null` se o dono nao tem o perfil. */
  loadProfileDocument(ownerId: string, profileId?: string): Promise<LoadedProfile | null>;
  /** Snapshot imutavel + hash canonico; reutiliza a ultima revisao se o hash nao mudou. */
  createRevision(ownerId: string, options?: CreateRevisionOptions): Promise<RevisionResult>;
  listRevisions(ownerId: string, options?: ListRevisionsOptions): Promise<RevisionSummary[]>;
  getRevision(ownerId: string, revisionId: string): Promise<RevisionWithSnapshot | null>;
  createImportRecord(ownerId: string, input: CreateImportRecordInput): Promise<ImportRecordView>;
  /** Aplica uma importacao: grava o documento, registra o ImportRecord e cria a revisao. */
  applyImport(ownerId: string, input: ApplyImportInput): Promise<ApplyImportResult>;
  discardImport(ownerId: string, importRecordId: string): Promise<ImportRecordView>;
  listImportRecords(ownerId: string, options?: ListImportsOptions): Promise<ImportRecordView[]>;
  /** Uniao dos `id_map` das importacoes aplicadas: use como `existingIdMap` do profile-io. */
  getImportIdMap(ownerId: string, profileId?: string): Promise<Record<string, string>>;
}
