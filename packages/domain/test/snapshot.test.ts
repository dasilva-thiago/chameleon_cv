import { parseProfileDocument, type ProfileDocument } from '@chameleon/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildProfileSnapshot,
  canonicalJson,
  CanonicalJsonError,
  hashProfileDocument,
  indexSnapshotRecords,
  missingSnapshotIds,
  sha256Hex,
  verifyProfileSnapshot,
} from '../src/snapshot';

describe('sha256 (vetores FIPS 180-4)', () => {
  it('vazio, "abc", mensagem de 448 bits e um milhao de "a"', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('codifica UTF-8 (acentos, CJK, emoji)', () => {
    expect(sha256Hex('é')).not.toBe(sha256Hex('e'));
    expect(sha256Hex('😀')).toHaveLength(64);
  });
});

describe('JSON canonico (RFC 8785)', () => {
  it('ordena chaves por unidade de codigo UTF-16, sem espacos', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], '€': 1, é: 2, 10: 3, 9: 4 })).toBe(
      '{"10":3,"9":4,"a":[true,null,"x"],"b":1,"é":2,"€":1}',
    );
  });

  it('numeros no formato ECMAScript; -0 vira 0', () => {
    expect(canonicalJson([1, 1.5, -0, 1e21, 1e-7, 100, 0.1])).toBe('[1,1.5,0,1e+21,1e-7,100,0.1]');
  });

  it('strings com escapes minimos do JSON', () => {
    expect(canonicalJson('a"b\\c\n\u0001\u007f')).toBe('"a\\"b\\\\c\\n\\u0001\u007f"');
  });

  it('omite undefined em objetos e rejeita o que nao e JSON', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(() => canonicalJson([undefined])).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(Infinity)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(new Date())).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(1n)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson('\ud800')).toThrow(CanonicalJsonError);
  });
});

const id = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const doc = (profile: Record<string, unknown>): ProfileDocument =>
  parseProfileDocument({ schema_version: '2.1.0', profile });

describe('snapshot do perfil', () => {
  const base = doc({
    identity: { full_name: 'Ana' },
    experiences: [
      { id: id(1), official_title: 'T', items: [{ id: id(2), kind: 'responsibility', text: 'x' }] },
    ],
    awards: [],
  });

  it('hash independe da ordem das chaves e de chaves nulas', () => {
    const reordered = {
      profile: {
        awards: [],
        experiences: base.profile.experiences,
        identity: { full_name: 'Ana' },
      },
      schema_version: '2.1.0',
    } as unknown as ProfileDocument;
    const withNull = {
      ...base,
      locale: null,
      profile: { ...base.profile, identity: { full_name: 'Ana', pronouns: null } },
    } as unknown as ProfileDocument;
    expect(hashProfileDocument(reordered)).toBe(hashProfileDocument(base));
    expect(hashProfileDocument(withNull)).toBe(hashProfileDocument(base));
  });

  it('[] e ausencia sao semanticas diferentes e hashes diferentes (ADR-0005)', () => {
    const withoutAwards = doc({
      identity: { full_name: 'Ana' },
      experiences: base.profile.experiences,
    });
    expect(hashProfileDocument(withoutAwards)).not.toBe(hashProfileDocument(base));
  });

  it('qualquer mudanca de conteudo muda o hash; o hash tem 64 hex', () => {
    const changed = doc({ ...base.profile, identity: { full_name: 'Ana B' } });
    expect(hashProfileDocument(changed)).not.toBe(hashProfileDocument(base));
    expect(hashProfileDocument(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('buildProfileSnapshot e verifyProfileSnapshot', () => {
    const snapshot = buildProfileSnapshot(base);
    expect(snapshot.schemaVersion).toBe('2.1.0');
    expect(snapshot.contentHash).toBe(hashProfileDocument(base));
    expect(verifyProfileSnapshot(snapshot)).toBe(true);
    const tampered = {
      ...snapshot,
      document: doc({ identity: { full_name: 'Outra' } }),
    };
    expect(verifyProfileSnapshot(tampered)).toBe(false);
  });

  it('indice de ids do snapshot (para sourceFactIds) e ids ausentes', () => {
    const index = indexSnapshotRecords(base);
    expect(index.get(id(1))).toEqual({ kind: 'experience', path: 'profile.experiences[0]' });
    expect(index.get(id(2))).toEqual({
      kind: 'experience_item',
      path: 'profile.experiences[0].items[0]',
    });
    expect(missingSnapshotIds(base, [id(1), id(9)])).toEqual([id(9)]);
  });
});
