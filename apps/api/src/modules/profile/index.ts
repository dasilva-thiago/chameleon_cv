import {
  PROFILE_BASE_LIMITS,
  saveProfileBaseRequestSchema,
  type ListProfileRevisionsResponse,
  type ProfileBase,
  type ProfileBaseResponse,
  type ProfileRevisionResponse,
  type SaveProfileBaseResponse,
} from '@chameleon/contracts';
import { hashProfileBase } from '@chameleon/domain';
import express, { type Request } from 'express';
import type { ApiModule } from '../../app';
import { requireAuthContext, type AuthContext } from '../../auth/context';
import { requireProfileConsent } from '../../consent';
import { notFound, parseDto, uuidParam } from '../../http/params';

/**
 * The professional base (`/api/profile/**`): the CV and the profile/rules in Markdown, like career-ops' `cv.md` and
 * `modes/_profile.md`. Every route needs the session and the `profile_processing` consent, and works only through
 * the owner-scoped client. Saving new content creates an immutable revision (the resumes point to it); saving the
 * same content is a no-op. Content is never logged: audit events carry ids and sizes only.
 */

/** `PUT /api/profile` carries up to ~70k characters of Markdown: it has its own body limit. */
export const PROFILE_BODY_LIMIT_BYTES = 512 * 1024;
export const LARGE_BODY_ROUTES: readonly { method: string; path: string }[] = [
  { method: 'PUT', path: '/profile' },
];

interface BaseRow {
  cvMarkdown: string;
  profileMarkdown: string;
  contentHash: string;
  revisionId: string;
  updatedAt: Date;
}

interface RevisionRow {
  id: string;
  cvMarkdown: string;
  profileMarkdown: string;
  contentHash: string;
  createdAt: Date;
}

const baseDto = (row: BaseRow): ProfileBase => ({
  cvMarkdown: row.cvMarkdown,
  profileMarkdown: row.profileMarkdown,
  revisionId: row.revisionId,
  hash: row.contentHash,
  updatedAt: row.updatedAt.toISOString(),
});

const revisionSummary = (row: RevisionRow) => ({
  id: row.id,
  hash: row.contentHash,
  cvChars: row.cvMarkdown.length,
  profileChars: row.profileMarkdown.length,
  createdAt: row.createdAt.toISOString(),
});

/** Normalizes line endings so the same text always hashes the same. */
const normalize = (value: string): string => value.replace(/\r\n?/g, '\n');

/** The current base of the owner, or null when it was never saved. */
export async function loadProfileBase(auth: AuthContext): Promise<BaseRow | null> {
  return auth.db.profileBase.findFirst({
    select: {
      cvMarkdown: true,
      profileMarkdown: true,
      contentHash: true,
      revisionId: true,
      updatedAt: true,
    },
  });
}

/**
 * Saves the base. New content -> a new immutable revision + the base pointing to it; same content -> nothing
 * written (`changed: false`). Shared with the restore route.
 */
export async function saveProfileBase(
  auth: AuthContext,
  input: { cvMarkdown: string; profileMarkdown: string },
): Promise<{ row: BaseRow; changed: boolean }> {
  const cvMarkdown = normalize(input.cvMarkdown);
  const profileMarkdown = normalize(input.profileMarkdown);
  const contentHash = hashProfileBase(cvMarkdown, profileMarkdown);
  const current = await loadProfileBase(auth);
  if (current?.contentHash === contentHash) return { row: current, changed: false };

  const revision = await auth.db.profileBaseRevision.create({
    data: { ownerId: auth.ownerId, cvMarkdown, profileMarkdown, contentHash },
    select: { id: true },
  });
  const data = { cvMarkdown, profileMarkdown, contentHash, revisionId: revision.id };
  const select = {
    cvMarkdown: true,
    profileMarkdown: true,
    contentHash: true,
    revisionId: true,
    updatedAt: true,
  } as const;
  const row = current
    ? await auth.db.profileBase.update({ where: { ownerId: auth.ownerId }, data, select })
    : await auth.db.profileBase.create({ data: { ownerId: auth.ownerId, ...data }, select });
  return { row, changed: true };
}

export const createProfileModule = (): ApiModule => (context) => {
  const { routes } = context;
  const bodyParser = express.json({ limit: PROFILE_BODY_LIMIT_BYTES, strict: true });

  const audit = (
    auth: AuthContext,
    req: Request,
    action: string,
    entityId: string,
    metadata: Record<string, string | number | boolean>,
  ): Promise<unknown> =>
    auth.db.auditEvent.create({
      data: {
        ownerId: auth.ownerId,
        action,
        entityType: 'ProfileBase',
        entityId,
        correlationId: req.correlationId,
        metadata,
      },
    });

  routes.get(
    '/profile',
    {
      auth: 'session',
      description: 'The professional base (CV + profile/rules in Markdown), or null.',
    },
    requireProfileConsent,
    async (req, res) => {
      const row = await loadProfileBase(requireAuthContext(req));
      const response: ProfileBaseResponse = { base: row === null ? null : baseDto(row) };
      res.json(response);
    },
  );

  routes.put(
    '/profile',
    {
      auth: 'session',
      description: 'Save the professional base. New content creates an immutable revision.',
    },
    requireProfileConsent,
    bodyParser,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const body = parseDto(saveProfileBaseRequestSchema, req.body);
      const { row, changed } = await saveProfileBase(auth, body);
      if (changed) {
        await audit(auth, req, 'profile.save', row.revisionId, {
          cvChars: row.cvMarkdown.length,
          profileChars: row.profileMarkdown.length,
        });
      }
      const response: SaveProfileBaseResponse = { base: baseDto(row), changed };
      res.json(response);
    },
  );

  routes.get(
    '/profile/revisions',
    {
      auth: 'session',
      description: 'Revisions of the professional base (newest first, no content).',
    },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const rows = await auth.db.profileBaseRevision.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PROFILE_BASE_LIMITS.revisionsListed,
      });
      const response: ListProfileRevisionsResponse = { revisions: rows.map(revisionSummary) };
      res.json(response);
    },
  );

  routes.get(
    '/profile/revisions/:revisionId',
    { auth: 'session', description: 'One revision of the professional base, with its content.' },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const row = await auth.db.profileBaseRevision.findFirst({
        where: { id: uuidParam(req.params.revisionId) },
      });
      if (!row) throw notFound();
      const response: ProfileRevisionResponse = {
        revision: {
          ...revisionSummary(row),
          cvMarkdown: row.cvMarkdown,
          profileMarkdown: row.profileMarkdown,
        },
      };
      res.json(response);
    },
  );

  routes.post(
    '/profile/revisions/:revisionId/restore',
    {
      auth: 'session',
      description: 'Make an old revision the current base (a new revision is created).',
    },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const old = await auth.db.profileBaseRevision.findFirst({
        where: { id: uuidParam(req.params.revisionId) },
      });
      if (!old) throw notFound();
      const { row, changed } = await saveProfileBase(auth, old);
      await audit(auth, req, 'profile.restore', row.revisionId, { from: old.id, changed });
      const response: SaveProfileBaseResponse = { base: baseDto(row), changed };
      res.json(response);
    },
  );
};
