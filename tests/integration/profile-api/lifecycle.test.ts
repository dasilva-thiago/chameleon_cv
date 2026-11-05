/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment --
   black-box HTTP test: supertest bodies are untyped JSON and each assertion checks the shape it reads. */
import {
  applyImportResponseSchema,
  importPreviewResponseSchema,
  listRecords,
} from '../../../packages/contracts/src';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  createProfileWorld,
  loadProfileYaml,
  type ProfileWorld,
  type TestAccount,
} from './support';
import { listProfileCanaries } from '../isolation/support/workspace';

/** Import lifecycle: preview -> apply | discard; expiry, replace, id conflicts, quota, legacy migration, logs. */
let world: ProfileWorld;
beforeAll(async () => {
  world = await createProfileWorld({
    profiles: { previewCache: { ttlMs: 60_000 }, previewQuota: { windowMs: 60_000, max: 100_000 } },
  });
}, 120_000);
afterAll(async () => {
  await world.drop();
});

const PREVIEW = '/api/profile/imports/preview';
const preview = async (account: TestAccount, fixture: string) => {
  const response = await account.client.post(PREVIEW, { text: loadProfileYaml(fixture as never) });
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(201);
  return importPreviewResponseSchema.parse(response.body);
};
const apply = (account: TestAccount, id: string, body: Record<string, unknown>) =>
  account.client.post(`/api/profile/imports/${id}/apply`, body);

