import type {
  ApplyImportInput,
  ApplyImportResult,
  CreateRevisionOptions,
  ImportRecordView,
  ImportStatus,
  LoadedProfile,
  ProfileStore,
  RevisionResult,
  RevisionSummary,
  RevisionWithSnapshot,
  SaveOptions,
  SaveResult,
} from '@chameleon/db';
import type { ImportReport, ProfileDocument } from '@chameleon/contracts';
import type { ImportPreview } from '@chameleon/profile-io';
import type { Request, Response } from 'express';
import { requireAuthContext } from '../../auth/context';
import { HttpError } from '../../http/errors';
import { translateStoreError } from './errors';

/**
 * Owner binding (Phase 1 gate, condition 2). `ProfileStore` methods take an `ownerId` first argument; if
 * a handler could pass it, one `req.params.ownerId` away from a cross-tenant read. Handlers of this
 * module therefore never see the raw store: they get an `OwnerProfileStore` built ONCE per request, by
 * `bindScope`, from the authenticated session (`req.auth`). The `ownerId` is closed over and not
 * reachable from the handler. The profile is always the owner's primary profile (no `profileId` is
 * accepted anywhere, so a client cannot aim at another profile id either).
 *
 * `test/profiles-owner-binding.test.ts` proves that no handler file mentions `ownerId`, `req.auth` or the
 * raw `profileStore`.
 */
export interface OwnerProfileStore {
  saveProfileDocument(
    document: unknown,
    options?: Omit<SaveOptions, 'profileId'>,
  ): Promise<SaveResult>;
  loadProfileDocument(): Promise<LoadedProfile | null>;
  createRevision(options?: Omit<CreateRevisionOptions, 'profileId'>): Promise<RevisionResult>;
  listRevisions(options?: {
    limit?: number;
    beforeRevisionNumber?: number;
  }): Promise<RevisionSummary[]>;
  getRevision(revisionId: string): Promise<RevisionWithSnapshot | null>;
  createImportRecord(report: ImportReport): Promise<ImportRecordView>;
  applyImport(input: Omit<ApplyImportInput, 'profileId'>): Promise<ApplyImportResult>;
  discardImport(importRecordId: string): Promise<ImportRecordView>;
  listImportRecords(options?: {
    limit?: number;
    status?: ImportStatus;
  }): Promise<ImportRecordView[]>;
  getImportIdMap(): Promise<Record<string, string>>;
}

/** Wraps a store call so store/contract errors surface as structured HTTP errors. */
function translated<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw translateStoreError(error);
    }
  };
}

/** Drops `profileId` at runtime too: the facade only ever addresses the owner's primary profile. */
function withoutProfileId<T extends object | undefined>(
  options: T,
): Omit<NonNullable<T>, 'profileId'> | undefined {
  if (options === undefined) return undefined;
  const { profileId: _ignored, ...rest } = options as { profileId?: unknown };
  return rest as Omit<NonNullable<T>, 'profileId'>;
}

export function bindProfileStore(store: ProfileStore, ownerId: string): OwnerProfileStore {
  return {
    saveProfileDocument: translated((document, options) =>
      store.saveProfileDocument(ownerId, document, withoutProfileId(options)),
    ),
    loadProfileDocument: translated(() => store.loadProfileDocument(ownerId)),
    createRevision: translated((options) =>
      store.createRevision(ownerId, withoutProfileId(options)),
    ),
    listRevisions: translated((options) => store.listRevisions(ownerId, withoutProfileId(options))),
    getRevision: translated((revisionId) => store.getRevision(ownerId, revisionId)),
    createImportRecord: translated((report) => store.createImportRecord(ownerId, { report })),
    applyImport: translated((input) =>
      store.applyImport(ownerId, withoutProfileId(input) as ApplyImportInput),
    ),
    discardImport: translated((importRecordId) => store.discardImport(ownerId, importRecordId)),
    listImportRecords: translated((options) =>
      store.listImportRecords(ownerId, withoutProfileId(options)),
    ),
    getImportIdMap: translated(() => store.getImportIdMap(ownerId)),
  };
}

// --- Serialization of writes per owner -------------------------------------------------------

/**
 * Profile edits are read-modify-write over the whole document (the store validates references on the
 * full document). Two concurrent edits of the same owner could overwrite each other with a stale copy,
 * so writes of one owner are chained in-process. Single API instance assumption (like the rate limiters);
 * a multi-instance deployment needs optimistic concurrency in the store.
 */
export class OwnerLocks {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(fn, fn);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

// --- Preview cache (import preview -> apply) -------------------------------------------------

export interface PreviewEntry {
  /** `ImportResult.document`: needs_review, UUIDs, ready for `applyImport`. */
  document: ProfileDocument;
  report: ImportReport;
  preview: ImportPreview;
  expiresAt: number;
}

export interface PreviewCacheOptions {
  ttlMs: number;
  maxPerOwner: number;
  maxTotal: number;
}

export const DEFAULT_PREVIEW_CACHE: PreviewCacheOptions = {
  ttlMs: 30 * 60 * 1000,
  maxPerOwner: 5,
  maxTotal: 100,
};

/**
 * `ImportRecord` does not persist the processed document, and `applyImport` needs it. The preview keeps it in
 * memory for a short time, keyed by (owner, importRecordId). Bounded per owner and in total; lost on restart
 * (apply then answers `409 IMPORT_PREVIEW_EXPIRED` and the user previews again). Holds personal data, so it
 * is never logged or serialized anywhere but the owner's own preview/apply responses.
 */
export class PreviewCache {
  private readonly entries = new Map<string, PreviewEntry>();

