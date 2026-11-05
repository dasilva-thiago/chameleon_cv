import {
  applyImportRequestSchema,
  listImportsQuerySchema,
  type ApplyImportResponse,
  type ImportDetailResponse,
  type ImportPreviewResponse,
  type ListImportsResponse,
} from '@chameleon/contracts';
import type { ImportRecordView } from '@chameleon/db';
import { importProfile } from '@chameleon/profile-io';
import { HttpError } from '../../http/errors';
import type { AppConfig } from '../../config';
import { emptyDocument, summarize } from './doc';
import { notFound, parseDto, uuidParam } from './errors';
import type { ProfileRoutes } from './gate';
import { importBodyParsers, readImportInput } from './import-input';
import { preserveGovernanceOfUnchanged } from './import-merge';
import { scopeOf, type ProfileScope } from './scope';
import {
  MAX_UNMAPPED_IN_RESPONSE,
  importErrorViews,
  importRecordDto,
  revisionDto,
  revisionResultDto,
  saveResultDto,
} from './views';

/** The store has no get-by-id for import records: look in the newest 200 (previews are short lived). */
async function findImportRecord(scope: ProfileScope, id: string): Promise<ImportRecordView> {
  const records = await scope.store.listImportRecords({ limit: 200 });
  const found = records.find((record) => record.id === id);
  if (!found) throw notFound();
  return found;
}

const iso = (millis: number): string => new Date(millis).toISOString();

export function registerImportRoutes(
  profile: ProfileRoutes,
  config: Pick<AppConfig, 'UPLOAD_MAX_BYTES'>,
): void {
  const maxBytes = config.UPLOAD_MAX_BYTES;

  profile.post(
    '/imports/preview',
    'Paste or upload YAML/JSON: parse, migrate, validate and preview. Nothing is applied.',
    ...importBodyParsers(maxBytes),
    async (req, res) => {
      const scope = scopeOf(res);
      scope.consumePreviewQuota();
      const input = readImportInput(req, maxBytes);

      const stored = await scope.store.loadProfileDocument();
      const existingIdMap = await scope.store.getImportIdMap();
      const result = importProfile(input.text, {
        format: input.format,
        mode: input.mode,
        limits: { maxBytes },
        existing: stored?.document ?? null,
        existingIdMap,
      });
      if (!result.ok || !result.document || !result.preview) {
        throw new HttpError(422, 'IMPORT_INVALID', 'O arquivo nao pode ser importado.', {
          details: importErrorViews(result.report.errors).map((error) => ({
            path: error.path,
            message: `${error.code}: ${error.message}`,
          })),
        });
      }

      const document = result.document;
      const preview = result.preview;
      const record = await scope.exclusive(async () => {
        // ImportRecord hangs from the profile row: create the (empty) profile on the first import.
        if (!stored) await scope.store.saveProfileDocument(emptyDocument(), { onMissing: 'keep' });
        return scope.store.createImportRecord(result.report);
      });
      const entry = scope.previews.put(record.id, { document, report: result.report, preview });
      await scope.audit('profile.import.preview', 'ImportRecord', record.id, {
        records: preview.totals.records,
        create: preview.totals.create,
        update: preview.totals.update,
        unchanged: preview.totals.unchanged,
        warnings: result.report.warnings.length,
      });
      const response: ImportPreviewResponse = {
        importRecord: importRecordDto(record),
        preview,
        warnings: result.report.warnings,
        unmapped: result.report.unmapped.slice(0, MAX_UNMAPPED_IN_RESPONSE),
        expiresAt: iso(entry.expiresAt),
      };
      res.status(201).json(response);
    },
  );

  profile.get('/imports', 'Import history (newest first).', async (req, res) => {
    const query = parseDto(listImportsQuerySchema, req.query);
    const records = await scopeOf(res).store.listImportRecords({
      limit: query.limit,
      ...(query.status ? { status: query.status } : {}),
    });
    const response: ListImportsResponse = { imports: records.map(importRecordDto) };
    res.json(response);
  });

  profile.get(
    '/imports/:importRecordId',
    'One import record (+ preview while it is still in memory).',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.importRecordId);
      const record = await findImportRecord(scope, id);
      const entry = record.status === 'preview' ? scope.previews.get(id) : undefined;
      const response: ImportDetailResponse = {
        importRecord: importRecordDto(record),
        preview: entry?.preview ?? null,
        expiresAt: entry ? iso(entry.expiresAt) : null,
      };
      res.json(response);
    },
  );

  profile.post(
    '/imports/:importRecordId/apply',
    'Apply a previewed import (merge never removes; replace needs confirmReplace).',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.importRecordId);
      const body = parseDto(applyImportRequestSchema, req.body);

      const outcome = await scope.exclusive(async () => {
        const entry = scope.previews.get(id);
        if (!entry) {
          const record = await findImportRecord(scope, id); // 404 for missing/foreign
          if (record.status !== 'preview') {
            throw new HttpError(
              409,
              'IMPORT_NOT_APPLICABLE',
              'A importacao nao esta mais em previa.',
            );
          }
          throw new HttpError(
            409,
            'IMPORT_PREVIEW_EXPIRED',
            'A previa expirou. Envie o arquivo novamente para gerar uma nova previa.',
          );
        }
        const stored = await scope.store.loadProfileDocument();
        const document = stored
          ? preserveGovernanceOfUnchanged(entry.document, stored.document, entry.report)
          : entry.document;
        // Snapshot of the state BEFORE the import so the owner can go back (skip an empty profile).
        const hasContent = stored !== null && Object.keys(stored.document.profile).length > 0;
        const previous = hasContent ? await scope.store.createRevision({ reason: 'import' }) : null;
        const applied = await scope.store.applyImport({
          document,
          report: entry.report,
          mode: body.mode,
          importRecordId: id,
          regenerateConflictingIds: body.regenerateConflictingIds,
        });
        scope.previews.delete(id);
        const after = await scope.store.loadProfileDocument();
        return { applied, previous, after };
      });

      const { applied, previous, after } = outcome;
      await scope.audit('profile.import.apply', 'ImportRecord', id, {
        mode: body.mode,
        created: applied.save.summary.totals.created,
        updated: applied.save.summary.totals.updated,
        archived: applied.save.summary.totals.archived,
        deleted: applied.save.summary.totals.deleted,
      });
      const response: ApplyImportResponse = {
        importRecord: importRecordDto(applied.importRecord),
        save: saveResultDto(applied.save),
        revision: revisionResultDto(applied.revision),
        previousRevision: previous ? revisionDto(previous.revision) : null,
        idRemapCount: Object.keys(applied.save.idRemap).length,
        summary: summarize(after?.document ?? null),
      };
      res.json(response);
    },
  );

  profile.post(
    '/imports/:importRecordId/discard',
    'Discard a previewed import.',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.importRecordId);
      const record = await scope.exclusive(() => scope.store.discardImport(id));
      scope.previews.delete(id);
      await scope.audit('profile.import.discard', 'ImportRecord', id, {});
      res.json({ importRecord: importRecordDto(record) });
    },
  );
}
