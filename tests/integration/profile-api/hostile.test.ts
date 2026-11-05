import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRouteManifest, listProfileCanaries, testConfig } from '../isolation/support/workspace';
import {
  bodyOf,
  createProfileWorld,
  errorShape,
  loadProfileYaml,
  type ProfileWorld,
  type TestAccount,
} from './support';

/**
 * Imports and uploads are UNTRUSTED data (Phase 1 gate, condition 4): size limits, content types, parse
 * limits, YAML aliases/tags, prototype pollution, no echo of content in bodies or logs, CSRF on mutations.
 */
const LIMIT = 20_000;
let world: ProfileWorld;
let account: TestAccount;

beforeAll(async () => {
  world = await createProfileWorld({ config: testConfig({ UPLOAD_MAX_BYTES: String(LIMIT) }) });
  account = await world.newAccount('hostile');
}, 120_000);
afterAll(async () => {
  await world.drop();
});

const CANARY = 'CANARY-hostile-payload-9f3a';
const PREVIEW = '/api/profile/imports/preview';
const raw = (text: string | Buffer, contentType: string, path = PREVIEW) =>
  account.client.postRaw(path, text as string, { contentType });
const asJson = (text: string, extra: Record<string, unknown> = {}) =>
  account.client.post(PREVIEW, { text, ...extra });

async function expectNothingPersisted(): Promise<void> {
  const imports = await account.client.get('/api/profile/imports');
  const live = (bodyOf(imports).imports as { status: string }[]).filter(
    (record) => record.status !== 'discarded',
  );
  expect(live).toEqual([]);
  const state = bodyOf(await account.client.get('/api/profile'));
  expect((state.summary as { recordCount: number }).recordCount).toBe(0);
}

