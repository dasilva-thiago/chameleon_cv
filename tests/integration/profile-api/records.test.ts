/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call --
   black-box HTTP test: supertest bodies are untyped JSON and each assertion checks the shape it reads. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodyOf, createProfileWorld, type ProfileWorld, type TestAccount } from './support';

/**
 * A new owner builds a PARTIAL non-technology profile (a nurse) through the form-style API only:
 * sections, per-record CRUD, governance controls, batch confirmation, evidence links, pending items,
 * revisions and the explicit hard delete.
 */
let world: ProfileWorld;
let account: TestAccount;
beforeAll(async () => {
  world = await createProfileWorld();
  account = await world.newAccount('records');
}, 120_000);
afterAll(async () => {
  await world.drop();
});

type Rec = Record<string, unknown>;
const state = async () => bodyOf(await account.client.get('/api/profile'));
const docOf = async () => (await state()).document as { profile: Record<string, Rec[] | Rec> };

async function create(kind: string, record: Rec, parentId?: string) {
  const response = await account.client.post('/api/profile/records', {
    kind,
    record,
    ...(parentId ? { parentId } : {}),
  });
  return response;
}
const idOf = (response: { body: unknown }) => ((response.body as Rec).record as Rec).id as string;

const ids: Record<string, string> = {};

describe('empty profile', () => {
  it('GET /api/profile answers 200 exists=false; reads of records/export are 404', async () => {
    const response = await account.client.get('/api/profile');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      exists: false,
      profile: null,
      document: null,
      summary: { recordCount: 0 },
    });
    expect(
      (await account.client.get('/api/profile/records/00000000-0000-4000-8000-000000000000'))
        .status,
    ).toBe(404);
    expect((await account.client.get('/api/profile/export')).status).toBe(404);
    expect((await account.client.get('/api/profile/revisions/nao-e-uuid')).status).toBe(404);
  });
});

