import type { ProfileDocument } from '@chameleon/contracts';
import type { Db } from '../client';
import { assertOwnerId } from '../for-owner';
import type { LoadedProfile } from '../profile-store';

/**
 * Account export (ADR-0014, "Exportar tudo"): everything the owner is entitled to take with them, as
 * plain JSON-serializable data (dates are ISO strings). The shape is an allow-list: every query selects
 * explicit columns, so a column added to a table later is NOT exported by accident, and secrets
 * (password hash, session/invite token hashes) can never appear. `ACCOUNT_EXPORT_REGISTRY` documents
 * which table feeds which section (a test enforces that every table is classified).
 *
 * Reads go through `db.forOwner(ownerId)` (plus the owner's accepted invitation through `db.global`),
 * never through `unsafeRaw`. Sections are read one after the other, not in one snapshot: a write that
 * races with the export may appear in some sections and not in others (acceptable for a data-subject
 * export; the profile document and revisions are individually consistent).
 */

export const ACCOUNT_EXPORT_FORMAT = 'chameleon.account-export' as const;
export const ACCOUNT_EXPORT_VERSION = 1 as const;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface ExportedAccount {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ExportedProfile {
  profileId: string;
  isPrimary: boolean;
  storedSchemaVersion: string;
  createdAt: string;
  updatedAt: string;
  /** Canonical ProfileDocument (current contract version), as the editor and `GET /profile` see it. */
  document: ProfileDocument;
}

export interface ExportedRevision {
  id: string;
  profileId: string;
  revisionNumber: number;
  schemaVersion: string;
  contentHash: string;
  reason: string;
  createdAt: string;
  /** Immutable snapshot, in the contract version named by `schemaVersion`. */
  snapshot: Json;
}

export interface ExportedImportRecord {
  id: string;
  profileId: string;
  sourceFormat: string;
  sourceSchemaVersion: string | null;
  targetSchemaVersion: string;
  mode: string;
  status: string;
  steps: Json;
  warnings: Json;
  errors: Json;
  idMap: Json;
  unmapped: Json;
  summary: Json;
  revisionId: string | null;
  createdAt: string;
  appliedAt: string | null;
}

export interface ExportedConsent {
  id: string;
  purpose: string;
  granted: boolean;
  policyVersion: string;
  recordedAt: string;
}

export interface ExportedAuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  at: string;
  correlationId: string | null;
  metadata: Json;
}

export interface ExportedSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
}

