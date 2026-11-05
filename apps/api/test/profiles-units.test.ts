import {
  importPreviewSchema,
  type ImportPreviewDto,
  type ProfileDocument,
} from '@chameleon/contracts';
import type { ImportPreview } from '@chameleon/profile-io';
import { describe, expect, it } from 'vitest';
import {
  addEvidenceLink,
  emptyDocument,
  enforceArchivedNever,
  evidenceLinks,
  insertRecord,
  locateRecord,
  patchMeta,
  removeEvidenceLink,
  removeRecord,
  replaceRecord,
  summarize,
  unknownIds,
} from '../src/modules/profiles/doc';
import { issueDetails, uuidParam } from '../src/modules/profiles/errors';
import { isLargeBodyRoute } from '../src/modules/profiles/import-input';
import { importErrorViews } from '../src/modules/profiles/views';
import { HttpError } from '../src/http/errors';

const E1 = '01a1a95f-0000-7000-8000-000000000001';
const S1 = '01a1a95f-0000-7000-8000-000000000002';
const U1 = '01a1a95f-0000-7000-8000-000000000003';
const EV1 = '01a1a95f-0000-7000-8000-000000000004';
const I1 = '01a1a95f-0000-7000-8000-000000000005';
const NEW = '01a1a95f-0000-7000-8000-0000000000ff';

function sample(): ProfileDocument {
  return {
    schema_version: '2.1.0',
    profile: {
      experiences: [
        {
          id: E1,
          organization_name: 'Hospital',
          items: [{ id: I1, kind: 'responsibility', text: 'Cuidar de pacientes.' }],
        },
      ],
      skills: [{ id: S1, name: 'Triagem' }],
      skill_usages: [
        { id: U1, skill_id: S1, usage_context: 'professional_experience', experience_id: E1 },
      ],
      evidence: [{ id: EV1, type: 'document', title: 'Certificado', supports: [E1] }],
    },
  } as unknown as ProfileDocument;
}