  constructor(
    private readonly options: PreviewCacheOptions,
    private readonly now: () => number = Date.now,
  ) {}

  private key(owner: string, id: string): string {
    return `${owner}:${id}`;
  }

  private sweep(): void {
    const t = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= t) this.entries.delete(key);
  }

  put(owner: string, id: string, entry: Omit<PreviewEntry, 'expiresAt'>): PreviewEntry {
    this.sweep();
    const prefix = `${owner}:`;
    const own = [...this.entries.keys()].filter((key) => key.startsWith(prefix));
    // Map iterates in insertion order: evict the oldest of this owner, then the oldest overall.
    while (own.length >= this.options.maxPerOwner) this.entries.delete(own.shift()!);
    while (this.entries.size >= this.options.maxTotal) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    const stored: PreviewEntry = { ...entry, expiresAt: this.now() + this.options.ttlMs };
    this.entries.set(this.key(owner, id), stored);
    return stored;
  }

  get(owner: string, id: string): PreviewEntry | undefined {
    this.sweep();
    return this.entries.get(this.key(owner, id));
  }

  delete(owner: string, id: string): void {
    this.entries.delete(this.key(owner, id));
  }

  get size(): number {
    return this.entries.size;
  }
}

// --- Per-owner quota for the expensive preview route ----------------------------------------

export interface QuotaOptions {
  windowMs: number;
  max: number;
}

export const DEFAULT_PREVIEW_QUOTA: QuotaOptions = { windowMs: 10 * 60 * 1000, max: 30 };

export class OwnerQuota {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly options: QuotaOptions,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one use; throws `429 RATE_LIMITED` (with `Retry-After`) past the limit. */
  consume(owner: string): void {
    const t = this.now();
    for (const [key, hit] of this.hits) if (hit.resetAt <= t) this.hits.delete(key);
    const current = this.hits.get(owner);
    if (!current) {
      this.hits.set(owner, { count: 1, resetAt: t + this.options.windowMs });
      return;
    }
    if (current.count >= this.options.max) {
      throw new HttpError(429, 'RATE_LIMITED', 'Muitas previas de importacao. Tente mais tarde.', {
        headers: { 'Retry-After': String(Math.max(1, Math.ceil((current.resetAt - t) / 1000))) },
      });
    }
    current.count += 1;
  }
}

// --- The per-request scope --------------------------------------------------------------------

export interface OwnerPreviewCache {
  put(id: string, entry: Omit<PreviewEntry, 'expiresAt'>): PreviewEntry;
  get(id: string): PreviewEntry | undefined;
  delete(id: string): void;
}

export type AuditMetadata = Record<string, string | number | boolean | null>;

/** Everything a profile handler may touch. Built by `bindScope`; carries the owner implicitly. */
export interface ProfileScope {
  readonly store: OwnerProfileStore;
  readonly previews: OwnerPreviewCache;
  /** Serializes read-modify-write sequences of THIS owner. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** Counts one import preview against the owner's quota (`429` past the limit). */
  consumePreviewQuota(): void;
  /** Audit trail without PII (ADR-0014): action, entity type/id and counters only. */
  audit(
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: AuditMetadata,
  ): Promise<void>;
}

export interface ScopeDeps {
  store: ProfileStore;
  locks: OwnerLocks;
  cache: PreviewCache;
  previewQuota: OwnerQuota;
}

const SCOPE_KEY = 'profileScope';

export function buildScope(req: Request, deps: ScopeDeps): ProfileScope {
  const auth = requireAuthContext(req);
  const owner = auth.ownerId;
  return {
    store: bindProfileStore(deps.store, owner),
    previews: {
      put: (id, entry) => deps.cache.put(owner, id, entry),
      get: (id) => deps.cache.get(owner, id),
      delete: (id) => deps.cache.delete(owner, id),
    },
    exclusive: (fn) => deps.locks.run(owner, fn),
    consumePreviewQuota: () => deps.previewQuota.consume(owner),
    async audit(action, entityType, entityId, metadata = {}) {
      await auth.db.auditEvent.create({
        data: {
          ownerId: owner,
          action,
          entityType,
          entityId,
          correlationId: req.correlationId,
          metadata,
        },
      });
    },
  };
}

export function attachScope(res: Response, scope: ProfileScope): void {
  (res.locals as Record<string, unknown>)[SCOPE_KEY] = scope;
}

/** The scope of this request. Fails closed (500) if the route was not declared through the gated group. */
export function scopeOf(res: Response): ProfileScope {
  const scope = (res.locals as Record<string, unknown>)[SCOPE_KEY] as ProfileScope | undefined;
  if (!scope) throw new Error('profile scope missing: route not declared through profileRoutes');
  return scope;
}