export interface ExportedCredential {
  id: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportedInvitation {
  id: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface ExportedJob {
  id: string;
  title: string | null;
  company: string | null;
  url: string | null;
  location: string | null;
  workMode: string | null;
  postedOn: string | null;
  status: string;
  description: string;
  descriptionHash: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountExport {
  format: typeof ACCOUNT_EXPORT_FORMAT;
  version: typeof ACCOUNT_EXPORT_VERSION;
  generatedAt: string;
  account: ExportedAccount;
  profiles: ExportedProfile[];
  revisions: ExportedRevision[];
  imports: ExportedImportRecord[];
  jobs: ExportedJob[];
  consents: ExportedConsent[];
  auditEvents: ExportedAuditEvent[];
  sessions: ExportedSession[];
  credentials: ExportedCredential[];
  invitations: ExportedInvitation[];
}

export interface ExportAccountDeps {
  /** The profile store composed by the caller (it needs the snapshot builder injected by apps/api). */
  store: {
    loadProfileDocument(ownerId: string, profileId?: string): Promise<LoadedProfile | null>;
  };
  now?: () => Date;
}

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);
const json = (value: unknown): Json => value as Json;

/** Thrown when the account does not exist (nothing to export). */
export class AccountNotFoundError extends Error {
  override readonly name = 'AccountNotFoundError';
  constructor() {
    super('Account not found.');
  }
}

export async function exportAccountData(
  db: Db,
  ownerId: string,
  deps: ExportAccountDeps,
): Promise<AccountExport> {
  assertOwnerId(ownerId);
  const scoped = db.forOwner(ownerId);

  const user = await scoped.user.findUnique({
    where: { id: ownerId },
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  });
  if (!user) throw new AccountNotFoundError();

  const profileRows = await scoped.professionalProfile.findMany({
    select: { id: true, isPrimary: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const profiles: ExportedProfile[] = [];
  for (const row of profileRows) {
    const loaded = await deps.store.loadProfileDocument(ownerId, row.id);
    if (!loaded) continue; // deleted between the two reads
    profiles.push({
      profileId: loaded.profileId,
      isPrimary: row.isPrimary,
      storedSchemaVersion: loaded.storedSchemaVersion,
      createdAt: iso(loaded.createdAt),
      updatedAt: iso(loaded.updatedAt),
      document: loaded.document,
    });
  }

  const revisions = await scoped.profileRevision.findMany({
    select: {
      id: true,
      profileId: true,
      revisionNumber: true,
      schemaVersion: true,
      contentHash: true,
      reason: true,
      createdAt: true,
      snapshot: true,
    },
    orderBy: [{ profileId: 'asc' }, { revisionNumber: 'asc' }],
  });
  const imports = await scoped.importRecord.findMany({
    select: {
      id: true,
      profileId: true,
      sourceFormat: true,
      sourceSchemaVersion: true,
      targetSchemaVersion: true,
      mode: true,
      status: true,
      steps: true,
      warnings: true,
      errors: true,
      idMap: true,
      unmapped: true,
      summary: true,
      revisionId: true,
      createdAt: true,
      appliedAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const jobs = await scoped.jobPosting.findMany({
    select: {
      id: true,
      title: true,
      company: true,
      url: true,
      location: true,
      workMode: true,
      postedOn: true,
      status: true,
      description: true,
      descriptionHash: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const consents = await scoped.consentRecord.findMany({
    select: { id: true, purpose: true, granted: true, policyVersion: true, recordedAt: true },
    orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
  });
  const auditEvents = await scoped.auditEvent.findMany({
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      at: true,
      correlationId: true,
      metadata: true,
    },
    orderBy: [{ at: 'asc' }, { id: 'asc' }],
  });
  const sessions = await scoped.session.findMany({
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      absoluteExpiresAt: true,
      revokedAt: true,
      userAgent: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const credentials = await scoped.credential.findMany({
    select: { id: true, kind: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  // Invite is a global table: only the invitation THIS account accepted, without token hash or e-mail.
  const invitations = await db.global.invite.findMany({
    where: { usedByUserId: ownerId },
    select: { id: true, createdAt: true, expiresAt: true, usedAt: true },
    orderBy: { createdAt: 'asc' },
  });

  return {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    generatedAt: iso((deps.now ?? (() => new Date()))()),
    account: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: iso(user.createdAt),
      updatedAt: iso(user.updatedAt),
      deletedAt: isoOrNull(user.deletedAt),
    },
    profiles,
    revisions: revisions.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      revisionNumber: row.revisionNumber,
      schemaVersion: row.schemaVersion,
      contentHash: row.contentHash,
      reason: row.reason,
      createdAt: iso(row.createdAt),
      snapshot: json(row.snapshot),
    })),
    imports: imports.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      sourceFormat: row.sourceFormat,
      sourceSchemaVersion: row.sourceSchemaVersion,
      targetSchemaVersion: row.targetSchemaVersion,
      mode: row.mode,
      status: row.status,
      steps: json(row.steps),
      warnings: json(row.warnings),
      errors: json(row.errors),
      idMap: json(row.idMap),
      unmapped: json(row.unmapped),
      summary: json(row.summary),
      revisionId: row.revisionId,
      createdAt: iso(row.createdAt),
      appliedAt: isoOrNull(row.appliedAt),
    })),
    jobs: jobs.map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company,
      url: row.url,
      location: row.location,
      workMode: row.workMode,
      postedOn: row.postedOn === null ? null : row.postedOn.toISOString().slice(0, 10),
      status: row.status,
      description: row.description,
      descriptionHash: row.descriptionHash,
      notes: row.notes,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    consents: consents.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      granted: row.granted,
      policyVersion: row.policyVersion,
      recordedAt: iso(row.recordedAt),
    })),
    auditEvents: auditEvents.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      at: iso(row.at),
      correlationId: row.correlationId,
      metadata: json(row.metadata),
    })),
    sessions: sessions.map((row) => ({
      id: row.id,
      createdAt: iso(row.createdAt),
      lastSeenAt: iso(row.lastSeenAt),
      expiresAt: iso(row.expiresAt),
      absoluteExpiresAt: iso(row.absoluteExpiresAt),
      revokedAt: isoOrNull(row.revokedAt),
      userAgent: row.userAgent,
    })),
    credentials: credentials.map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    invitations: invitations.map((row) => ({
      id: row.id,
      createdAt: iso(row.createdAt),
      expiresAt: iso(row.expiresAt),
      usedAt: isoOrNull(row.usedAt),
    })),
  };
}
