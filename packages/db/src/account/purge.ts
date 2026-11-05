import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { assertOwnerId } from '../for-owner';
import { DbScopeError } from '../errors';

/**
 * Account deletion (ADR-0014, ADR-0006 item 5). The ONLY code path that deletes `ProfileRevision`
 * rows: the immutability trigger lets a DELETE through only while `chameleon.allow_purge = 'on'`, and
 * this routine sets it with `set_config(..., true)` (transaction-local, equivalent to `SET LOCAL`) inside
 * its own interactive transaction, so the flag is reverted at COMMIT/ROLLBACK and can never survive on a
 * pooled connection.
 */

/** Setting read by the `ProfileRevision_immutable` trigger. */
export const ALLOW_PURGE_SETTING = 'chameleon.allow_purge';

export interface PurgeAccountResult {
  /** `false` when the owner did not exist (nothing was deleted and nothing was recorded). */
  purged: boolean;
  /** Id of the minimal `AccountDeletion` record (no reference to the owner). `null` when not purged. */
  deletionId: string | null;
  /** Aggregate row count removed (owner tables + invites + the user). 0 when not purged. */
  rowsDeleted: number;
  /** Rows removed per owner-scoped table (catalog-driven); contains no personal data. */
  tables: Record<string, number>;
}

/** The purge sweep found rows still owned by the account: the transaction was rolled back. */
export class PurgeIncompleteError extends DbScopeError {
  override readonly name = 'PurgeIncompleteError';
  constructor(readonly remaining: Readonly<Record<string, number>>) {
    super(
      `Account purge left rows behind (${Object.entries(remaining)
        .map(([table, count]) => `${table}=${count}`)
        .join(', ')}); the transaction was rolled back.`,
    );
  }
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

type Tx = Prisma.TransactionClient;

/** Quote a catalog identifier (table names come from pg_class, never from input). */
const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/**
 * Every table of `public` that has an "ownerId" column. Read from the catalog (not from
 * `PRIVATE_MODELS`) so a table added later is covered before anyone remembers to register it.
 */
export async function listOwnerTables(tx: Pick<Tx, '$queryRaw'>): Promise<string[]> {
  const rows = await tx.$queryRaw<{ table_name: string }[]>`
    SELECT c.relname::text AS table_name
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'ownerId' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     ORDER BY 1`;
  return rows.map((row) => row.table_name);
}

async function countRows(
  tx: Tx,
  tables: readonly string[],
  ownerId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${quoteIdent(table)} WHERE "ownerId" = $1::uuid`,
      ownerId,
    );
    counts[table] = rows[0]?.n ?? 0;
  }
  return counts;
}

/**
 * Deletes ALL data of one owner in a single transaction:
 * 1. turns the purge flag on for this transaction only;
 * 2. locks the `User` row (a concurrent writer of this owner either finishes first or fails its FK);
 * 3. deletes invitations tied to the account (they hold an e-mail address: the user's own invite and
 *    any invite addressed to the same e-mail);
 * 4. deletes the `User` row, which cascades to every owner-scoped table (incl. immutable revisions);
 * 5. verifies, from the catalog, that 0 rows remain for the owner in every table with an "ownerId"
 *    column (and that the user and its invitations are gone); otherwise rolls everything back;
 * 6. records a minimal `AccountDeletion` row (aggregate count only, no reference to the owner).
 *
 * Callable only from trusted server code (it is a method of the `Db` object, not of `forOwner`). The
 * caller must have authenticated and authorized the request (password confirmation, ADR-0014) and must
 * delete files in storage separately.
 */
export async function purgeAccountData(
  base: PrismaClient,
  ownerId: string,
): Promise<PurgeAccountResult> {
  assertOwnerId(ownerId);
  return base.$transaction(async (tx) => {
    // Transaction-local (is_local = true): reverted at COMMIT/ROLLBACK, never leaks to the pool.
    await tx.$queryRaw`SELECT set_config(${ALLOW_PURGE_SETTING}, 'on', true)`;

    const users = await tx.$queryRaw<{ email: string }[]>`
      SELECT email::text AS email FROM "User" WHERE id = ${ownerId}::uuid FOR UPDATE`;
    const user = users[0];
    if (!user) {
      return { purged: false, deletionId: null, rowsDeleted: 0, tables: {} };
    }

    const ownerTables = await listOwnerTables(tx);
    const tables = await countRows(tx, ownerTables, ownerId);

    const invites = await tx.$executeRaw`
      DELETE FROM "Invite" WHERE "usedByUserId" = ${ownerId}::uuid OR email = ${user.email}::citext`;
    const deletedUsers = await tx.$executeRaw`DELETE FROM "User" WHERE id = ${ownerId}::uuid`;

    // Catalog-driven verification: nothing may remain for this owner anywhere.
    const remaining = await countRows(tx, ownerTables, ownerId);
    const leftovers = Object.fromEntries(
      Object.entries(remaining).filter(([, count]) => count > 0),
    );
    const userRows = await tx.$queryRaw<{ n: number }[]>`
      SELECT (SELECT count(*) FROM "User" WHERE id = ${ownerId}::uuid)::int
           + (SELECT count(*) FROM "Invite" WHERE "usedByUserId" = ${ownerId}::uuid
                 OR email = ${user.email}::citext)::int AS n`;
    if (userRows[0]?.n) leftovers['User/Invite'] = userRows[0].n;
    if (deletedUsers !== 1) leftovers['User (deleted rows)'] = deletedUsers;
    if (Object.keys(leftovers).length > 0) throw new PurgeIncompleteError(leftovers);

    const rowsDeleted =
      Object.values(tables).reduce((sum, count) => sum + count, 0) + invites + deletedUsers;
    const record = await tx.accountDeletion.create({ data: { rowsDeleted } });

    // Belt and braces: the flag is already transaction-local; switch it off before COMMIT anyway.
    await tx.$queryRaw`SELECT set_config(${ALLOW_PURGE_SETTING}, 'off', true)`;
    return { purged: true, deletionId: record.id, rowsDeleted, tables };
  }, TX_OPTIONS);
}