describe('document operations (pure)', () => {
  it('locates records at any depth with parent and section; unknown ids are null', () => {
    const doc = sample();
    expect(locateRecord(doc, I1)).toMatchObject({
      kind: 'experience_item',
      parentId: E1,
      section: 'experiences',
    });
    expect(locateRecord(doc, E1.toUpperCase())?.kind).toBe('experience');
    expect(locateRecord(doc, 'nope')).toBeNull();
  });

  it('insert appends to the right collection (and creates it), never mutating the input', () => {
    const doc = sample();
    const before = JSON.stringify(doc);
    const withContact = insertRecord(doc, 'contact_point', undefined, {
      id: NEW,
      kind: 'email',
      value: 'a@example.test',
    });
    expect(withContact?.profile.contact_points).toHaveLength(1);
    expect(JSON.stringify(doc)).toBe(before);
    const item = insertRecord(doc, 'experience_item', E1, { id: NEW, kind: 'delivery', text: 'x' });
    expect(locateRecord(item!, NEW)?.parentId).toBe(E1);
    expect(insertRecord(doc, 'experience_item', S1, { id: NEW })).toBeNull(); // parent of the wrong kind
    expect(insertRecord(doc, 'experience_item', undefined, { id: NEW })).toBeNull();
    const restriction = insertRecord(emptyDocument(), 'restriction', undefined, {
      id: NEW,
      rule: 'never_include',
      target: { term: 'x' },
    });
    expect(restriction?.profile.usage_rules?.restrictions).toHaveLength(1);
  });

  it('replace keeps children the new value does not mention and merges the ones it does', () => {
    const doc = sample();
    const located = locateRecord(doc, E1);
    if (!located) throw new Error('missing');
    const bare = replaceRecord(doc, located, { organization_name: 'Outro' });
    expect(bare.profile.experiences?.[0]).toMatchObject({ id: E1, organization_name: 'Outro' });
    expect(bare.profile.experiences?.[0]?.items?.map((i) => i.id)).toEqual([I1]);
    const merged = replaceRecord(doc, located, {
      items: [{ kind: 'delivery', text: 'novo' }],
    });
    expect(merged.profile.experiences?.[0]?.items).toHaveLength(2);
  });

  it('unknownIds reports ids the stored profile does not have, except the ones the server generated', () => {
    const stored = sample();
    const next = insertRecord(stored, 'skill', undefined, {
      id: NEW,
      name: 'Nova',
    })!;
    expect(unknownIds(next, stored)).toEqual([NEW]);
    expect(unknownIds(next, stored, new Set([NEW]))).toEqual([]);
    expect(unknownIds(stored, stored)).toEqual([]);
  });

  it('remove cleans list references, blocks on single references, and drops emptied lists', () => {
    const doc = sample();
    const blocked = removeRecord(doc, locateRecord(doc, E1) as never);
    expect(blocked.blockers.map((b) => b.refererKind).sort()).toEqual(['skill_usage']);
    expect(blocked.blockers[0]).toMatchObject({ refererId: U1, field: 'experience_id' });

    const noUsage = removeRecord(doc, locateRecord(doc, U1) as never).document;
    expect(noUsage.profile.skill_usages).toBeUndefined();
    const removed = removeRecord(noUsage, locateRecord(noUsage, E1) as never);
    expect(removed.blockers).toEqual([]);
    expect(removed.document.profile.experiences).toBeUndefined();
    expect(removed.document.profile.evidence?.[0]?.supports).toEqual([]); // list reference cleaned
    expect(locateRecord(removed.document, I1)).toBeNull(); // child went with the parent
  });

  it('patchMeta: facts only; archived forces never; field_states merge with null removal', () => {
    const doc = sample();
    const fact = locateRecord(doc, S1) as never;
    const done = patchMeta(doc, fact, { status: 'confirmed', visibility: 'public' });
    expect(done.ok && locateRecord(done.document, S1)?.value.meta).toEqual({
      status: 'confirmed',
      visibility: 'public',
    });
    const archived = patchMeta(doc, fact, { status: 'archived' });
    expect(archived.ok && locateRecord(archived.document, S1)?.value.meta).toMatchObject({
      status: 'archived',
      resume_use: 'never',
    });
    expect(patchMeta(doc, fact, { status: 'archived', resume_use: 'allowed' }).ok).toBe(false);
    const states = patchMeta(doc, fact, { field_states: { last_used: 'declined' } });
    expect(states.ok && locateRecord(states.document, S1)?.value.meta).toMatchObject({
      field_states: { last_used: 'declined' },
    });
    expect(patchMeta(doc, locateRecord(doc, EV1) as never, { status: 'confirmed' }).ok).toBe(false);
    // the input document was not touched
    expect(locateRecord(doc, S1)?.value.meta).toBeUndefined();
  });

  it('evidence links are one relation seen from both sides', () => {
    const doc = sample();
    expect(evidenceLinks(doc, EV1)).toEqual([{ recordId: E1, kind: 'experience' }]);
    const withFactSide = JSON.parse(JSON.stringify(doc)) as ProfileDocument;
    (withFactSide.profile.skills?.[0] as { meta?: unknown }).meta = { evidence_ids: [EV1] };
    expect(
      evidenceLinks(withFactSide, EV1)
        .map((l) => l.recordId)
        .sort(),
    ).toEqual([E1, S1].sort());
    const linked = addEvidenceLink(
      doc,
      locateRecord(doc, EV1) as never,
      locateRecord(doc, S1) as never,
    );
    expect(evidenceLinks(linked, EV1)).toHaveLength(2);
    const cleaned = removeEvidenceLink(withFactSide, EV1, S1);
    expect(evidenceLinks(cleaned, EV1).map((l) => l.recordId)).toEqual([E1]);
    expect(locateRecord(cleaned, S1)?.value.meta).toEqual({ evidence_ids: [] });
  });

  it('enforceArchivedNever fills missing and reports contradictions', () => {
    const doc = sample();
    (doc.profile.skills?.[0] as { meta?: unknown }).meta = { status: 'archived' };
    expect(locateRecord(enforceArchivedNever(doc).document, S1)?.value.meta).toMatchObject({
      resume_use: 'never',
    });
    (doc.profile.skills?.[0] as { meta?: unknown }).meta = {
      status: 'archived',
      resume_use: 'allowed',
    };
    expect(enforceArchivedNever(doc).violations).toEqual([S1]);
  });

  it('summarize counts records, statuses, pending and evidence; a fact without meta is needs_review', () => {
    const doc = sample();
    (doc.profile as { pending_items?: unknown }).pending_items = [
      { id: '01a1a95f-0000-7000-8000-0000000000a1', subject: 'x', status: 'open' },
      { id: '01a1a95f-0000-7000-8000-0000000000a2', subject: 'y', status: 'resolved' },
    ];
    const summary = summarize(doc);
    expect(summary.recordCount).toBe(7);
    expect(summary.byStatus).toEqual({
      confirmed: 0,
      needs_review: 4,
      conflicting: 0,
      archived: 0,
    });
    expect(summary.pending).toEqual({ open: 1, resolved: 1, dismissed: 0 });
    expect(summary.evidenceCount).toBe(1);
    expect(summarize(null).recordCount).toBe(0);
  });
});