describe('sections', () => {
  it('PUT a block creates the profile; GET reads it back; unknown section is 404', async () => {
    const put = await account.client.put('/api/profile/sections/identity', {
      value: { full_name: 'Ana Teste Silva', city: 'Campinas', country_of_residence: 'Brasil' },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(bodyOf(put).state).toMatchObject({ exists: true });
    const get = await account.client.get('/api/profile/sections/identity');
    expect(get.body).toMatchObject({
      section: 'identity',
      value: { full_name: 'Ana Teste Silva' },
    });
    expect((await account.client.get('/api/profile/sections/nao_existe')).status).toBe(404);
    expect(
      (await account.client.put('/api/profile/sections/nao_existe', { value: {} })).status,
    ).toBe(404);
  });

  it('invalid value -> 400 with paths under value.* and without echoing what was sent', async () => {
    const response = await account.client.put('/api/profile/sections/identity', {
      value: { full_name: '   ', CANARY_UNKNOWN_KEY_xyz: 'CANARY-VALUE-xyz' },
    });
    expect(response.status).toBe(400);
    const text = JSON.stringify(response.body);
    expect(text).toContain('value');
    expect(text).not.toContain('CANARY');
  });

  it('a collection section upserts and keeps what the list omits', async () => {
    const put = await account.client.put('/api/profile/sections/skills', {
      value: [{ name: 'Curativos' }, { name: 'Triagem' }],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const first = (bodyOf(put).state as { document: { profile: { skills: Rec[] } } }).document
      .profile.skills;
    expect(first).toHaveLength(2);
    // keep: sending a different list does not remove the earlier skills
    const second = await account.client.put('/api/profile/sections/skills', {
      value: [{ id: first[0]?.id, name: 'Curativos', category: 'tool' }],
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const skills = ((await docOf()).profile.skills ?? []) as Rec[];
    expect(skills.map((s) => s.name).sort()).toEqual(['Curativos', 'Triagem']);
    // delete the helper skills so the later steps start clean
    for (const skill of skills) {
      expect((await account.client.delete(`/api/profile/records/${String(skill.id)}`)).status).toBe(
        200,
      );
    }
    expect((await docOf()).profile.skills).toBeUndefined(); // not "[]": deleting never asserts "none"
  });

  it('records with an id the profile does not know are refused (create by omitting the id)', async () => {
    const response = await account.client.put('/api/profile/sections/skills', {
      value: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Fantasma' }],
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('11111111');
  });
});

describe('records', () => {
  it('creates an experience, a nested item (parentId rules) and a skill with its usage', async () => {
    const experience = await create('experience', {
      organization_name: 'Hospital Ficticio do Vale',
      official_title: 'Enfermeira de UTI',
      start_date: '2019-03',
      end_date: 'present',
    });
    expect(experience.status, JSON.stringify(experience.body)).toBe(201);
    ids.experience = idOf(experience);
    expect(ids.experience).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodyOf(experience)).toMatchObject({
      kind: 'experience',
      parentId: null,
      section: 'experiences',
    });
    expect(experience.body.record.meta).toBeUndefined(); // no governance invented

    // client-chosen id is refused
    const chosen = await create('skill', { id: 'abc', name: 'X' });
    expect(chosen.status).toBe(400);
    // nested kinds need a parent of the right kind; a missing/foreign parent is a plain 404
    expect((await create('experience_item', { kind: 'achievement', text: 'x' })).status).toBe(400);
    expect(
      (
        await create(
          'experience_item',
          { kind: 'achievement', text: 'x' },
          '22222222-2222-4222-8222-222222222222',
        )
      ).status,
    ).toBe(404);
    expect(
      (await create('project_item', { kind: 'deliverable', text: 'x' }, ids.experience)).status,
    ).toBe(404);

    const item = await create(
      'experience_item',
      { kind: 'responsibility', text: 'Monitorar pacientes criticos em ventilacao mecanica.' },
      ids.experience,
    );
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    ids.item = idOf(item);
    expect(bodyOf(item)).toMatchObject({ parentId: ids.experience });

    const skill = await create('skill', { name: 'Suporte Basico de Vida' });
    expect(skill.status).toBe(201);
    ids.skill = idOf(skill);
    const usage = await create('skill_usage', {
      skill_id: ids.skill,
      usage_context: 'professional_experience',
      experience_id: ids.experience,
    });
    expect(usage.status, JSON.stringify(usage.body)).toBe(201);
    ids.usage = idOf(usage);

    // a skill with the same normalized name is caught by the contract's integrity rules (400); the store's
    // DUPLICATE_SKILL (409) only fires on a race between two requests
    const duplicate = await create('skill', { name: 'suporte basico de vida' });
    expect(duplicate.status).toBe(400);
    expect(bodyOf(duplicate).error).toMatchObject({ code: 'VALIDATION_ERROR' });

    // a skill_usage pointing at a record that does not exist is a validation error
    const dangling = await create('skill_usage', {
      skill_id: '33333333-3333-4333-8333-333333333333',
      usage_context: 'self_declared_knowledge',
    });
    expect(dangling.status).toBe(400);
  });

  it('GET and PUT a record; the id cannot change; children not mentioned are kept', async () => {
    const got = await account.client.get(`/api/profile/records/${ids.experience}`);
    expect(got.status).toBe(200);
    expect(got.body.record.official_title).toBe('Enfermeira de UTI');

    const mismatch = await account.client.put(`/api/profile/records/${ids.experience}`, {
      record: { id: '44444444-4444-4444-8444-444444444444', official_title: 'x' },
    });
    expect(mismatch.status).toBe(400);

    const put = await account.client.put(`/api/profile/records/${ids.experience}`, {
      record: {
        organization_name: 'Hospital Ficticio do Vale',
        official_title: 'Enfermeira Coordenadora',
        start_date: '2019-03',
        end_date: 'present',
      },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.record.official_title).toBe('Enfermeira Coordenadora');
    expect((put.body.record.items as Rec[]).map((i) => i.id)).toEqual([ids.item]);

    // an item id the profile does not know cannot be smuggled in through the parent
    const smuggled = await account.client.put(`/api/profile/records/${ids.experience}`, {
      record: {
        official_title: 'x',
        items: [{ id: '55555555-5555-4555-8555-555555555555', kind: 'delivery', text: 'y' }],
      },
    });
    expect(smuggled.status).toBe(400);
  });

  it('PATCH meta: status/visibility/resume_use/field_states; archived forces resume_use never', async () => {
    const patched = await account.client.patch(`/api/profile/records/${ids.experience}/meta`, {
      status: 'confirmed',
      visibility: 'public',
      resume_use: 'allowed',
      field_states: { exit_reason: 'declined' },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.record.meta).toMatchObject({
      status: 'confirmed',
      visibility: 'public',
      resume_use: 'allowed',
      field_states: { exit_reason: 'declined' },
    });

    const cleared = await account.client.patch(`/api/profile/records/${ids.experience}/meta`, {
      field_states: { exit_reason: null },
    });
    expect(cleared.body.record.meta.field_states).toBeUndefined();

    // a state that conflicts with a filled value is a validation error
    const conflict = await account.client.patch(`/api/profile/records/${ids.experience}/meta`, {
      field_states: { official_title: 'declined' },
    });
    expect(conflict.status).toBe(400);

    // archived + allowed is refused; archived alone forces never
    const bad = await account.client.patch(`/api/profile/records/${ids.item}/meta`, {
      status: 'archived',
      resume_use: 'allowed',
    });
    expect(bad.status).toBe(400);
    const archived = await account.client.patch(`/api/profile/records/${ids.item}/meta`, {
      status: 'archived',
    });
    expect(archived.status).toBe(200);
    expect(archived.body.record.meta).toMatchObject({ status: 'archived', resume_use: 'never' });
    const stillBad = await account.client.patch(`/api/profile/records/${ids.item}/meta`, {
      resume_use: 'allowed',
    });
    expect(stillBad.status).toBe(400);
    // unknown keys and empty patches are rejected
    expect((await account.client.patch(`/api/profile/records/${ids.item}/meta`, {})).status).toBe(
      400,
    );
    expect(
      (await account.client.patch(`/api/profile/records/${ids.item}/meta`, { ownerId: 'x' }))
        .status,
    ).toBe(400);
    // contacts have no governance meta
    const contact = await create('contact_point', { kind: 'email', value: 'ana@example.test' });
    expect(contact.status).toBe(201);
    ids.contact = idOf(contact);
    expect(
      (
        await account.client.patch(`/api/profile/records/${ids.contact}/meta`, {
          status: 'confirmed',
        })
      ).status,
    ).toBe(400);
  });

  it('archive: facts only; the archive route keeps resume_use never', async () => {
    const skill2 = await create('skill', { name: 'Reanimacao Cardiopulmonar' });
    ids.skill2 = idOf(skill2);
    const archived = await account.client.post(`/api/profile/records/${ids.skill2}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.record.meta).toMatchObject({ status: 'archived', resume_use: 'never' });
    expect((await account.client.post(`/api/profile/records/${ids.contact}/archive`)).status).toBe(
      400,
    );
  });

  it('batch confirmation: explicit ids only; skips are reported without revealing why an id is unknown', async () => {
    const extra = await create('skill', { name: 'Gasometria' });
    ids.skill3 = idOf(extra);
    const ghost = '66666666-6666-4666-8666-666666666666';
    const response = await account.client.post('/api/profile/confirmations', {
      recordIds: [ids.skill3, ids.experience, ids.contact, ghost, ids.skill2],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const body = bodyOf(response) as {
      confirmed: string[];
      skipped: { recordId: string; reason: string }[];
    };
    expect(body.confirmed).toEqual([ids.skill3]);
    expect(Object.fromEntries(body.skipped.map((s) => [s.recordId, s.reason]))).toEqual({
      [ids.experience!]: 'not_needs_review', // already confirmed
      [ids.contact!]: 'not_a_fact',
      [ghost]: 'not_found',
      [ids.skill2!]: 'not_needs_review', // archived
    });
    expect(
      (await account.client.get(`/api/profile/records/${ids.skill3}`)).body.record.meta.status,
    ).toBe('confirmed');
    // no "confirm everything": empty, duplicated and unknown-field bodies are refused
    expect(
      (await account.client.post('/api/profile/confirmations', { recordIds: [] })).status,
    ).toBe(400);
    expect(
      (
        await account.client.post('/api/profile/confirmations', {
          recordIds: [ids.skill3, ids.skill3],
        })
      ).status,
    ).toBe(400);
    expect((await account.client.post('/api/profile/confirmations', { all: true })).status).toBe(
      400,
    );
  });
});

describe('evidence and pending items', () => {
  it('creates evidence, links/unlinks it (both sides of the relation), and lists it', async () => {
    const evidence = await create('evidence', {
      type: 'document',
      title: 'Certificado de especializacao',
      url_or_location: 'pasta fisica',
    });
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(201);
    ids.evidence = idOf(evidence);

    const linked = await account.client.post(`/api/profile/evidence/${ids.evidence}/links`, {
      recordId: ids.experience,
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.links).toEqual([{ recordId: ids.experience, kind: 'experience' }]);
    // idempotent
    const again = await account.client.post(`/api/profile/evidence/${ids.evidence}/links`, {
      recordId: ids.experience,
    });
    expect(again.body.links).toHaveLength(1);

    // targets must exist and be facts
    expect(
      (
        await account.client.post(`/api/profile/evidence/${ids.evidence}/links`, {
          recordId: '77777777-7777-4777-8777-777777777777',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await account.client.post(`/api/profile/evidence/${ids.evidence}/links`, {
          recordId: ids.contact,
        })
      ).status,
    ).toBe(400);
    // not an evidence id
    expect((await account.client.get(`/api/profile/evidence/${ids.experience}/links`)).status).toBe(
      404,
    );

    const list = await account.client.get('/api/profile/evidence');
    expect(list.body.evidence).toHaveLength(1);
    expect(list.body.evidence[0].links).toHaveLength(1);

    const unlinked = await account.client.delete(
      `/api/profile/evidence/${ids.evidence}/links/${ids.experience}`,
    );
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.links).toEqual([]);
    // relink for the delete test below
    await account.client.post(`/api/profile/evidence/${ids.evidence}/links`, {
      recordId: ids.experience,
    });
  });

  it('pending items: create, list by status, change status, counters', async () => {
    const pending = await create('pending_item', {
      subject: 'Confirmar a data de inicio no hospital',
      target: { record_id: ids.experience, field: 'start_date' },
      reason: 'unclear',
      priority: 'high',
    });
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    ids.pending = idOf(pending);

    const open = await account.client.get('/api/profile/pending');
    expect(open.body.pending).toHaveLength(1);
    expect(open.body.pending[0].targetKind).toBe('experience');
    expect(open.body.counts).toEqual({ open: 1, resolved: 0, dismissed: 0 });

    const resolved = await account.client.patch(`/api/profile/pending/${ids.pending}`, {
      status: 'resolved',
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body.record.status).toBe('resolved');
    expect((await account.client.get('/api/profile/pending')).body.pending).toHaveLength(0);
    expect((await account.client.get('/api/profile/pending?status=all')).body.pending).toHaveLength(
      1,
    );
    expect(
      (await account.client.patch(`/api/profile/pending/${ids.experience}`, { status: 'open' }))
        .status,
    ).toBe(404);
    expect(
      (await account.client.patch(`/api/profile/pending/${ids.pending}`, { status: 'weird' }))
        .status,
    ).toBe(400);
    expect((await state()).summary).toMatchObject({
      pending: { open: 0, resolved: 1, dismissed: 0 },
    });
  });
});

describe('revisions', () => {
  it('create (201), reuse by hash (200), list with cursor, get with verified hash', async () => {
    const first = await account.client.post('/api/profile/revisions', {});
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ reused: false, revision: { revisionNumber: 1 } });
    const again = await account.client.post('/api/profile/revisions', {});
    expect(again.status).toBe(200);
    expect(again.body.reused).toBe(true);

    await account.client.patch(`/api/profile/records/${ids.skill3}/meta`, {
      visibility: 'private',
    });
    const second = await account.client.post('/api/profile/revisions', {
      reason: 'pre_generation',
    });
    expect(second.status).toBe(201);
    expect(second.body.revision.revisionNumber).toBeGreaterThan(1);

    const list = await account.client.get('/api/profile/revisions?limit=1');
    expect(list.body.revisions).toHaveLength(1);
    expect(list.body.nextBefore).toBe(list.body.revisions[0].revisionNumber);
    const next = await account.client.get(
      `/api/profile/revisions?limit=50&before=${list.body.nextBefore}`,
    );
    expect(
      next.body.revisions.every((r: Rec) => (r.revisionNumber as number) < list.body.nextBefore),
    ).toBe(true);

    const one = await account.client.get(`/api/profile/revisions/${first.body.revision.id}`);
    expect(one.status).toBe(200);
    expect(one.body.verified).toBe(true);
    expect(one.body.snapshot.schema_version).toBe('2.1.0');
    expect(JSON.stringify(one.body.revision)).not.toContain('profileId');

    expect((await account.client.post('/api/profile/revisions', { reason: 'import' })).status).toBe(
      400,
    );
    expect((await account.client.get('/api/profile/revisions?limit=0')).status).toBe(400);
  });
});

describe('whole document saves and hard delete', () => {
  it('PUT /api/profile defaults to keep; archive/delete only when explicit', async () => {
    const doc = (await docOf()) as Rec;
    const full = await state();
    const document = JSON.parse(JSON.stringify(full.document)) as {
      profile: Record<string, Rec[]>;
    };
    // drop skill3 and the contact from the document: with the default they stay
    document.profile.skills = (document.profile.skills ?? []).filter((s) => s.id !== ids.skill3);
    document.profile.contact_points = [];
    const kept = await account.client.put('/api/profile', { document });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(kept.body.save.summary.totals.deleted).toBe(0);
    expect(kept.body.save.summary.totals.archived).toBe(0);
    expect((await account.client.get(`/api/profile/records/${ids.skill3}`)).status).toBe(200);
    expect((await account.client.get(`/api/profile/records/${ids.contact}`)).status).toBe(200);

    const archived = await account.client.put('/api/profile', { document, onMissing: 'archive' });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body.save.summary.archived.skill).toBe(1);
    const skill3 = await account.client.get(`/api/profile/records/${ids.skill3}`);
    expect(skill3.body.record.meta).toMatchObject({ status: 'archived', resume_use: 'never' });
    expect((await account.client.get(`/api/profile/records/${ids.contact}`)).status).toBe(404); // plain records are removed
    expect(doc).toBeDefined();
  });

  it('DELETE is refused while something points at the record (RECORD_IN_USE), then cleans links', async () => {
    const blocked = await account.client.delete(`/api/profile/records/${ids.experience}`);
    expect(blocked.status).toBe(409);
    expect(bodyOf(blocked).error).toMatchObject({ code: 'RECORD_IN_USE' });
    expect(JSON.stringify(bodyOf(blocked).error)).toContain(ids.usage);
    expect((await account.client.get(`/api/profile/records/${ids.experience}`)).status).toBe(200);

    expect((await account.client.delete(`/api/profile/records/${ids.usage}`)).status).toBe(200);
    // also the pending item targets the experience: it blocks too
    const stillBlocked = await account.client.delete(`/api/profile/records/${ids.experience}`);
    expect(stillBlocked.status).toBe(409);
    expect((await account.client.delete(`/api/profile/records/${ids.pending}`)).status).toBe(200);

    const removed = await account.client.delete(`/api/profile/records/${ids.experience}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.deleted).toEqual({ kind: 'experience', id: ids.experience });
    expect((await account.client.get(`/api/profile/records/${ids.item}`)).status).toBe(404); // child went with it
    const doc = await docOf();
    expect(doc.profile.experiences).toBeUndefined();
    // the evidence lost its link to the deleted experience
    const links = await account.client.get(`/api/profile/evidence/${ids.evidence}/links`);
    expect(links.body.links).toEqual([]);
    expect((await account.client.delete(`/api/profile/records/${ids.experience}`)).status).toBe(
      404,
    );
  });
});
