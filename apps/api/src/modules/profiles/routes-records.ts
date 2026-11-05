import {
  PROFILE_RECORD_SCHEMAS,
  confirmRecordsRequestSchema,
  createRecordRequestSchema,
  isFactKind,
  patchRecordMetaRequestSchema,
  replaceRecordRequestSchema,
  type ConfirmRecordsResponse,
  type ProfileDocument,
  type ProfileRecordResponse,
  type SaveResultDto,
} from '@chameleon/contracts';
import { newUuidV7 } from '@chameleon/db';
import { HttpError } from '../../http/errors';
import {
  allRecords,
  insertRecord,
  locateRecord,
  patchMeta,
  removeRecord,
  replaceRecord,
  statusOf,
  summarize,
  type Json,
  type Located,
} from './doc';
import { notFound, parseDto, uuidParam, validationError, zodDetails } from './errors';
import type { ProfileRoutes } from './gate';
import { commit, loadBase } from './save';
import { scopeOf, type ProfileScope } from './scope';

const recordBody = (located: Located): ProfileRecordResponse => ({
  kind: located.kind,
  parentId: located.parentId,
  section: located.section,
  record: located.value,
});

/** Validates a record body against the schema of its kind (the same schema that validates the document). */
function validatedRecord(kind: Located['kind'], record: unknown): Json {
  const result = PROFILE_RECORD_SCHEMAS[kind].safeParse(record);
  if (!result.success) throw validationError(zodDetails(result.error.issues, 'record'));
  return result.data as Json;
}

async function requireLocated(
  scope: ProfileScope,
  id: string,
): Promise<{ base: ProfileDocument; located: Located }> {
  const { base, exists } = await loadBase(scope);
  const located = exists ? locateRecord(base, id) : null;
  if (!located) throw notFound();
  return { base, located };
}

function writeBody(
  document: ProfileDocument,
  id: string,
  save: SaveResultDto,
): ProfileRecordResponse & { save: SaveResultDto } {
  const located = locateRecord(document, id);
  if (!located) throw new HttpError(500, 'INTERNAL_ERROR', 'Erro interno.');
  return { ...recordBody(located), save };
}

