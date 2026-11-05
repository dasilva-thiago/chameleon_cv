import type { OwnerScopedClient } from '@chameleon/db';

/**
 * True when the LATEST consent record of `ownerId` for `purpose` has `granted = true` (a later
 * withdrawal wins over an earlier grant, and no record means no consent). Phase 2 routes that
 * process profile data (or call an AI provider) must gate on this, e.g.
 * `hasGrantedConsent(req.auth.db, req.auth.ownerId, 'profile_processing')`.
 *
 * Takes the OWNER-SCOPED client: it can only ever see the caller's own records, and a mismatched
 * `ownerId` makes the scope throw (fail closed) instead of reading someone else's consent. Ties on `recordedAt` are
 * broken by `id` (UUID v7, time-ordered).
 */
export async function hasGrantedConsent(
  db: OwnerScopedClient,
  ownerId: string,
  purpose: string,
): Promise<boolean> {
  const latest = await db.consentRecord.findFirst({
    where: { ownerId, purpose },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    select: { granted: true },
  });
  return latest?.granted === true;
}
