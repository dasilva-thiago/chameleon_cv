import {
  applyImportResponseSchema,
  importPreviewResponseSchema,
  listRecords,
  remapIds,
  type ImportPreviewResponse,
} from '../../../packages/contracts/src';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  createProfileWorld,
  importProfile,
  listProfileIds,
  listV2ProfileIds,
  loadProfile,
  loadProfileYaml,
  type ProfileWorld,
  type TestAccount,
} from './support';

/**
 * Import preview -> apply -> export through the real HTTP API for every fixture (S2.1a acceptance):
 *  - the canonical form of the export equals what the importer produces (same ids), in YAML and JSON;
 *  - re-importing the export is idempotent (0 created, 0 updated);
 *  - nothing is applied by a preview; apply is explicit and owner-bound.
 */
let world: ProfileWorld;
beforeAll(async () => {
  world = await createProfileWorld();
}, 120_000);
afterAll(async () => {
  await world.drop();
});

const preview = (account: TestAccount, text: string, extra: Record<string, unknown> = {}) =>
  account.client.post('/api/profile/imports/preview', { text, ...extra });

async function exportText(account: TestAccount, format: 'yaml' | 'json'): Promise<string> {
  const response = await account.client.get(`/api/profile/export?format=${format}`);
  expect(response.status).toBe(200);
  return response.text;
}

/**
 * Records the file gave no id (e.g. usage restrictions in the fixtures) get a fresh UUID per import: name them by
 * order of appearance so two canonical documents can be compared.
 */
function nameGeneratedIds<T>(document: T, mapped: Record<string, string>): T {
  const known = new Set(Object.values(mapped));
  let next = 0;
  return remapIds(document, (id) => (known.has(id) ? id : `GENERATED-${(next += 1)}`));
}

/** Document from an export, in canonical form. */
function canonicalOf(text: string) {
  const loaded = loadProfile(text);
  expect(loaded.ok).toBe(true);
  return loaded.document;
}

describe.each([...listProfileIds()])('fixture %s through the HTTP API', (fixtureId) => {
  const isV2 = (listV2ProfileIds() as readonly string[]).includes(fixtureId);

  it('preview does not apply; apply merges; export (YAML and JSON) equals the canonical import', async () => {
    const account = await world.newAccount(`rt-${fixtureId}`);
    const text = loadProfileYaml(fixtureId);

    const previewed = await preview(account, text);
    expect(previewed.status, JSON.stringify(previewed.body).slice(0, 300)).toBe(201);
    const parsed = importPreviewResponseSchema.parse(previewed.body);
    expect(parsed.importRecord.status).toBe('preview');
    expect(parsed.preview.totals.create).toBe(parsed.preview.totals.records);
    expect(parsed.preview.totals.update).toBe(0);

    // nothing applied yet: the profile container exists but holds no content
    const before = await account.client.get('/api/profile');
    expect(bodyOf(before).document).toMatchObject({ profile: {} });
    expect((bodyOf(before).summary as { recordCount: number }).recordCount).toBe(0);

    const applied = await account.client.post(
      `/api/profile/imports/${parsed.importRecord.id}/apply`,
      { mode: 'merge' },
    );
    expect(applied.status, JSON.stringify(applied.body).slice(0, 300)).toBe(200);
    const result = applyImportResponseSchema.parse(applied.body);
    expect(result.importRecord.status).toBe('applied');
    expect(result.importRecord.revisionId).toBe(result.revision.revision.id);
    expect(result.summary.recordCount).toBe(parsed.preview.totals.records);

    // the importer with the id map of the applied record reproduces the exact stored document
    const expected = importProfile(text, { existingIdMap: result.importRecord.idMap });
    expect(expected.ok).toBe(true);
    const json = await exportText(account, 'json');
    const yaml = await exportText(account, 'yaml');
    const idMap = result.importRecord.idMap;
    const want = nameGeneratedIds(expected.document, idMap);
    expect(nameGeneratedIds(canonicalOf(json), idMap)).toEqual(want);
    expect(nameGeneratedIds(canonicalOf(yaml), idMap)).toEqual(want);
    expect(nameGeneratedIds(JSON.parse(json), idMap)).toEqual(want);

    // everything imported needs review (archived stays archived and never goes to a resume)
    const state = bodyOf(await account.client.get('/api/profile'));
    const summary = state.summary as { byStatus: Record<string, number> };
    expect(summary.byStatus.confirmed).toBe(0);
    if (isV2) {
      expect(
        (summary.byStatus.needs_review ?? 0) + (summary.byStatus.archived ?? 0),
      ).toBeGreaterThan(0);
    }
  }, 60_000);

  it('re-importing the export is idempotent: 0 created, 0 updated, same ids', async () => {
    const account = await world.newAccount(`idem-${fixtureId}`);
    const first = await preview(account, loadProfileYaml(fixtureId));
    const firstRecord = importPreviewResponseSchema.parse(first.body).importRecord;
    expect(
      (await account.client.post(`/api/profile/imports/${firstRecord.id}/apply`, { mode: 'merge' }))
        .status,
    ).toBe(200);
    const exported = await exportText(account, 'yaml');
    const before = canonicalOf(await exportText(account, 'json'));

    const second = await preview(account, exported);
    expect(second.status, JSON.stringify(second.body).slice(0, 300)).toBe(201);
    const parsed = importPreviewResponseSchema.parse(second.body);
    expect(parsed.preview.totals.create).toBe(0);
    expect(parsed.preview.totals.update).toBe(0);
    expect(parsed.preview.totals.unchanged).toBe(parsed.preview.totals.records);

    const applied = await account.client.post(
      `/api/profile/imports/${parsed.importRecord.id}/apply`,
      { mode: 'merge' },
    );
    expect(applied.status).toBe(200);
    const result = applyImportResponseSchema.parse(applied.body);
    expect(result.save.summary.totals.created).toBe(0);
    expect(result.save.summary.totals.updated).toBe(0);
    expect(canonicalOf(await exportText(account, 'json'))).toEqual(before);
  }, 60_000);
});

