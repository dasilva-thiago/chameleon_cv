-- CreateTable
CREATE TABLE "AccountDeletion" (
    "id" UUID NOT NULL,
    "deletedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowsDeleted" INTEGER NOT NULL,

    CONSTRAINT "AccountDeletion_pkey" PRIMARY KEY ("id")
);

-- Minimal, non-identifying deletion record (ADR-0014): no ownerId, no FK, no email, no per-table counts.
-- Deliberately has no "ownerId" column, so the owner_immutable installer and the purge sweep skip it.
ALTER TABLE "AccountDeletion" ADD CONSTRAINT "AccountDeletion_rowsDeleted_chk"
  CHECK ("rowsDeleted" >= 0);

-- Append-only: the record of a deletion is never edited or removed (rows carry no personal data).
CREATE FUNCTION chameleon_account_deletion_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AccountDeletion_append_only: "AccountDeletion" e append-only (% negado)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'AccountDeletion_append_only';
END;
$$;

CREATE TRIGGER "AccountDeletion_append_only"
  BEFORE UPDATE OR DELETE ON "AccountDeletion"
  FOR EACH ROW EXECUTE FUNCTION chameleon_account_deletion_append_only();
