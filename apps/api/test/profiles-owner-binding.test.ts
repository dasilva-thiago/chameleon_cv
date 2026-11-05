import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProfileStore } from '@chameleon/db';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/http/errors';
import {
  OwnerLocks,
  OwnerQuota,
  PreviewCache,
  bindProfileStore,
  type PreviewEntry,
} from '../src/modules/profiles/scope';

const DIR = fileURLToPath(new URL('../src/modules/profiles/', import.meta.url));
const files = readdirSync(DIR).filter((name) => name.endsWith('.ts'));
const source = (name: string): string => readFileSync(`${DIR}${name}`, 'utf8');

/** Strips comments so documentation can mention the forbidden names. */
const code = (name: string): string =>
  source(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';

describe('owner binding is structural (Phase 1 gate, condition 2)', () => {
  it('the module has the files this test reasons about', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'scope.ts',
        'gate.ts',
        'index.ts',
        'routes-records.ts',
        'routes-imports.ts',
      ]),
    );
  });

  it('`ownerId` appears only in scope.ts (the binder) and gate.ts (consent check), always as `auth.ownerId`', () => {
    const offenders = files.filter(
      (name) => code(name).includes('ownerId') && !['scope.ts', 'gate.ts'].includes(name),
    );
    expect(offenders).toEqual([]);
    for (const name of ['scope.ts', 'gate.ts']) {
      const mentions = code(name).match(/[\w.]*ownerId[\w]*/g) ?? [];
      for (const mention of mentions) {
        expect(
          ['auth.ownerId', 'ownerId', 'owner'].includes(mention) || mention.endsWith('.ownerId'),
          mention,
        ).toBe(true);
      }
    }
    // in the gate the id can only come from the authenticated context
    expect(code('gate.ts')).toMatch(/hasGrantedConsent\(auth\.db, auth\.ownerId,/);
  });

  it('`req.auth` / `requireAuthContext` are used only by scope.ts and gate.ts', () => {
    const offenders = files.filter(
      (name) =>
        /req\.auth|requireAuthContext|\.auth\b/.test(code(name)) &&
        !['scope.ts', 'gate.ts'].includes(name),
    );
    expect(offenders).toEqual([]);
  });

  it('the raw ProfileStore reaches only the composition (index.ts) and the binder (scope.ts)', () => {
    const offenders = files.filter(
      (name) =>
        /\bprofileStore\b|\bProfileStore\b/.test(code(name)) &&
        !['scope.ts', 'index.ts'].includes(name),
    );
    expect(offenders).toEqual([]);
    // handlers only ever use the scope: `scopeOf(res)`
    for (const name of files.filter((n) => n.startsWith('routes-'))) {
      expect(code(name), name).toMatch(/scopeOf\(res\)/);
      expect(code(name), name).not.toMatch(/params\.owner|body\.owner|query\.owner|ownerId/i);
    }
  });

  it('every route is declared through the gated group, never through the bare registry', () => {
    for (const name of files.filter((n) => n.startsWith('routes-'))) {
      expect(code(name), name).not.toMatch(/\broutes\.(get|post|put|patch|delete)\(/);
      expect(code(name), name).not.toMatch(/router\.(get|post|put|patch|delete)\(/);
      expect(code(name), name).not.toMatch(/auth:\s*'public'/);
    }
    // gate.ts is the only place that talks to the registry, and it always declares session routes
    expect(code('gate.ts')).toMatch(/auth: 'session'/);
    expect(code('gate.ts')).not.toMatch(/auth: 'public'/);
  });

  it('no request DTO of the module reads an owner or profile identifier from params, query or body', () => {
    for (const name of files) {
      expect(code(name), name).not.toMatch(/req\.(params|query|body)\.(owner|profile)Id/);
    }
  });
});

describe('bindProfileStore closes over the owner', () => {
  function recorder() {
    const calls: { method: string; args: unknown[] }[] = [];
    const proxy = new Proxy(
      {},
      {
        get:
          (_target, method: string) =>
          (...args: unknown[]) => {
            calls.push({ method, args });
            return Promise.resolve(null);
          },
      },
    ) as ProfileStore;
    return { calls, store: proxy };
  }

  it('every method passes the bound owner first and never anything else in that position', async () => {
    const { calls, store } = recorder();
    const bound = bindProfileStore(store, OWNER_A);
    await bound.loadProfileDocument();
    await bound.saveProfileDocument(
      { schema_version: '2.1.0', profile: {} },
      { onMissing: 'keep' },
    );
    await bound.createRevision({ reason: 'manual_save' });
    await bound.listRevisions({ limit: 3 });
    await bound.getRevision('r1');
    await bound.createImportRecord({} as never);
    await bound.applyImport({ document: {} as never, report: {} as never });
    await bound.discardImport('i1');
    await bound.listImportRecords({ limit: 1 });
    await bound.getImportIdMap();
    expect(calls).toHaveLength(10);
    expect(calls.map((call) => call.args[0])).toEqual(Array(10).fill(OWNER_A));
  });

  it('a profileId smuggled at runtime is dropped (the facade only addresses the primary profile)', async () => {
    const { calls, store } = recorder();
    const bound = bindProfileStore(store, OWNER_A);
    await bound.saveProfileDocument({}, { profileId: 'x', onMissing: 'keep' } as never);
    await bound.createRevision({ profileId: 'x', reason: 'manual_save' } as never);
    await bound.applyImport({
      profileId: 'x',
      document: {} as never,
      report: {} as never,
    } as never);
    await bound.listImportRecords({ profileId: 'x', limit: 1 } as never);
    for (const call of calls) {
      expect(JSON.stringify(call.args)).not.toContain('"profileId"');
    }
  });

  it('two bound stores never mix owners', async () => {
    const { calls, store } = recorder();
    const a = bindProfileStore(store, OWNER_A);
    const b = bindProfileStore(store, OWNER_B);
    await Promise.all([a.getImportIdMap(), b.getImportIdMap(), a.loadProfileDocument()]);
    expect(calls.map((c) => c.args[0])).toEqual([OWNER_A, OWNER_B, OWNER_A]);
  });
});

describe('PreviewCache', () => {
  const entry = (): Omit<PreviewEntry, 'expiresAt'> => ({
    document: {} as never,
    report: {} as never,
    preview: {} as never,
  });

  it('is keyed by owner: the same import id under another owner is a miss', () => {
    const cache = new PreviewCache({ ttlMs: 1000, maxPerOwner: 5, maxTotal: 10 });
    cache.put(OWNER_A, 'imp-1', entry());
    expect(cache.get(OWNER_A, 'imp-1')).toBeDefined();
    expect(cache.get(OWNER_B, 'imp-1')).toBeUndefined();
    cache.delete(OWNER_B, 'imp-1');
    expect(cache.get(OWNER_A, 'imp-1')).toBeDefined();
    cache.delete(OWNER_A, 'imp-1');
    expect(cache.get(OWNER_A, 'imp-1')).toBeUndefined();
  });

  it('expires entries and sweeps them', () => {
    let now = 1000;
    const cache = new PreviewCache({ ttlMs: 100, maxPerOwner: 5, maxTotal: 10 }, () => now);
    const stored = cache.put(OWNER_A, 'imp-1', entry());
    expect(stored.expiresAt).toBe(1100);
    now = 1099;
    expect(cache.get(OWNER_A, 'imp-1')).toBeDefined();
    now = 1100;
    expect(cache.get(OWNER_A, 'imp-1')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('is bounded per owner (oldest evicted) and in total', () => {
    const cache = new PreviewCache({ ttlMs: 10_000, maxPerOwner: 2, maxTotal: 3 });
    cache.put(OWNER_A, 'a1', entry());
    cache.put(OWNER_A, 'a2', entry());
    cache.put(OWNER_A, 'a3', entry());
    expect(cache.get(OWNER_A, 'a1')).toBeUndefined();
    expect(cache.get(OWNER_A, 'a2')).toBeDefined();
    cache.put(OWNER_B, 'b1', entry());
    expect(cache.size).toBe(3);
    cache.put(OWNER_B, 'b2', entry());
    expect(cache.size).toBeLessThanOrEqual(3);
    // one owner can never evict ... another owner's entries beyond the global cap only by age, never by key guessing
    expect(cache.get(OWNER_B, 'b2')).toBeDefined();
  });
});

describe('OwnerQuota', () => {
  it('counts per owner inside the window, then answers 429 RATE_LIMITED with Retry-After', () => {
    let now = 0;
    const quota = new OwnerQuota({ windowMs: 60_000, max: 2 }, () => now);
    quota.consume(OWNER_A);
    quota.consume(OWNER_A);
    quota.consume(OWNER_B); // another owner has its own budget
    let error: unknown;
    try {
      quota.consume(OWNER_A);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect((error as HttpError).headers?.['Retry-After']).toBe('60');
    now = 60_000;
    expect(() => quota.consume(OWNER_A)).not.toThrow();
  });
});

describe('OwnerLocks', () => {
  it('runs one owner tasks in order, lets a failure pass without blocking the chain, and does not serialize owners', async () => {
    const locks = new OwnerLocks();
    const order: string[] = [];
    const slow = locks.run('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('a1');
    });
    const failing = locks.run('a', () => {
      order.push('a2');
      return Promise.reject(new Error('boom'));
    });
    const after = locks.run('a', () => {
      order.push('a3');
      return Promise.resolve();
    });
    const other = locks.run('b', () => {
      order.push('b1');
      return Promise.resolve();
    });
    await other;
    expect(order).toEqual(['b1']);
    await slow;
    await expect(failing).rejects.toThrow('boom');
    await after;
    expect(order).toEqual(['b1', 'a1', 'a2', 'a3']);
  });
});