export function registerRecordRoutes(profile: ProfileRoutes): void {
  profile.post(
    '/records',
    'Create a record (the server generates the id); nested kinds need parentId.',
    async (req, res) => {
      const scope = scopeOf(res);
      const body = parseDto(createRecordRequestSchema, req.body);
      const checked = validatedRecord(body.kind, body.record);
      const id = newUuidV7();
      const result = await scope.exclusive(async () => {
        const { base } = await loadBase(scope);
        const next = insertRecord(base, body.kind, body.parentId?.toLowerCase(), {
          ...checked,
          id,
        });
        if (!next) throw notFound(); // missing/foreign/wrong-kind parent
        return commit(scope, base, next, { generatedIds: new Set([id]) });
      });
      await scope.audit('profile.record.create', 'ProfileRecord', id, { kind: body.kind });
      res.status(201).json(writeBody(result.loaded.document, id, result.save));
    },
  );

  profile.get('/records/:recordId', 'Read one record by id.', async (req, res) => {
    const id = uuidParam(req.params.recordId);
    const { located } = await requireLocated(scopeOf(res), id);
    res.json(recordBody(located));
  });

  profile.put(
    '/records/:recordId',
    'Replace a record (children of experience/project that are not mentioned are kept).',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.recordId);
      const body = parseDto(replaceRecordRequestSchema, req.body);
      const result = await scope.exclusive(async () => {
        const { base, located } = await requireLocated(scope, id);
        const sentId = body.record.id;
        if (
          sentId !== undefined &&
          sentId !== null &&
          (typeof sentId !== 'string' || sentId.toLowerCase() !== id)
        ) {
          throw validationError([
            { path: 'record.id', message: 'O id do registro nao pode ser alterado.' },
          ]);
        }
        const checked = validatedRecord(located.kind, { ...body.record, id: located.value.id });
        return commit(scope, base, replaceRecord(base, located, checked));
      });
      await scope.audit('profile.record.update', 'ProfileRecord', id, {});
      res.json(writeBody(result.loaded.document, id, result.save));
    },
  );

  profile.delete(
    '/records/:recordId',
    'Permanently delete a record (the only hard delete); 409 RECORD_IN_USE if others point to it.',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.recordId);
      const result = await scope.exclusive(async () => {
        const { base, located } = await requireLocated(scope, id);
        const removed = removeRecord(base, located);
        if (removed.blockers.length > 0) {
          throw new HttpError(
            409,
            'RECORD_IN_USE',
            'Outros registros dependem deste. Remova o vinculo antes.',
            {
              details: removed.blockers.slice(0, 20).map((blocker) => ({
                path: blocker.refererId || blocker.refererKind,
                message: `${blocker.refererKind} referencia este registro (${blocker.field}).`,
              })),
            },
          );
        }
        const saved = await commit(scope, base, removed.document, { onMissing: 'delete' });
        return { ...saved, kind: located.kind };
      });
      await scope.audit('profile.record.delete', 'ProfileRecord', id, { kind: result.kind });
      res.json({
        deleted: { kind: result.kind, id },
        save: result.save,
        summary: result.state.summary,
      });
    },
  );

  profile.patch(
    '/records/:recordId/meta',
    'Governance of a fact: status, visibility, resume_use, field_states.',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.recordId);
      const patch = parseDto(patchRecordMetaRequestSchema, req.body);
      const result = await scope.exclusive(async () => {
        const { base, located } = await requireLocated(scope, id);
        const patched = patchMeta(base, located, patch);
        if (!patched.ok) throw validationError([{ path: patched.path, message: patched.message }]);
        return commit(scope, base, patched.document);
      });
      await scope.audit('profile.record.meta', 'ProfileRecord', id, {
        status: patch.status ?? null,
        visibility: patch.visibility ?? null,
        resume_use: patch.resume_use ?? null,
      });
      res.json(writeBody(result.loaded.document, id, result.save));
    },
  );

  profile.post(
    '/records/:recordId/archive',
    'Archive a fact (status archived, resume_use never).',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.recordId);
      const result = await scope.exclusive(async () => {
        const { base, located } = await requireLocated(scope, id);
        if (!isFactKind(located.kind)) {
          throw validationError([
            {
              path: 'recordId',
              message: 'Este tipo de registro nao pode ser arquivado; use DELETE.',
            },
          ]);
        }
        const patched = patchMeta(base, located, { status: 'archived' });
        if (!patched.ok) throw validationError([{ path: patched.path, message: patched.message }]);
        return commit(scope, base, patched.document);
      });
      await scope.audit('profile.record.archive', 'ProfileRecord', id, {});
      res.json(writeBody(result.loaded.document, id, result.save));
    },
  );

  profile.post(
    '/confirmations',
    'Batch confirm: needs_review -> confirmed for the listed ids only.',
    async (req, res) => {
      const scope = scopeOf(res);
      const body = parseDto(confirmRecordsRequestSchema, req.body);
      const response = await scope.exclusive(async (): Promise<ConfirmRecordsResponse> => {
        const { base, exists } = await loadBase(scope);
        const known = new Map(allRecords(base).map((record) => [record.id, record]));
        const confirmed: string[] = [];
        const skipped: ConfirmRecordsResponse['skipped'] = [];
        let next = base;
        for (const requested of body.recordIds) {
          const id = requested.toLowerCase();
          const located = exists ? known.get(id) : undefined;
          if (!located) skipped.push({ recordId: id, reason: 'not_found' });
          else if (!isFactKind(located.kind)) skipped.push({ recordId: id, reason: 'not_a_fact' });
          else if (statusOf(located.value) !== 'needs_review') {
            skipped.push({ recordId: id, reason: 'not_needs_review' });
          } else {
            const current = locateRecord(next, id);
            const patched = current ? patchMeta(next, current, { status: 'confirmed' }) : null;
            if (patched?.ok) {
              next = patched.document;
              confirmed.push(id);
            }
          }
        }
        if (confirmed.length > 0) await commit(scope, base, next);
        return { confirmed, skipped, summary: summarize(next) };
      });
      await scope.audit('profile.confirm_batch', 'ProfessionalProfile', null, {
        confirmed: response.confirmed.length,
        skipped: response.skipped.length,
      });
      res.json(response);
    },
  );
}