describe('apply keeps decisions the owner already made', () => {
  it('re-importing an export keeps confirmed/archived; a record whose content changed goes back to review', async () => {
    const account = await world.newAccount('governance');
    const text = loadProfileYaml('private-heavy');
    const first = importPreviewResponseSchema.parse((await preview(account, text)).body);
    await account.client.post(`/api/profile/imports/${first.importRecord.id}/apply`, {
      mode: 'merge',
    });
    const factsOf = (document: unknown) =>
      listRecords(document)
        .map((entry) => entry.value as { id: string; name?: string; meta?: { status?: string } })
        .filter((value) => value.meta !== undefined);
    const doc = canonicalOf(await exportText(account, 'json'));
    const reviewable = factsOf(doc).filter((r) => r.meta?.status === 'needs_review');
    const archivedBefore = factsOf(doc).filter((r) => r.meta?.status === 'archived');
    expect(archivedBefore.length).toBeGreaterThan(0);
    const skills = reviewable.filter((r) => typeof r.name === 'string');
    const ids = skills.slice(0, 3).map((r) => r.id);
    expect(ids.length).toBe(3);
    const confirmed = await account.client.post('/api/profile/confirmations', { recordIds: ids });
    expect(confirmed.status).toBe(200);
    expect(bodyOf(confirmed).confirmed).toHaveLength(3);

    // 1) unchanged export: nothing is demoted
    const exported = await exportText(account, 'yaml');
    const second = importPreviewResponseSchema.parse((await preview(account, exported)).body);
    expect(second.preview.totals.update).toBe(0);
    await account.client.post(`/api/profile/imports/${second.importRecord.id}/apply`, {
      mode: 'merge',
    });
    const afterSame = factsOf(canonicalOf(await exportText(account, 'json')));
    expect(
      afterSame
        .filter((r) => r.meta?.status === 'confirmed')
        .map((r) => r.id)
        .sort(),
    ).toEqual([...ids].sort());
    expect(afterSame.filter((r) => r.meta?.status === 'archived')).toHaveLength(
      archivedBefore.length,
    );

    // 2) one confirmed skill edited in the file: only that record returns to review
    const edited = JSON.parse(await exportText(account, 'json')) as unknown;
    const target = listRecords(edited).find((entry) => entry.id === ids[0]);
    if (!target) throw new Error('confirmed record not in export');
    target.value.meta = { ...(target.value.meta as object), source_detail: 'Editado no arquivo.' };
    const third = importPreviewResponseSchema.parse(
      (await preview(account, JSON.stringify(edited), { format: 'json' })).body,
    );
    expect(third.preview.totals.update).toBe(1);
    await account.client.post(`/api/profile/imports/${third.importRecord.id}/apply`, {
      mode: 'merge',
    });
    const afterEdit = factsOf(canonicalOf(await exportText(account, 'json')));
    expect(
      afterEdit
        .filter((r) => r.meta?.status === 'confirmed')
        .map((r) => r.id)
        .sort(),
    ).toEqual(ids.slice(1).sort());
    expect(afterEdit.find((r) => r.id === ids[0])?.meta?.status).toBe('needs_review');
  }, 60_000);
});

describe('preview endpoint contract', () => {
  it('accepts text/yaml and text/plain bodies; JSON envelope with format json', async () => {
    const account = await world.newAccount('bodies');
    const text = loadProfileYaml('minimal-partial');

    const asYaml = await account.client.postRaw('/api/profile/imports/preview', text, {
      contentType: 'text/yaml',
    });
    expect(asYaml.status).toBe(201);
    expect(importPreviewResponseSchema.parse(asYaml.body).importRecord.sourceFormat).toBe('yaml');

    const asPlain = await account.client.postRaw('/api/profile/imports/preview', text, {
      contentType: 'text/plain; charset=utf-8',
    });
    expect(asPlain.status).toBe(201);

    const json = JSON.stringify(importProfile(text, {}).document);
    const asJson = await preview(account, json, { format: 'json' });
    expect(asJson.status).toBe(201);
    expect(importPreviewResponseSchema.parse(asJson.body).importRecord.sourceFormat).toBe('json');
  });

  it('a second owner previewing the same file gets their own records (nothing shared)', async () => {
    const a = await world.newAccount('own-a');
    const b = await world.newAccount('own-b');
    const text = loadProfileYaml('non-tech-nurse');
    const pa: ImportPreviewResponse = importPreviewResponseSchema.parse(
      (await preview(a, text)).body,
    );
    const pb: ImportPreviewResponse = importPreviewResponseSchema.parse(
      (await preview(b, text)).body,
    );
    expect(pa.importRecord.id).not.toBe(pb.importRecord.id);
    expect(pa.preview.records[0]?.id).not.toBe(pb.preview.records[0]?.id);
  });
});