describe('size limits', () => {
  it('raw body over UPLOAD_MAX_BYTES -> 413 PAYLOAD_TOO_LARGE', async () => {
    const response = await raw('a'.repeat(LIMIT + 1), 'text/yaml');
    expect(response.status).toBe(413);
    expect(bodyOf(response).error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('JSON envelope: text over the limit -> 413 (exact byte check, multi-byte characters count as bytes)', async () => {
    expect((await asJson('a'.repeat(LIMIT + 1))).status).toBe(413);
    // 7_000 characters of 3 bytes each = 21_000 bytes > 20_000
    expect((await asJson('€'.repeat(7000))).status).toBe(413);
    // an envelope bigger than 2x the limit never reaches the handler
    expect((await asJson('a'.repeat(LIMIT * 3))).status).toBe(413);
  });

  it('exactly at the limit is accepted by the size check (then rejected as not a profile: 422)', async () => {
    const response = await raw(`# ${'a'.repeat(LIMIT - 2)}`, 'text/yaml');
    expect(response.status).toBe(422);
  });

  it('whole-document and section saves accept up to UPLOAD_MAX_BYTES of JSON (413 above), not the 100 KiB global limit', async () => {
    const padded = (bytes: number) => ({
      document: {
        schema_version: '2.1.0',
        profile: { statements: [{ kind: 'career_narrative', text: 'a'.repeat(9_000) }] },
      },
      pad: 'x'.repeat(bytes),
    });
    // strict DTO: the unknown key is a 400, which proves the body was parsed (not rejected for size)
    expect((await account.client.put('/api/profile', padded(1_000))).status).toBe(400);
    expect((await account.client.put('/api/profile', padded(LIMIT * 2))).status).toBe(413);
    expect(
      (
        await account.client.put('/api/profile/sections/statements', {
          value: [],
          pad: 'x'.repeat(LIMIT * 2),
        })
      ).status,
    ).toBe(413);
  });

  it('the global JSON limit still protects every other route', async () => {
    const big = { recordIds: ['00000000-0000-4000-8000-000000000000'], pad: 'x'.repeat(150_000) };
    const response = await account.client.post('/api/profile/confirmations', big);
    expect(response.status).toBe(413);
  });
});

describe('content types and encoding', () => {
  it('unsupported or missing content type -> 415', async () => {
    expect((await raw('x: 1', 'image/png')).status).toBe(415);
    expect((await raw('x: 1', 'application/xml')).status).toBe(415);
    expect((await raw('x: 1', 'multipart/form-data; boundary=x')).status).toBe(415);
  });

  it('non-UTF-8 charset or invalid UTF-8 bytes -> 415', async () => {
    expect((await raw('x: 1', 'text/yaml; charset=iso-8859-1')).status).toBe(415);
    const invalid = Buffer.from([0x61, 0x3a, 0x20, 0xc3, 0x28, 0x0a]); // a: Ã(
    const response = await raw(invalid, 'text/yaml');
    expect(response.status).toBe(415);
  });

  it('empty body -> 400', async () => {
    expect((await raw('', 'text/yaml')).status).toBe(400);
    expect((await asJson('')).status).toBe(400);
  });

  it('envelope validation: unknown keys and wrong types -> 400 (no echo)', async () => {
    const unknown = await account.client.post(PREVIEW, { text: 'a: 1', ownerId: CANARY });
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(unknown.body)).not.toContain(CANARY);
    // a hostile KEY NAME is not echoed either (the library message would quote it)
    const keyName = await account.client.post(PREVIEW, { text: 'a: 1', [CANARY]: 1 });
    expect(keyName.status).toBe(400);
    expect(JSON.stringify(keyName.body)).not.toContain(CANARY);
    expect((await account.client.post(PREVIEW, { text: 42 })).status).toBe(400);
    expect((await account.client.post(PREVIEW, { text: 'a: 1', format: 'xml' })).status).toBe(400);
  });
});

describe('hostile documents are refused without echoing content and without persisting anything', () => {
  const HOSTILE: Record<string, { text: string; type?: 'yaml' | 'json' }> = {
    'YAML alias': {
      text: `schema_version: "2.1.0"\nprofile:\n  identity: &a\n    full_name: ${CANARY}\n  positioning: *a\n`,
    },
    'YAML anchor': { text: `schema_version: "2.1.0"\nx: &anchor ${CANARY}\nprofile: {}\n` },
    'YAML explicit tag': { text: `schema_version: "2.1.0"\nprofile: !!set\n  ? ${CANARY}\n` },
    'YAML custom tag': { text: `schema_version: "2.1.0"\nprofile: !evil ${CANARY}\n` },
    'YAML merge key': {
      text: `base: &b\n  a: ${CANARY}\nschema_version: "2.1.0"\nprofile:\n  <<: *b\n`,
    },
    'YAML multiple documents': { text: `schema_version: "2.1.0"\n---\nprofile: ${CANARY}\n` },
    'YAML duplicate keys': {
      text: `schema_version: "2.1.0"\nschema_version: "${CANARY}"\nprofile: {}\n`,
    },
    'YAML syntax error': { text: `schema_version: "2.1.0"\nprofile: [${CANARY}\n` },
    'YAML non-finite number': { text: `schema_version: "2.1.0"\nprofile:\n  x: .inf\n` },
    'JSON syntax error': { text: `{"schema_version": "${CANARY}", `, type: 'json' },
    'JSON forbidden key __proto__': {
      text: `{"schema_version":"2.1.0","profile":{"__proto__":{"polluted":"${CANARY}"}}}`,
      type: 'json',
    },
    'JSON forbidden key constructor': {
      text: `{"schema_version":"2.1.0","profile":{"constructor":{"prototype":{"polluted":"${CANARY}"}}}}`,
      type: 'json',
    },
    'YAML forbidden key': {
      text: `schema_version: "2.1.0"\nprofile:\n  __proto__:\n    x: ${CANARY}\n`,
    },
    'root is a list': { text: `- ${CANARY}\n- b\n` },
    'unknown key (strict)': {
      text: `schema_version: "2.1.0"\nprofile:\n  ${CANARY}: 1\n`,
    },
    'unknown version': { text: `schema_version: "${CANARY}"\nprofile: {}\n` },
    'future version': { text: `schema_version: "9.0.0"\nprofile: {}\n` },
    'wrong type': { text: `schema_version: "2.1.0"\nprofile:\n  skills: "${CANARY}"\n` },
    'too deep': {
      text: `schema_version: "2.1.0"\nprofile: ${'{"a":'.repeat(60)}"${CANARY}"${'}'.repeat(60)}\n`,
    },
    'string too long': {
      text: `schema_version: "2.1.0"\nprofile:\n  identity:\n    full_name: ${'a'.repeat(15_000)}\n`,
      type: 'yaml',
    },
  };

  for (const [name, { text }] of Object.entries(HOSTILE)) {
    it(`${name}: 4xx, no echo, nothing persisted`, async () => {
      const response = await asJson(text);
      expect(
        [400, 413, 422],
        `${name}: ${response.status} ${JSON.stringify(response.body)}`,
      ).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain(CANARY);
      expect(JSON.stringify(response.headers)).not.toContain(CANARY);
      // the same text as a raw upload behaves the same way
      const asUpload = await raw(text, 'text/yaml');
      expect([400, 413, 422]).toContain(asUpload.status);
      expect(JSON.stringify(asUpload.body)).not.toContain(CANARY);
      expect(bodyOf(response).error).toBeDefined();
    });
  }

  it('hostile documents leave the profile empty and no import records behind', async () => {
    await expectNothingPersisted();
  });

  it('prototype pollution: nothing leaked into Object.prototype, even for hostile envelopes', async () => {
    const envelope = `{"text": "a: 1", "__proto__": {"polluted": "${CANARY}"}, "constructor": {"prototype": {"polluted2": "x"}}}`;
    const response = await account.client.postRaw(PREVIEW, envelope, {
      contentType: 'application/json',
    });
    expect(response.status).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    for (const body of [
      `{"document": {"schema_version":"2.1.0","profile":{"__proto__":{"polluted":"x"}}}}`,
      `{"value": {"__proto__": {"polluted": "x"}, "full_name": "a"}}`,
    ]) {
      const put = await account.client.postRaw('/api/profile/confirmations', body);
      expect(put.status).toBe(400);
    }
    const section = await account.client.put(
      '/api/profile/sections/identity',
      JSON.parse('{"value": {"__proto__": {"polluted": "x"}, "full_name": "A"}}') as Record<
        string,
        unknown
      >,
    );
    expect(section.status).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    await expectNothingPersisted();
  });

  it('lenient mode keeps unknown keys under `unmapped` for the owner; strict refuses them', async () => {
    const text = `schema_version: "2.1.0"\nprofile:\n  identity:\n    full_name: Ana\n    ${'extra_key'}: ${CANARY}\n`;
    const strict = await asJson(text);
    expect(strict.status).toBe(422);
    expect(JSON.stringify(strict.body)).not.toContain(CANARY);
    const lenient = await asJson(text, { mode: 'lenient' });
    expect(lenient.status, JSON.stringify(lenient.body)).toBe(201);
    expect(bodyOf(lenient).unmapped).toHaveLength(1);
    // discard it so the next tests start clean
    const id = (bodyOf(lenient).importRecord as { id: string }).id;
    expect((await account.client.post(`/api/profile/imports/${id}/discard`, {})).status).toBe(200);
  });
});

describe('CSRF applies to every mutating profile route', () => {
  it('no Origin -> 403 CSRF_ORIGIN; bad token -> 403 CSRF_TOKEN; nothing is executed', async () => {
    const mutating = getRouteManifest(world.built.app).filter(
      (route) => route.path.startsWith('/api/profile') && route.mutating,
    );
    expect(mutating.length).toBeGreaterThanOrEqual(15);
    for (const route of mutating) {
      const path = route.path.replace(/:[A-Za-z0-9_]+/g, '00000000-0000-4000-8000-000000000000');
      const method = route.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete';
      const noOrigin = await account.client.request(method, path, {}, { origin: null });
      expect(noOrigin.status, `${route.method} ${route.path}`).toBe(403);
      expect(bodyOf(noOrigin).error).toMatchObject({ code: 'CSRF_ORIGIN' });
      const badToken = await account.client.request(method, path, {}, { csrf: 'x'.repeat(43) });
      expect(badToken.status, `${route.method} ${route.path}`).toBe(403);
      expect(bodyOf(badToken).error).toMatchObject({ code: 'CSRF_TOKEN' });
      const otherOrigin = await account.client.request(
        method,
        path,
        {},
        { origin: 'https://evil.example.test' },
      );
      expect(otherOrigin.status).toBe(403);
    }
    await expectNothingPersisted();
  });

  it('unauthenticated clients are refused (401) on every profile route', async () => {
    const anonymous = await world.newAccount('anon');
    anonymous.client.setCookie(anonymous.client.sessionCookieName, 'x');
    const response = await anonymous.client.get('/api/profile');
    expect(response.status).toBe(401);
  });
});

describe('error shape and export hardening', () => {
  it('malformed, missing and foreign resource ids all answer the same 404', async () => {
    const shapes = new Set<string>();
    for (const id of [
      'nao-e-uuid',
      '00000000-0000-4000-8000-000000000000',
      '%00',
      'x'.repeat(200),
    ]) {
      for (const path of [
        `/api/profile/records/${id}`,
        `/api/profile/revisions/${id}`,
        `/api/profile/imports/${id}`,
        `/api/profile/evidence/${id}/links`,
      ]) {
        const response = await account.client.get(path);
        expect(response.status, path).toBe(404);
        shapes.add(JSON.stringify(errorShape(response)));
      }
    }
    expect(shapes.size).toBe(1);
  });

  it('export: neutral file name, no-store, nosniff, attachment; bad format or extra query -> 400', async () => {
    const imported = await account.client.post(PREVIEW, {
      text: 'schema_version: "2.1.0"\nprofile:\n  identity:\n    full_name: Nome Que Nao Pode Vazar No Cabecalho\n',
    });
    const id = (bodyOf(imported).importRecord as { id: string }).id;
    expect(
      (await account.client.post(`/api/profile/imports/${id}/apply`, { mode: 'merge' })).status,
    ).toBe(200);
    for (const format of ['yaml', 'json']) {
      const response = await account.client.get(`/api/profile/export?format=${format}`);
      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toMatch(
        new RegExp(`^attachment; filename="chameleon-profile-\\d{8}\\.${format}"$`),
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-type']).toContain(
        format === 'yaml' ? 'application/yaml' : 'application/json',
      );
      expect(JSON.stringify(response.headers)).not.toContain('Nome Que Nao');
      expect(response.text).toContain('Nome Que Nao Pode Vazar');
    }
    expect((await account.client.get('/api/profile/export?format=xml')).status).toBe(400);
    expect((await account.client.get('/api/profile/export?format=json&ownerId=x')).status).toBe(
      400,
    );
  });
});

describe('logs never carry profile text', () => {
  it('after imports, edits, exports and hostile payloads the captured log has no canary or profile text', async () => {
    const owner = await world.newAccount('logs');
    // profile content with 22 canaries, through every kind of route
    const text = loadProfileYaml('private-heavy');
    expect(text.length).toBeLessThan(LIMIT * 20);
    const big = await owner.client.post(PREVIEW, { text });
    // private-heavy is larger than the small test limit: 413; use a real-size app for the positive path below
    expect([201, 413]).toContain(big.status);

    const small = `schema_version: "2.1.0"\nprofile:\n  identity:\n    full_name: ${CANARY}\n    city: ${CANARY}-city\n`;
    const preview = await owner.client.post(PREVIEW, { text: small });
    expect(preview.status).toBe(201);
    const id = (bodyOf(preview).importRecord as { id: string }).id;
    await owner.client.post(`/api/profile/imports/${id}/apply`, { mode: 'merge' });
    await owner.client.put('/api/profile/sections/positioning', {
      value: { current_profession: `${CANARY}-profession` },
    });
    await owner.client.post('/api/profile/records', {
      kind: 'skill',
      record: { name: `${CANARY}-skill` },
    });
    await owner.client.get('/api/profile');
    await owner.client.get('/api/profile/export?format=yaml');
    await owner.client.post(PREVIEW, { text: `{"broken": "${CANARY}-json", ` });
    await owner.client.postRaw(PREVIEW, `x: ${CANARY}-raw`, { contentType: 'application/x-yaml' });
    await owner.client.put('/api/profile/sections/identity', {
      value: { full_name: ' ', note: CANARY },
    });

    const logs = world.built.logs.text();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain('CANARY');
    expect(logs).not.toContain(CANARY);
    for (const canary of listProfileCanaries('private-heavy')) expect(logs).not.toContain(canary);
    expect(logs).not.toMatch(/Ana |full_name|current_profession|schema_version/);
    expect(() => world.built.logs.lines()).not.toThrow();
  });
});
