import {
  parseProfileDocument,
  remapIds,
  type ImportReport,
  type ProfileDocument,
} from '@chameleon/contracts';
import { Prisma } from '../generated/prisma/client';
import type { Db } from '../client';
import type { Row } from '../mappers/codec';
import { prepareDocument, type PreparedDocument } from '../mappers/prepare';
import { rowsToDocument } from '../mappers/from-rows';
import { planChanges, type ApplySummary, type OnMissing } from '../mappers/plan';
import { documentToRows, emptyTables } from '../mappers/to-rows';
import { ProfileStoreError } from './errors';
import { newUuidV7 } from './ids';
import { executePlan, readStoredRows, toWrite, type Tx } from './rows-io';
import type {
  ApplyImportInput,
  ApplyImportResult,
  CreateImportRecordInput,
  CreateRevisionOptions,
  ImportRecordView,
  ListImportsOptions,
  ListRevisionsOptions,
  LoadedProfile,
  ProfileStore,
  ProfileStoreDeps,
  RevisionReason,
  RevisionResult,
  RevisionSummary,
  RevisionWithSnapshot,
  SaveOptions,
  SaveResult,
} from './types';

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 10_000,
  timeout: 60_000,
} as const;
const MAX_ATTEMPTS = 3;

const errorText = (error: unknown): string =>
  error instanceof Error
    ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`
    : '';
const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;

/** Falha transitoria de concorrencia que vale repetir (serializacao ou numero de revisao disputado). */
function isRetryable(error: unknown): boolean {
  const code = errorCode(error);
  if (code === 'P2034') return true;
  return code === 'P2002' && errorText(error).includes('revisionNumber');
}

function translateError(error: unknown): unknown {
  if (error instanceof ProfileStoreError) return error;
  const code = errorCode(error);
  const text = errorText(error);
  if (
    code === 'P2002' &&
    /_pkey|"id"|\bid\b/.test(text) &&
    !/normalizedKey|revisionNumber/.test(text)
  ) {
    return new ProfileStoreError(
      'ID_CONFLICT',
      'Um ou mais ids do documento ja estao em uso. Reenvie com regenerateConflictingIds para gerar ids novos.',
    );
  }
  if (code === 'P2002' && text.includes('normalizedKey')) {
    return new ProfileStoreError(
      'DUPLICATE_SKILL',
      'Ja existe uma competencia com a mesma chave normalizada neste perfil.',
    );
  }
  if (code === 'P2034' || code === 'P2002') {
    return new ProfileStoreError(
      'CONCURRENT_MODIFICATION',
      'Conflito de concorrencia: repita a operacao.',
    );
  }
  return error;
}

const asRecord = <T>(value: unknown): T => value as T;

function toRevisionSummary(row: Row): RevisionSummary {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    revisionNumber: Number(row.revisionNumber),
    schemaVersion: String(row.schemaVersion),
    contentHash: String(row.contentHash),
    reason: row.reason as RevisionReason,
    createdAt: row.createdAt as Date,
  };
}

function toImportView(row: Row): ImportRecordView {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    sourceFormat: row.sourceFormat as ImportRecordView['sourceFormat'],
    sourceSchemaVersion: (row.sourceSchemaVersion as string | null) ?? null,
    targetSchemaVersion: String(row.targetSchemaVersion),
    mode: row.mode as ImportRecordView['mode'],
    status: row.status as ImportRecordView['status'],
    steps: asRecord(row.steps),
    warnings: asRecord(row.warnings),
    errors: asRecord(row.errors),
    idMap: asRecord(row.idMap),
    unmapped: asRecord(row.unmapped),
    summary: asRecord(row.summary),
    revisionId: (row.revisionId as string | null) ?? null,
    createdAt: row.createdAt as Date,
    appliedAt: (row.appliedAt as Date | null) ?? null,
  };
}

/**
 * ProfileStore (S1.1b): persiste o agregado de perfil (documento <-> linhas). Usa SOMENTE o cliente
 * escopado `db.forOwner(ownerId)`; os mapeamentos puros ficam em `src/mappers`.
 */
export function createProfileStore(db: Db, deps: ProfileStoreDeps): ProfileStore {
  const generateId = deps.generateId ?? (() => newUuidV7());
  const now = deps.now ?? (() => new Date());

  async function run<T>(ownerId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const scoped = db.forOwner(ownerId);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await scoped.$transaction((tx) => fn(tx as unknown as Tx), TX_OPTIONS);
      } catch (error) {
        if (isRetryable(error) && attempt < MAX_ATTEMPTS) continue;
        throw translateError(error);
      }
    }
  }

  async function findProfile(tx: Tx, profileId?: string): Promise<Row | null> {
    const row = profileId
      ? await tx.professionalProfile.findFirst({ where: { id: profileId } })
      : await tx.professionalProfile.findFirst({ where: { isPrimary: true } });
    return row;
  }

  async function requireProfile(tx: Tx, profileId?: string): Promise<Row> {
    const profile = await findProfile(tx, profileId);
    if (!profile) throw new ProfileStoreError('PROFILE_NOT_FOUND', 'Perfil nao encontrado.');
    return profile;
  }

  async function loadFromProfileRow(tx: Tx, profile: Row): Promise<ProfileDocument> {
    const rows = await readStoredRows(tx, profile);
    // Autoverificacao: o que sai do banco sempre cumpre o contrato corrente.
    return parseProfileDocument(rowsToDocument(rows));
  }

  // ---------------------------------------------------------------- gravacao
  async function saveInTx(
    tx: Tx,
    ownerId: string,
    prepared: PreparedDocument,
    options: SaveOptions,
    regenerate: boolean,
  ): Promise<SaveResult> {
    const profile = await findProfile(tx, options.profileId);
    if (!profile && options.profileId) {
      throw new ProfileStoreError('PROFILE_NOT_FOUND', 'Perfil nao encontrado.');
    }
    const profileCreated = profile === null;
    const profileId = profile ? String(profile.id) : generateId();
    const existing = profile
      ? await readStoredRows(tx, profile)
      : { profile: {} as Row, tables: emptyTables() };

    let document = prepared.document;
    const idRemap: Record<string, string> = {};
    if (regenerate) {
      const knownIds = new Set<string>();
      for (const name of [
        'profileFact',
        'contactPoint',
        'evidence',
        'pendingItem',
        'usageRestriction',
        'projectCollaborator',
      ] as const) {
        for (const row of existing.tables[name]) knownIds.add(String(row.id));
      }
      document = remapIds(document, (id) => {
        if (knownIds.has(id)) return id;
        const fresh = generateId();
        idRemap[id] = fresh;
        return fresh;
      });
    }

    const desired = documentToRows(document, { ownerId, profileId });
    const onMissing: OnMissing = options.onMissing ?? 'archive';
    const plan = planChanges({ desired, existing, onMissing, now: now(), generateId });

    if (profileCreated) {
      await tx.professionalProfile.create({
        data: {
          id: profileId,
          ownerId,
          isPrimary: true,
          ...toWrite('professionalProfile', plan.profileChanges),
        } as Prisma.ProfessionalProfileUncheckedCreateInput,
      });
    } else {
      const hasChanges =
        Object.keys(plan.profileChanges).length > 0 ||
        plan.updates.length > 0 ||
        Object.values(plan.creates).some((rows) => (rows?.length ?? 0) > 0) ||
        Object.values(plan.deletes).some((ids) => (ids?.length ?? 0) > 0);
      if (hasChanges) {
        await tx.professionalProfile.update({
          where: { id: profileId },
          data: toWrite('professionalProfile', {
            ...plan.profileChanges,
            updatedAt: now(),
          }),
        });
      }
    }
    await executePlan(tx, plan);

    const revision = options.revision
      ? await createRevisionInTx(tx, ownerId, profileId, options.revision)
      : null;
    return {
      profileId,
      profileCreated,
      summary: plan.summary,
      generatedIds: prepared.generatedIds,
      phonesNormalized: prepared.phonesNormalized,
      idRemap,
      revision,
    };
  }

  async function saveDocument(
    ownerId: string,
    prepared: PreparedDocument,
    options: SaveOptions,
  ): Promise<SaveResult> {
    try {
      return await run(ownerId, (tx) => saveInTx(tx, ownerId, prepared, options, false));
    } catch (error) {
      if (
        error instanceof ProfileStoreError &&
        error.code === 'ID_CONFLICT' &&
        options.regenerateConflictingIds
      ) {
        return run(ownerId, (tx) => saveInTx(tx, ownerId, prepared, options, true));
      }
      throw error;
    }
  }

  // --------------------------------------------------------------- revisoes
  async function createRevisionInTx(
    tx: Tx,
    ownerId: string,
    profileId: string,
    reason: RevisionReason,
  ): Promise<RevisionResult> {
    const profile = await requireProfile(tx, profileId);
    const document = await loadFromProfileRow(tx, profile);
    const snapshot = deps.snapshot(document);
    const latest = (await tx.profileRevision.findFirst({
      where: { profileId },
      orderBy: { revisionNumber: 'desc' },
    })) as Row | null;
    if (latest?.contentHash === snapshot.contentHash) {
      return { revision: toRevisionSummary(latest), reused: true };
    }
    const created = (await tx.profileRevision.create({
      data: {
        ownerId,
        profileId,
        revisionNumber: Number(latest?.revisionNumber ?? 0) + 1,
        schemaVersion: snapshot.schemaVersion,
        contentHash: snapshot.contentHash,
        reason,
        snapshot: snapshot.document as unknown as Prisma.InputJsonValue,
      },
    })) as Row;
    return { revision: toRevisionSummary(created), reused: false };
  }

  // --------------------------------------------------------------- importacao
  function reportColumns(report: ImportReport): Row {
    return {
      sourceFormat: report.source_format,
      sourceSchemaVersion: report.source_schema_version,
      targetSchemaVersion: report.target_schema_version,
      mode: report.mode,
      steps: report.steps,
      warnings: report.warnings,
      errors: report.errors,
      idMap: report.id_map,
      unmapped: report.unmapped,
    };
  }

  const store: ProfileStore = {
    async saveProfileDocument(ownerId, document, options = {}) {
      const prepared = prepareDocument(document, generateId);
      return saveDocument(ownerId, prepared, options);
    },

    async loadProfileDocument(ownerId, profileId): Promise<LoadedProfile | null> {
      return run(ownerId, async (tx) => {
        const profile = await findProfile(tx, profileId);
        if (!profile) return null;
        const document = await loadFromProfileRow(tx, profile);
        return {
          profileId: String(profile.id),
          document,
          storedSchemaVersion: String(profile.schemaVersion),
          createdAt: profile.createdAt as Date,
          updatedAt: profile.updatedAt as Date,
        };
      });
    },

    async createRevision(ownerId, options: CreateRevisionOptions = {}) {
      return run(ownerId, async (tx) => {
        const profile = await requireProfile(tx, options.profileId);
        return createRevisionInTx(tx, ownerId, String(profile.id), options.reason ?? 'manual_save');
      });
    },

    async listRevisions(ownerId, options: ListRevisionsOptions = {}) {
      return run(ownerId, async (tx) => {
        const profile = await findProfile(tx, options.profileId);
        if (!profile) return [];
        const rows = await tx.profileRevision.findMany({
          where: {
            profileId: String(profile.id),
            ...(options.beforeRevisionNumber
              ? { revisionNumber: { lt: options.beforeRevisionNumber } }
              : {}),
          },
          orderBy: { revisionNumber: 'desc' },
          take: Math.min(Math.max(options.limit ?? 50, 1), 200),
          select: {
            id: true,
            profileId: true,
            revisionNumber: true,
            schemaVersion: true,
            contentHash: true,
            reason: true,
            createdAt: true,
          },
        });
        return rows.map((row) => toRevisionSummary(row as Row));
      });
    },

    async getRevision(ownerId, revisionId): Promise<RevisionWithSnapshot | null> {
      return run(ownerId, async (tx) => {
        const row = (await tx.profileRevision.findFirst({
          where: { id: revisionId },
        })) as Row | null;
        if (!row) return null;
        const snapshot = row.snapshot as ProfileDocument;
        return {
          ...toRevisionSummary(row),
          snapshot,
          verified: deps.snapshot(snapshot).contentHash === row.contentHash,
        };
      });
    },

    async createImportRecord(ownerId, input: CreateImportRecordInput) {
      return run(ownerId, async (tx) => {
        const profile = await requireProfile(tx, input.profileId);
        const row = (await tx.importRecord.create({
          data: {
            ownerId,
            profileId: String(profile.id),
            status: 'preview',
            ...reportColumns(input.report),
          } as Prisma.ImportRecordUncheckedCreateInput,
        })) as Row;
        return toImportView(row);
      });
    },

    async applyImport(ownerId, input: ApplyImportInput): Promise<ApplyImportResult> {
      const prepared = prepareDocument(input.document, generateId);
      const saveOptions: SaveOptions = {
        ...(input.profileId ? { profileId: input.profileId } : {}),
        onMissing: input.mode === 'replace' ? 'archive' : 'keep',
        revision: 'import',
        regenerateConflictingIds: input.regenerateConflictingIds ?? false,
      };

      const attempt = (regenerate: boolean): Promise<ApplyImportResult> =>
        run(ownerId, async (tx) => {
          let preview: Row | null = null;
          if (input.importRecordId) {
            preview = await tx.importRecord.findFirst({
              where: { id: input.importRecordId },
            });
            if (!preview)
              throw new ProfileStoreError('IMPORT_NOT_FOUND', 'Importacao nao encontrada.');
            if (preview.status !== 'preview') {
              throw new ProfileStoreError(
                'IMPORT_NOT_APPLICABLE',
                'A importacao nao esta em previa.',
              );
            }
          }
          const save = await saveInTx(tx, ownerId, prepared, saveOptions, regenerate);
          const revision = save.revision!;
          // idMap do relatorio: se ids foram regenerados, o mapa aponta para o id realmente gravado.
          const idMap = Object.fromEntries(
            Object.entries(input.report.id_map).map(([local, id]) => [
              local,
              save.idRemap[id] ?? id,
            ]),
          );
          const columns = {
            ...reportColumns(input.report),
            idMap,
            status: 'applied',
            appliedAt: now(),
            summary: save.summary,
            revisionId: revision.revision.id,
          } as Row;
          const row = (
            preview
              ? await tx.importRecord.update({
                  where: { id: String(preview.id) },
                  data: columns,
                })
              : await tx.importRecord.create({
                  data: {
                    ownerId,
                    profileId: save.profileId,
                    ...columns,
                  } as Prisma.ImportRecordUncheckedCreateInput,
                })
          ) as Row;
          return { importRecord: toImportView(row), save, revision };
        });

      try {
        return await attempt(false);
      } catch (error) {
        if (
          error instanceof ProfileStoreError &&
          error.code === 'ID_CONFLICT' &&
          input.regenerateConflictingIds
        ) {
          return attempt(true);
        }
        throw error;
      }
    },

    async discardImport(ownerId, importRecordId) {
      return run(ownerId, async (tx) => {
        const row = (await tx.importRecord.findFirst({
          where: { id: importRecordId },
        })) as Row | null;
        if (!row) throw new ProfileStoreError('IMPORT_NOT_FOUND', 'Importacao nao encontrada.');
        if (row.status !== 'preview') {
          throw new ProfileStoreError(
            'IMPORT_NOT_APPLICABLE',
            'Somente uma previa pode ser descartada.',
          );
        }
        const updated = (await tx.importRecord.update({
          where: { id: importRecordId },
          data: { status: 'discarded' },
        })) as Row;
        return toImportView(updated);
      });
    },

    async listImportRecords(ownerId, options: ListImportsOptions = {}) {
      return run(ownerId, async (tx) => {
        const profile = await findProfile(tx, options.profileId);
        if (!profile) return [];
        const rows = await tx.importRecord.findMany({
          where: {
            profileId: String(profile.id),
            ...(options.status ? { status: options.status } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: Math.min(Math.max(options.limit ?? 50, 1), 200),
        });
        return rows.map((row) => toImportView(row as Row));
      });
    },

    async getImportIdMap(ownerId, profileId) {
      return run(ownerId, async (tx) => {
        const profile = await findProfile(tx, profileId);
        if (!profile) return {};
        const rows = await tx.importRecord.findMany({
          where: { profileId: String(profile.id), status: 'applied' },
          orderBy: { createdAt: 'asc' },
          select: { idMap: true },
        });
        const merged: Record<string, string> = {};
        for (const row of rows) Object.assign(merged, row.idMap as Record<string, string>);
        return merged;
      });
    },
  };
  return store;
}

export type { ApplySummary };