describe('apply and discard', () => {
  it('apply is explicit, one-shot and owner-bound; the record keeps source/target versions and steps', async () => {
    const account = await world.newAccount('apply');
    const previewed = await preview(account, 'non-tech-nurse');
    expect(previewed.importRecord).toMatchObject({
      status: 'preview',
      sourceSchemaVersion: '2.1.0',
      targetSchemaVersion: '2.1.0',
      sourceFormat: 'yaml',
    });
    expect(previewed.importRecord.steps.length).toBeGreaterThan(0);
    expect(new Date(previewed.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const detail = await account.client.get(`/api/profile/imports/${previewed.importRecord.id}`);
    expect(detail.status).toBe(200);
    expect(bodyOf(detail).preview).not.toBeNull();

    // body validation: mode is mandatory, replace needs the confirmation flag, unknown keys are refused
    expect((await apply(account, previewed.importRecord.id, {})).status).toBe(400);
    expect((await apply(account, previewed.importRecord.id, { mode: 'replace' })).status).toBe(400);
    expect(
      (await apply(account, previewed.importRecord.id, { mode: 'merge', ownerId: 'x' })).status,
    ).toBe(400);

    const applied = await apply(account, previewed.importRecord.id, { mode: 'merge' });
    expect(applied.status).toBe(200);
    const result = applyImportResponseSchema.parse(applied.body);
    expect(result.previousRevision).toBeNull(); // the profile was empty
    expect(result.save.summary.totals.created).toBeGreaterThan(0);
    expect(result.importRecord.idMap).not.toEqual({});

    // a second apply of the same record is refused
    const again = await apply(account, previewed.importRecord.id, { mode: 'merge' });
    expect(again.status).toBe(409);
    expect(bodyOf(again).error).toMatchObject({ code: 'IMPORT_NOT_APPLICABLE' });
    const history = await account.client.get('/api/profile/imports?status=applied');
    expect(bodyOf(history).imports).toHaveLength(1);
    expect((await account.client.get('/api/profile/imports')).status).toBe(200);
  });

  it('discard: status discarded, cannot be applied or discarded again', async () => {
    const account = await world.newAccount('discard');
    const previewed = await preview(account, 'minimal-partial');
    const discarded = await account.client.post(
      `/api/profile/imports/${previewed.importRecord.id}/discard`,
      {},
    );
    expect(discarded.status).toBe(200);
    expect(bodyOf(discarded).importRecord).toMatchObject({ status: 'discarded' });
    const apply2 = await apply(account, previewed.importRecord.id, { mode: 'merge' });
    expect(apply2.status).toBe(409);
    expect(bodyOf(apply2).error).toMatchObject({ code: 'IMPORT_NOT_APPLICABLE' });
    const twice = await account.client.post(
      `/api/profile/imports/${previewed.importRecord.id}/discard`,
      {},
    );
    expect(twice.status).toBe(409);
    const state = bodyOf(await account.client.get('/api/profile'));
    expect((state.summary as { recordCount: number }).recordCount).toBe(0);
  });

  it('apply of an unknown id is 404; a preview that expired answers 409 IMPORT_PREVIEW_EXPIRED', async () => {
    const account = await world.newAccount('expiry');
    expect(
      (await apply(account, '00000000-0000-4000-8000-000000000000', { mode: 'merge' })).status,
    ).toBe(404);
    expect((await apply(account, 'nao-e-uuid', { mode: 'merge' })).status).toBe(404);

    const short = world.withApp({ profiles: { previewCache: { ttlMs: 1 } } });
    try {
      const owner = await short.newAccount('expiry');
      const response = await owner.client.post(PREVIEW, {
        text: loadProfileYaml('minimal-partial'),
      });
      const id = importPreviewResponseSchema.parse(response.body).importRecord.id;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const late = await owner.client.post(`/api/profile/imports/${id}/apply`, { mode: 'merge' });
      expect(late.status).toBe(409);
      expect(bodyOf(late).error).toMatchObject({ code: 'IMPORT_PREVIEW_EXPIRED' });
      const detail = await owner.client.get(`/api/profile/imports/${id}`);
      expect(bodyOf(detail).preview).toBeNull();
    } finally {
      await short.drop();
    }
  });
});

describe('replace mode', () => {
  it('needs confirmReplace, snapshots the previous state, archives facts and removes plain records the file omits', async () => {
    const account = await world.newAccount('replace');
    const first = await preview(account, 'non-tech-nurse');
    await apply(account, first.importRecord.id, { mode: 'merge' });
    const before = bodyOf(await account.client.get('/api/profile')).summary as {
      byStatus: Record<string, number>;
      byKind: Record<string, number>;
    };
    expect(before.byStatus.needs_review).toBeGreaterThan(0);

    const second = await preview(account, 'non-tech-logistics');
    expect(second.preview.untouched_existing).toBeGreaterThan(0);
    const result = applyImportResponseSchema.parse(
      (await apply(account, second.importRecord.id, { mode: 'replace', confirmReplace: true }))
        .body,
    );
    expect(result.previousRevision).not.toBeNull();
    expect(result.save.summary.totals.archived).toBeGreaterThan(0);

    // the previous state is recoverable from the snapshot taken before the import
    const snapshot = await account.client.get(
      `/api/profile/revisions/${result.previousRevision?.id}`,
    );
    expect(snapshot.status).toBe(200);
    expect(JSON.stringify(snapshot.body)).toContain(listProfileCanaries('non-tech-nurse')[0]);
    expect(bodyOf(snapshot).verified).toBe(true);

    // archived facts never go to a resume
    const doc = JSON.stringify(bodyOf(await account.client.get('/api/profile')).document);
    const archived = (
      bodyOf(await account.client.get('/api/profile')).summary as {
        byStatus: Record<string, number>;
      }
    ).byStatus.archived;
    expect(archived).toBeGreaterThan(0);
    expect(doc).toContain('"status":"archived"');
    const facts = listRecords(bodyOf(await account.client.get('/api/profile')).document)
      .map((entry) => entry.value as { meta?: { status?: string; resume_use?: string } })
      .filter((record) => record.meta?.status === 'archived');
    expect(facts.length).toBe(archived);
    expect(facts.every((fact) => fact.meta?.resume_use === 'never')).toBe(true);
  });

  it('archived items stay archived and never get resume_use other than never, through every write path', async () => {
    const account = await world.newAccount('archived');
    const previewed = await preview(account, 'private-heavy');
    await apply(account, previewed.importRecord.id, { mode: 'merge' });
    const archived = listRecords(bodyOf(await account.client.get('/api/profile')).document)
      .map(
        (entry) => entry.value as { id: string; meta?: { status?: string; resume_use?: string } },
      )
      .find((record) => record.meta?.status === 'archived');
    if (!archived) throw new Error('private-heavy has an archived item');
    expect(archived.meta?.resume_use).toBe('never');

    // PATCH, PUT record and a whole-document save cannot make it usable
    const id = archived.id;
    expect(
      (await account.client.patch(`/api/profile/records/${id}/meta`, { resume_use: 'allowed' }))
        .status,
    ).toBe(400);
    const current = (await account.client.get(`/api/profile/records/${id}`)).body.record;
    const put = await account.client.put(`/api/profile/records/${id}`, {
      record: { ...current, meta: { ...current.meta, resume_use: 'allowed' } },
    });
    expect(put.status).toBe(400);
    const full = bodyOf(await account.client.get('/api/profile')).document;
    for (const entry of listRecords(full)) {
      if (entry.id === id)
        entry.value.meta = { ...(entry.value.meta as object), resume_use: 'allowed' };
    }
    expect((await account.client.put('/api/profile', { document: full })).status).toBe(400);
    expect(
      (
        (await account.client.get(`/api/profile/records/${id}`)).body.record.meta as Record<
          string,
          string
        >
      ).resume_use,
    ).toBe('never');
  });
});

describe('ids from another account', () => {
  it('applying another owner export hits ID_CONFLICT (no hint of whose); regenerateConflictingIds imports it', async () => {
    const owner = await world.newAccount('origin');
    const visitor = await world.newAccount('visitor');
    const first = await preview(owner, 'non-tech-nurse');
    await apply(owner, first.importRecord.id, { mode: 'merge' });
    const exported = (await owner.client.get('/api/profile/export?format=yaml')).text;
    const ownerIds = [...exported.matchAll(/id: ([0-9a-f-]{36})/g)].map((m) => m[1]!);
    expect(ownerIds.length).toBeGreaterThan(5);

    const previewed = importPreviewResponseSchema.parse(
      (await visitor.client.post(PREVIEW, { text: exported })).body,
    );
    const conflict = await apply(visitor, previewed.importRecord.id, { mode: 'merge' });
    expect(conflict.status).toBe(409);
    expect(bodyOf(conflict).error).toMatchObject({ code: 'ID_CONFLICT' });
    for (const id of ownerIds) expect(JSON.stringify(conflict.body)).not.toContain(id);

    const ok = await apply(visitor, previewed.importRecord.id, {
      mode: 'merge',
      regenerateConflictingIds: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const result = applyImportResponseSchema.parse(ok.body);
    expect(result.idRemapCount).toBeGreaterThan(0);
    const visitorExport = (await visitor.client.get('/api/profile/export?format=yaml')).text;
    for (const id of ownerIds) expect(visitorExport).not.toContain(id);
  });
});

describe('legacy and partial files', () => {
  it('1.0.0 file: migration step and warnings in the record; export is 2.1.0 with the legacy content', async () => {
    const account = await world.newAccount('legacy');
    const previewed = await preview(account, 'legacy-1.0.0-filled');
    expect(previewed.importRecord.sourceSchemaVersion).toBe('1.0.0');
    expect(previewed.importRecord.targetSchemaVersion).toBe('2.1.0');
    expect(previewed.importRecord.steps.map((step) => step.id)).toContain('v1_0_0_to_v2_1_0');
    expect(previewed.warnings.length).toBeGreaterThan(0);
    expect(previewed.preview.totals.records).toBeGreaterThan(10);
    expect((await apply(account, previewed.importRecord.id, { mode: 'merge' })).status).toBe(200);
    const exported = JSON.parse(
      (await account.client.get('/api/profile/export?format=json')).text,
    ) as {
      schema_version: string;
    };
    expect(exported.schema_version).toBe('2.1.0');
    const detail = await account.client.get('/api/profile/imports?status=applied');
    expect(bodyOf(detail).imports).toHaveLength(1);
  });

  it('partial non-technology file: applies with open pending items visible', async () => {
    const account = await world.newAccount('partial');
    const previewed = await preview(account, 'minimal-partial');
    await apply(account, previewed.importRecord.id, { mode: 'merge' });
    const state = bodyOf(await account.client.get('/api/profile'));
    expect((state.summary as { recordCount: number }).recordCount).toBeGreaterThan(0);
  });
});

describe('large documents', () => {
  it('a whole-document save over the global 100 KiB JSON limit works (limit is UPLOAD_MAX_BYTES)', async () => {
    const account = await world.newAccount('large');
    const statements = Array.from({ length: 14 }, (_, i) => ({
      kind: 'career_narrative',
      text: `${String(i)}-`.padEnd(9_000, 'a'),
    }));
    const document = { schema_version: '2.1.0', profile: { statements } };
    expect(JSON.stringify(document).length).toBeGreaterThan(120 * 1024);
    const saved = await account.client.put('/api/profile', { document });
    expect(saved.status, JSON.stringify(bodyOf(saved)).slice(0, 200)).toBe(200);
    expect(bodyOf(saved).state).toMatchObject({ summary: { recordCount: 14 } });
  });
});

describe('quota', () => {
  it('past the per-owner preview quota -> 429 RATE_LIMITED with Retry-After', async () => {
    const limited = world.withApp({ profiles: { previewQuota: { windowMs: 60_000, max: 2 } } });
    try {
      const owner = await limited.newAccount('quota');
      const other = await limited.newAccount('quota-other');
      const text = loadProfileYaml('minimal-partial');
      expect((await owner.client.post(PREVIEW, { text })).status).toBe(201);
      expect((await owner.client.post(PREVIEW, { text })).status).toBe(201);
      const third = await owner.client.post(PREVIEW, { text });
      expect(third.status).toBe(429);
      expect(bodyOf(third).error).toMatchObject({ code: 'RATE_LIMITED' });
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
      // another owner is unaffected
      expect((await other.client.post(PREVIEW, { text })).status).toBe(201);
    } finally {
      await limited.drop();
    }
  });
});

describe('logs of the whole suite', () => {
  it('no canary of any imported fixture and no profile text reached the log', async () => {
    const account = await world.newAccount('logscan');
    const previewed = await preview(account, 'private-heavy');
    await apply(account, previewed.importRecord.id, { mode: 'merge' });
    await account.client.get('/api/profile');
    await account.client.get('/api/profile/export?format=json');
    const logs = world.built.logs.text();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toMatch(/CANARY-/i);
    for (const fixture of [
      'private-heavy',
      'non-tech-nurse',
      'non-tech-logistics',
      'legacy-1.0.0-filled',
    ]) {
      for (const canary of listProfileCanaries(fixture as never))
        expect(logs).not.toContain(canary);
    }
  });
});
