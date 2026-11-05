import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  GOVERNED_RECORD_KINDS,
  MAX_CONFIRM_BATCH,
  PROFILE_RECORD_SCHEMAS,
  PROFILE_SECTIONS,
  RECORD_KIND_VALUES,
  RECORD_PARENT_KIND,
  TOP_LEVEL_COLLECTIONS,
  apiErrorBodySchema,
  applyImportRequestSchema,
  confirmRecordsRequestSchema,
  createRecordRequestSchema,
  exportQuerySchema,
  importPreviewRequestSchema,
  isBlockSection,
  isGovernedKind,
  listImportsQuerySchema,
  listRevisionsQuerySchema,
  patchPendingRequestSchema,
  patchRecordMetaRequestSchema,
  pendingListQuerySchema,
  profileSchema,
  profileSectionValueSchema,
  profileStateResponseSchema,
  replaceRecordRequestSchema,
  saveProfileRequestSchema,
  saveSectionRequestSchema,
} from '../src/index';

const UUID = '01a1a95f-1762-72ad-9847-9f48cefa22d4';

describe('profile DTOs (contracts/api/profile)', () => {
  it('sections are exactly the keys of profile: blocks + collections, no drift', () => {
    expect([...PROFILE_SECTIONS].sort()).toEqual(Object.keys(profileSchema.shape).sort());
    expect(
      TOP_LEVEL_COLLECTIONS.every((c) => (PROFILE_SECTIONS as readonly string[]).includes(c.key)),
    ).toBe(true);
    expect(isBlockSection('identity')).toBe(true);
    expect(isBlockSection('experiences')).toBe(false);
    for (const section of PROFILE_SECTIONS) {
      // every section has a value schema, and `null` (not provided) is always valid
      expect(profileSectionValueSchema(section).safeParse(null).success, section).toBe(true);
    }
    expect(profileSectionValueSchema('identity').safeParse({ full_name: ' ' }).success).toBe(false);
    expect(profileSectionValueSchema('skills').safeParse([{ name: 'SQL' }]).success).toBe(true);
    expect(profileSectionValueSchema('skills').safeParse([{ name: 'SQL', extra: 1 }]).success).toBe(
      false,
    );
  });

  it('every record kind has a schema, nested kinds name their parent, governed kinds are the facts', () => {
    expect(Object.keys(PROFILE_RECORD_SCHEMAS).sort()).toEqual([...RECORD_KIND_VALUES].sort());
    expect(RECORD_PARENT_KIND).toEqual({
      experience_item: 'experience',
      project_item: 'project',
      collaborator: 'project',
    });
    expect(isGovernedKind('skill')).toBe(true);
    expect(isGovernedKind('evidence')).toBe(false);
    expect(isGovernedKind('contact_point')).toBe(false);
    expect(GOVERNED_RECORD_KINDS).toHaveLength(15);
  });

  it('error codes added for the profile module are valid in the structured error body', () => {
    for (const code of [
      'CONSENT_REQUIRED_FOR_PROFILE',
      'IMPORT_INVALID',
      'IMPORT_PREVIEW_EXPIRED',
      'IMPORT_NOT_APPLICABLE',
      'ID_CONFLICT',
      'DUPLICATE_SKILL',
      'CONCURRENT_MODIFICATION',
      'RECORD_IN_USE',
    ] as const) {
      expect(API_ERROR_CODES).toContain(code);
      expect(
        apiErrorBodySchema.safeParse({ error: { code, message: 'm', requestId: 'r' } }).success,
      ).toBe(true);
    }
  });

  it('save document / section requests default to onMissing keep and refuse unknown keys', () => {
    const doc = { schema_version: '2.1.0', profile: {} };
    expect(saveProfileRequestSchema.parse({ document: doc })).toMatchObject({
      onMissing: 'keep',
      createRevision: false,
    });
    expect(saveProfileRequestSchema.safeParse({ document: doc, onMissing: 'wipe' }).success).toBe(
      false,
    );
    expect(saveProfileRequestSchema.safeParse({ document: doc, ownerId: UUID }).success).toBe(
      false,
    );
    expect(
      saveProfileRequestSchema.safeParse({ document: { schema_version: '1.0.0' } }).success,
    ).toBe(false);
    expect(saveSectionRequestSchema.parse({ value: [] })).toMatchObject({ onMissing: 'keep' });
    expect(saveSectionRequestSchema.safeParse({ value: [], extra: 1 }).success).toBe(false);
  });

  it('create record: the server owns the id; nested kinds need a parent, the others forbid it', () => {
    const ok = createRecordRequestSchema.safeParse({ kind: 'skill', record: { name: 'SQL' } });
    expect(ok.success).toBe(true);
    expect(
      createRecordRequestSchema.safeParse({ kind: 'skill', record: { id: UUID, name: 'SQL' } })
        .success,
    ).toBe(false);
    expect(
      createRecordRequestSchema.safeParse({
        kind: 'skill',
        parentId: UUID,
        record: { name: 'SQL' },
      }).success,
    ).toBe(false);
    for (const kind of ['experience_item', 'project_item', 'collaborator']) {
      expect(createRecordRequestSchema.safeParse({ kind, record: {} }).success, kind).toBe(false);
      expect(
        createRecordRequestSchema.safeParse({ kind, parentId: UUID, record: {} }).success,
        kind,
      ).toBe(true);
    }
    expect(createRecordRequestSchema.safeParse({ kind: 'nope', record: {} }).success).toBe(false);
    expect(
      createRecordRequestSchema.safeParse({ kind: 'skill', parentId: 'x', record: {} }).success,
    ).toBe(false);
    expect(replaceRecordRequestSchema.safeParse({ record: { name: 'x' } }).success).toBe(true);
    expect(replaceRecordRequestSchema.safeParse({ record: {}, kind: 'skill' }).success).toBe(false);
  });

  it('meta patch: at least one known governance field; field_states values are states or null', () => {
    expect(patchRecordMetaRequestSchema.safeParse({}).success).toBe(false);
    expect(patchRecordMetaRequestSchema.safeParse({ status: 'confirmed' }).success).toBe(true);
    expect(patchRecordMetaRequestSchema.safeParse({ status: 'maybe' }).success).toBe(false);
    expect(
      patchRecordMetaRequestSchema.safeParse({ resume_use: 'never', visibility: 'private' })
        .success,
    ).toBe(true);
    expect(
      patchRecordMetaRequestSchema.safeParse({
        field_states: { end_date: 'declined', exit_reason: null },
      }).success,
    ).toBe(true);
    expect(
      patchRecordMetaRequestSchema.safeParse({ field_states: { end_date: 'whatever' } }).success,
    ).toBe(false);
    expect(
      patchRecordMetaRequestSchema.safeParse({ field_states: { 'Bad Key': 'declined' } }).success,
    ).toBe(false);
    expect(patchRecordMetaRequestSchema.safeParse({ source: 'form_entry' }).success).toBe(false);
  });

  it('batch confirmation takes an explicit, bounded, duplicate-free list of UUIDs', () => {
    expect(confirmRecordsRequestSchema.safeParse({ recordIds: [UUID] }).success).toBe(true);
    expect(confirmRecordsRequestSchema.safeParse({ recordIds: [] }).success).toBe(false);
    expect(
      confirmRecordsRequestSchema.safeParse({ recordIds: [UUID, UUID.toUpperCase()] }).success,
    ).toBe(false);
    expect(confirmRecordsRequestSchema.safeParse({ recordIds: ['EXP-001'] }).success).toBe(false);
    expect(confirmRecordsRequestSchema.safeParse({ all: true }).success).toBe(false);
    const many = Array.from(
      { length: MAX_CONFIRM_BATCH + 1 },
      (_, i) => `01a1a95f-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(confirmRecordsRequestSchema.safeParse({ recordIds: many }).success).toBe(false);
    expect(
      confirmRecordsRequestSchema.safeParse({ recordIds: many.slice(0, MAX_CONFIRM_BATCH) })
        .success,
    ).toBe(true);
  });

  it('import requests: paste envelope defaults, apply needs an explicit mode, replace needs confirmation', () => {
    expect(importPreviewRequestSchema.parse({ text: 'a: 1' })).toEqual({
      format: 'auto',
      text: 'a: 1',
      mode: 'strict',
    });
    expect(importPreviewRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(importPreviewRequestSchema.safeParse({ text: 'a', format: 'xml' }).success).toBe(false);
    expect(importPreviewRequestSchema.safeParse({ text: 'a', ownerId: UUID }).success).toBe(false);

    expect(applyImportRequestSchema.safeParse({}).success).toBe(false);
    expect(applyImportRequestSchema.parse({ mode: 'merge' })).toEqual({
      mode: 'merge',
      confirmReplace: false,
      regenerateConflictingIds: false,
    });
    expect(applyImportRequestSchema.safeParse({ mode: 'replace' }).success).toBe(false);
    expect(
      applyImportRequestSchema.safeParse({ mode: 'replace', confirmReplace: true }).success,
    ).toBe(true);
    expect(applyImportRequestSchema.safeParse({ mode: 'wipe', confirmReplace: true }).success).toBe(
      false,
    );
  });

  it('query schemas coerce, default and refuse unknown parameters', () => {
    expect(exportQuerySchema.parse({})).toEqual({ format: 'yaml' });
    expect(exportQuerySchema.safeParse({ format: 'xml' }).success).toBe(false);
    expect(exportQuerySchema.safeParse({ format: 'json', ownerId: UUID }).success).toBe(false);
    expect(listRevisionsQuerySchema.parse({ limit: '10', before: '4' })).toEqual({
      limit: 10,
      before: 4,
    });
    expect(listRevisionsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(listRevisionsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listRevisionsQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(listImportsQuerySchema.parse({ status: 'applied' })).toMatchObject({
      status: 'applied',
    });
    expect(listImportsQuerySchema.safeParse({ status: 'zzz' }).success).toBe(false);
    expect(pendingListQuerySchema.parse({})).toEqual({ status: 'open' });
    expect(pendingListQuerySchema.safeParse({ status: 'all' }).success).toBe(true);
    expect(patchPendingRequestSchema.safeParse({ status: 'resolved' }).success).toBe(true);
    expect(patchPendingRequestSchema.safeParse({ status: 'resolved', subject: 'x' }).success).toBe(
      false,
    );
  });

  it('no request DTO accepts an owner identifier (the owner always comes from the session)', () => {
    const doc = { schema_version: '2.1.0', profile: {} };
    const attempts = [
      saveProfileRequestSchema.safeParse({ document: doc, ownerId: UUID }),
      saveSectionRequestSchema.safeParse({ value: [], ownerId: UUID }),
      createRecordRequestSchema.safeParse({ kind: 'skill', record: { name: 'a' }, ownerId: UUID }),
      replaceRecordRequestSchema.safeParse({ record: {}, ownerId: UUID }),
      patchRecordMetaRequestSchema.safeParse({ status: 'confirmed', ownerId: UUID }),
      confirmRecordsRequestSchema.safeParse({ recordIds: [UUID], ownerId: UUID }),
      importPreviewRequestSchema.safeParse({ text: 'a', ownerId: UUID }),
      applyImportRequestSchema.safeParse({ mode: 'merge', ownerId: UUID }),
      applyImportRequestSchema.safeParse({ mode: 'merge', profileId: UUID }),
    ];
    for (const attempt of attempts) expect(attempt.success).toBe(false);
  });

  it('the state response accepts the empty state', () => {
    const empty = {
      exists: false,
      profile: null,
      document: null,
      summary: {
        recordCount: 0,
        byStatus: { confirmed: 0, needs_review: 0, conflicting: 0, archived: 0 },
        pending: { open: 0, resolved: 0, dismissed: 0 },
        evidenceCount: 0,
        byKind: {},
      },
    };
    expect(profileStateResponseSchema.safeParse(empty).success).toBe(true);
    expect(profileStateResponseSchema.safeParse({ ...empty, ownerId: UUID }).success).toBe(false);
  });
});