describe('error and view helpers never echo input', () => {
  it('uuidParam answers the standard 404 for anything that is not a UUID', () => {
    for (const bad of ['', 'abc', undefined, 42, ['x'], 'g'.repeat(36), `${E1}/../x`]) {
      expect(() => uuidParam(bad)).toThrow(HttpError);
      try {
        uuidParam(bad);
      } catch (error) {
        expect(error).toMatchObject({
          status: 404,
          code: 'NOT_FOUND',
          message: 'Recurso nao encontrado.',
        });
      }
    }
    expect(uuidParam(E1.toUpperCase())).toBe(E1);
  });

  it('issueDetails replaces unknown-key messages and truncates', () => {
    const details = issueDetails([
      {
        path: 'profile',
        code: 'unrecognized_keys',
        message: 'Unrecognized key: "CANARY-1"',
        keys: ['CANARY-1'],
      },
      { path: 'a.b', code: 'custom', message: 'm'.repeat(1000) },
    ]);
    expect(JSON.stringify(details)).not.toContain('CANARY');
    expect(details[1]?.message).toHaveLength(300);
    expect(
      issueDetails(Array.from({ length: 50 }, () => ({ path: 'x', code: 'c', message: 'm' }))),
    ).toHaveLength(20);
  });

  it('import error views use a fixed text per parse code (JSON/YAML library messages quote the input)', () => {
    const views = importErrorViews([
      {
        path: '',
        code: 'SYNTAX',
        message: 'JSON invalido: Unexpected token \'C\', "CANARY-123" is not valid JSON',
      },
      { path: '', code: 'FORBIDDEN_KEY', message: 'Chave proibida "CANARY-key" em (raiz).' },
      {
        path: '',
        code: 'TAG_NOT_ALLOWED',
        message: 'Tags YAML explicitas (!CANARY) nao sao permitidas.',
      },
      { path: 'profile', code: 'unrecognized_keys', message: 'Unrecognized key: "CANARY-zz"' },
    ]);
    expect(JSON.stringify(views)).not.toContain('CANARY');
    expect(views.map((v) => v.code)).toEqual([
      'SYNTAX',
      'FORBIDDEN_KEY',
      'TAG_NOT_ALLOWED',
      'unrecognized_keys',
    ]);
  });
});

describe('large-body routes', () => {
  it('only the import preview and the document/section saves skip the global JSON parser (slash/case-insensitive)', () => {
    expect(isLargeBodyRoute('POST', '/profile/imports/preview')).toBe(true);
    expect(isLargeBodyRoute('post', '/Profile/Imports/Preview/')).toBe(true);
    expect(isLargeBodyRoute('PUT', '/profile')).toBe(true);
    expect(isLargeBodyRoute('PUT', '/profile/sections/experiences')).toBe(true);
    expect(isLargeBodyRoute('GET', '/profile/imports/preview')).toBe(false);
    expect(isLargeBodyRoute('POST', '/profile/imports/preview/extra')).toBe(false);
    expect(isLargeBodyRoute('POST', '/profile/confirmations')).toBe(false);
    expect(isLargeBodyRoute('POST', '/profile/records')).toBe(false);
    expect(isLargeBodyRoute('PUT', '/profile/records/00000000-0000-4000-8000-000000000000')).toBe(
      false,
    );
    expect(isLargeBodyRoute('PUT', '/profile/sections/a/b')).toBe(false);
    expect(isLargeBodyRoute('PUT', '/auth/login')).toBe(false);
    expect(isLargeBodyRoute('PATCH', '/profile')).toBe(false);
  });
});

describe('DTO mirror of the profile-io ImportPreview', () => {
  it('the contracts schema type is mutually assignable with the profile-io type', () => {
    const fromIo = (value: ImportPreview): ImportPreviewDto => value;
    const toIo = (value: ImportPreviewDto): ImportPreview => value;
    const sample: ImportPreview = {
      source_schema_version: '2.1.0',
      target_schema_version: '2.1.0',
      totals: { records: 1, create: 1, update: 0, unchanged: 0, discarded: 0, needs_review: 1 },
      collections: { skills: { incoming: 1, create: 1, update: 0, unchanged: 0 } },
      singletons: { identity: { fields_set: 2 } },
      records: [
        {
          kind: 'skill',
          id: S1,
          path: 'profile.skills[0]',
          label: 'skill #1',
          action: 'create',
          changed_fields: [],
          declared_status: null,
        },
      ],
      discarded: [],
      warnings_by_code: {},
      unmapped_count: 0,
      untouched_existing: 0,
    };
    expect(importPreviewSchema.parse(fromIo(sample))).toEqual(
      toIo(importPreviewSchema.parse(sample)),
    );
  });
});
