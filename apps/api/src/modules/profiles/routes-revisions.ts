import {
  createRevisionRequestSchema,
  listRevisionsQuerySchema,
  type CreateRevisionResponse,
  type ListRevisionsResponse,
  type RevisionDetailResponse,
} from '@chameleon/contracts';
import { notFound, parseDto, uuidParam } from './errors';
import type { ProfileRoutes } from './gate';
import { scopeOf } from './scope';
import { revisionDto, revisionResultDto } from './views';

export function registerRevisionRoutes(profile: ProfileRoutes): void {
  profile.post(
    '/revisions',
    'Create an immutable revision of the current profile (200 + reused when the hash did not change).',
    async (req, res) => {
      const scope = scopeOf(res);
      const body = parseDto(createRevisionRequestSchema, req.body);
      const result = await scope.exclusive(() =>
        scope.store.createRevision({ reason: body.reason }),
      );
      await scope.audit('profile.revision.create', 'ProfileRevision', result.revision.id, {
        reused: result.reused,
        reason: body.reason,
      });
      const response: CreateRevisionResponse = revisionResultDto(result);
      res.status(result.reused ? 200 : 201).json(response);
    },
  );

  profile.get(
    '/revisions',
    'List revisions, newest first (cursor: before=<revisionNumber>).',
    async (req, res) => {
      const query = parseDto(listRevisionsQuerySchema, req.query);
      const revisions = await scopeOf(res).store.listRevisions({
        limit: query.limit,
        ...(query.before !== undefined ? { beforeRevisionNumber: query.before } : {}),
      });
      const last = revisions[revisions.length - 1];
      const response: ListRevisionsResponse = {
        revisions: revisions.map(revisionDto),
        nextBefore: revisions.length === query.limit && last ? last.revisionNumber : null,
      };
      res.json(response);
    },
  );

  profile.get(
    '/revisions/:revisionId',
    'One revision with its snapshot and the hash verification.',
    async (req, res) => {
      const id = uuidParam(req.params.revisionId);
      const revision = await scopeOf(res).store.getRevision(id);
      if (!revision) throw notFound();
      const response: RevisionDetailResponse = {
        revision: revisionDto(revision),
        snapshot: revision.snapshot,
        verified: revision.verified,
      };
      res.json(response);
    },
  );
}
