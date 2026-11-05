import {
  isFactKind,
  linkEvidenceRequestSchema,
  patchPendingRequestSchema,
  pendingListQuerySchema,
  type EvidenceLinksResponse,
  type PendingListResponse,
  type ProfileDocument,
} from '@chameleon/contracts';
import {
  addEvidenceLink,
  allRecords,
  evidenceLinks,
  locateRecord,
  removeEvidenceLink,
  replaceRecord,
  type Located,
} from './doc';
import { notFound, parseDto, uuidParam, validationError } from './errors';
import type { ProfileRoutes } from './gate';
import { commit, loadBase } from './save';
import { scopeOf, type ProfileScope } from './scope';

async function requireEvidence(
  scope: ProfileScope,
  id: string,
): Promise<{ base: ProfileDocument; evidence: Located }> {
  const { base, exists } = await loadBase(scope);
  const evidence = exists ? locateRecord(base, id) : null;
  if (evidence?.kind !== 'evidence') throw notFound();
  return { base, evidence };
}

export function registerEvidenceRoutes(profile: ProfileRoutes): void {
  profile.get(
    '/evidence',
    'List evidence records with the records they support.',
    async (_req, res) => {
      const loaded = await scopeOf(res).store.loadProfileDocument();
      const evidence = loaded
        ? allRecords(loaded.document)
            .filter((record) => record.kind === 'evidence')
            .map((record) => ({
              record: record.value,
              links: evidenceLinks(loaded.document, record.id),
            }))
        : [];
      res.json({ evidence });
    },
  );

  profile.get(
    '/evidence/:evidenceId/links',
    'Records linked to one evidence.',
    async (req, res) => {
      const id = uuidParam(req.params.evidenceId);
      const { base } = await requireEvidence(scopeOf(res), id);
      const body: EvidenceLinksResponse = { evidenceId: id, links: evidenceLinks(base, id) };
      res.json(body);
    },
  );

  profile.post(
    '/evidence/:evidenceId/links',
    'Link an evidence to a fact (declared on evidence.supports).',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.evidenceId);
      const body = parseDto(linkEvidenceRequestSchema, req.body);
      const links = await scope.exclusive(async () => {
        const { base, evidence } = await requireEvidence(scope, id);
        const target = locateRecord(base, body.recordId);
        if (!target) throw notFound(); // unknown and foreign targets are indistinguishable
        if (!isFactKind(target.kind)) {
          throw validationError([
            { path: 'recordId', message: 'Evidencias sustentam fatos, nao este tipo de registro.' },
          ]);
        }
        const saved = await commit(scope, base, addEvidenceLink(base, evidence, target));
        return evidenceLinks(saved.loaded.document, id);
      });
      await scope.audit('profile.evidence.link', 'ProfileRecord', id, {});
      const response: EvidenceLinksResponse = { evidenceId: id, links };
      res.json(response);
    },
  );

  profile.delete(
    '/evidence/:evidenceId/links/:recordId',
    'Unlink an evidence from a record (both sides of the relation).',
    async (req, res) => {
      const scope = scopeOf(res);
      const id = uuidParam(req.params.evidenceId);
      const targetId = uuidParam(req.params.recordId);
      const links = await scope.exclusive(async () => {
        const { base } = await requireEvidence(scope, id);
        const saved = await commit(scope, base, removeEvidenceLink(base, id, targetId));
        return evidenceLinks(saved.loaded.document, id);
      });
      await scope.audit('profile.evidence.unlink', 'ProfileRecord', id, {});
      const response: EvidenceLinksResponse = { evidenceId: id, links };
      res.json(response);
    },
  );

  profile.get(
    '/pending',
    'Pending items (default: open) with target kind and counters.',
    async (req, res) => {
      const query = parseDto(pendingListQuerySchema, req.query);
      const loaded = await scopeOf(res).store.loadProfileDocument();
      const all = loaded
        ? allRecords(loaded.document).filter((record) => record.kind === 'pending_item')
        : [];
      const kindOf = new Map(
        (loaded ? allRecords(loaded.document) : []).map((record) => [record.id, record.kind]),
      );
      const statusOf = (value: Located['value']): 'open' | 'resolved' | 'dismissed' =>
        value.status === 'resolved' || value.status === 'dismissed' ? value.status : 'open';
      const counts = { open: 0, resolved: 0, dismissed: 0 };
      for (const record of all) counts[statusOf(record.value)] += 1;
      const body: PendingListResponse = {
        pending: all
          .filter((record) => query.status === 'all' || statusOf(record.value) === query.status)
          .map((record) => {
            const target = record.value.target;
            const targetId =
              typeof target === 'object' && target !== null
                ? (target as { record_id?: unknown }).record_id
                : undefined;
            return {
              record: record.value,
              targetKind:
                typeof targetId === 'string' ? (kindOf.get(targetId.toLowerCase()) ?? null) : null,
            };
          }),
        counts,
      };
      res.json(body);
    },
  );

  profile.patch('/pending/:pendingId', 'Change the status of a pending item.', async (req, res) => {
    const scope = scopeOf(res);
    const id = uuidParam(req.params.pendingId);
    const body = parseDto(patchPendingRequestSchema, req.body);
    const record = await scope.exclusive(async () => {
      const { base, exists } = await loadBase(scope);
      const located = exists ? locateRecord(base, id) : null;
      if (located?.kind !== 'pending_item') throw notFound();
      const saved = await commit(
        scope,
        base,
        replaceRecord(base, located, { ...located.value, status: body.status }),
      );
      return locateRecord(saved.loaded.document, id)?.value ?? located.value;
    });
    await scope.audit('profile.pending.status', 'ProfileRecord', id, { status: body.status });
    res.json({ kind: 'pending_item', parentId: null, section: 'pending_items', record });
  });
}
