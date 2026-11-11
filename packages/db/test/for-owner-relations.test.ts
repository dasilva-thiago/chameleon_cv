import { describe, expect, it } from 'vitest';
import { NestedRelationWriteError, OwnerScopeViolationError } from '../src/errors';
import { relationFieldsOfClient, scopeArgs } from '../src/for-owner';
import { GLOBAL_MODELS, PRIVATE_MODELS } from '../src/private-models';

/**
 * Escrita por RELACAO em forOwner (defeito da S1.4): `connect` troca `(profileId, ownerId)` juntos e
 * movia a linha para outro dono. A camada de aplicacao rejeita QUALQUER relacao com valor em `data`.
 */
const A = '0197a1a4-5fd2-737e-8c2c-471c8423221a';
const B = '0197a1a4-5fd2-7bbb-8c2c-471c8423221b';
const ID = '0197a1a4-5fd2-7ccc-8c2c-471c8423221c';

const RELATIONS: ReadonlySet<string> = new Set(['profile', 'revision', 'items', 'owner']);

/** Todas as operacoes de relacao aninhada do Prisma (to-one e to-many). */
const NESTED_OPS: Record<string, unknown> = {
  connect: { id: ID },
  connectOrCreate: { where: { id: ID }, create: {} },
  create: {},
  createMany: { data: [{}] },
  set: [{ id: ID }],
  disconnect: true,
  delete: true,
  update: { data: {} },
  upsert: { create: {}, update: {}, where: {} },
  updateMany: { where: {}, data: {} },
  deleteMany: {},
};

/** Operacoes de escrita e como montar os argumentos com um `data` de teste. */
const WRITE_CASES: [string, (data: unknown) => unknown][] = [
  ['create', (data) => ({ data })],
  ['createMany', (data) => ({ data: [data] })],
  ['createManyAndReturn', (data) => ({ data: [{ ok: 1 }, data] })],
  ['update', (data) => ({ where: { id: ID }, data })],
  ['updateMany', (data) => ({ where: {}, data })],
  ['updateManyAndReturn', (data) => ({ where: {}, data })],
  ['upsert (update)', (data) => ({ where: { id: ID }, create: { ok: 1 }, update: data })],
  ['upsert (create)', (data) => ({ where: { id: ID }, create: data, update: { ok: 1 } })],
];
const opName = (label: string): string => label.split(' ')[0]!;

describe('scopeArgs: escrita por relacao e rejeitada (fail closed)', () => {
  for (const [label, build] of WRITE_CASES) {
    describe(label, () => {
      it.each(Object.entries(NESTED_OPS))(
        'relacao com %s lanca NestedRelationWriteError',
        (_n, v) => {
          for (const relation of ['profile', 'revision', 'items']) {
            const args = build({ [relation]: { [_n]: v } });
            expect(() => scopeArgs(opName(label), args, A, RELATIONS)).toThrow(
              NestedRelationWriteError,
            );
          }
        },
      );

      it('rejeita a relacao independente do formato do valor (null, true, array, string)', () => {
        for (const value of [null, true, [], [{ connect: { id: ID } }], 'x', 0]) {
          expect(() => scopeArgs(opName(label), build({ profile: value }), A, RELATIONS)).toThrow(
            NestedRelationWriteError,
          );
        }
      });

      it('o erro nomeia a relacao e e um OwnerScopeViolationError', () => {
        let caught: unknown;
        try {
          scopeArgs(opName(label), build({ profile: { connect: { id: ID } } }), A, RELATIONS);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(OwnerScopeViolationError);
        expect(caught).toMatchObject({ name: 'NestedRelationWriteError', relation: 'profile' });
        expect((caught as Error).message).toContain('profile');
      });

      it('permite escalar xId (formato unchecked), JSON com chave "connect" e relacao undefined', () => {
        const data = {
          profileId: ID,
          details: { connect: { id: ID }, create: [], set: 1 },
          profile: undefined,
          revisionId: undefined,
        };
        expect(() => scopeArgs(opName(label), build(data), A, RELATIONS)).not.toThrow();
      });
    });
  }

  it('createMany: UMA linha ruim derruba o lote inteiro', () => {
    expect(() =>
      scopeArgs(
        'createMany',
        { data: [{ profileId: ID }, { profile: { connect: { id: ID } } }] },
        A,
        RELATIONS,
      ),
    ).toThrow(NestedRelationWriteError);
  });

  it('o mesmo data e aceito quando o campo nao e relacao daquele modelo', () => {
    const data = { profile: { connect: { id: ID } } };
    expect(() => scopeArgs('update', { where: { id: ID }, data }, A, new Set())).not.toThrow();
  });

  it('a relacao `owner` continua com o erro especifico e `data.ownerId` de outro dono tambem', () => {
    expect(() =>
      scopeArgs('create', { data: { owner: { connect: { id: B } } } }, A, RELATIONS),
    ).toThrow(/owner/);
    expect(() =>
      scopeArgs('update', { where: { id: ID }, data: { ownerId: B } }, A, RELATIONS),
    ).toThrow(OwnerScopeViolationError);
  });

  it('o que e validado e o que segue adiante (copia), sem mutar o que o chamador passou', () => {
    const data = { profileId: ID, label: 'x' };
    const args = { where: { id: ID }, data };
    const out = scopeArgs('update', args, A, RELATIONS);
    expect(out.data).toEqual(data);
    expect(out.data).not.toBe(data);
    expect(args.data).toBe(data);
    expect(data).toEqual({ profileId: ID, label: 'x' });
  });

  it('upsert devolve update validado e create com ownerId injetado', () => {
    const out = scopeArgs(
      'upsert',
      { where: { id: ID }, create: { profileId: ID }, update: { label: 'y' } },
      A,
      RELATIONS,
    );
    expect(out).toEqual({
      where: { id: ID, ownerId: A },
      create: { profileId: ID, ownerId: A },
      update: { label: 'y' },
    });
  });

  it('leituras e deletes nao sao afetados (where/include/select com relacao seguem permitidos)', () => {
    expect(() =>
      scopeArgs(
        'findMany',
        { where: { profile: { is: {} } }, include: { profile: true } },
        A,
        RELATIONS,
      ),
    ).not.toThrow();
    expect(() => scopeArgs('delete', { where: { id: ID } }, A, RELATIONS)).not.toThrow();
  });
});

describe('relationFieldsOfClient', () => {
  const clientWith = (models: unknown): unknown => ({ _runtimeDataModel: { models } });
  const allPrivate = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    // Global models must be present too since S1.5a (the global guard derives their relations).
    ...Object.fromEntries(
      [...PRIVATE_MODELS, ...Object.keys(GLOBAL_MODELS)].map((m) => [m, { fields: [] }]),
    ),
    ...extra,
  });

  it('extrai somente os campos kind "object"', () => {
    const map = relationFieldsOfClient(
      clientWith(
        allPrivate({
          Resume: {
            fields: [
              { name: 'id', kind: 'scalar' },
              { name: 'visibility', kind: 'enum' },
              { name: 'profile', kind: 'object' },
              { name: 'details', kind: 'scalar' },
            ],
          },
        }),
      ),
    );
    expect([...map.get('Resume')!]).toEqual(['profile']);
  });

  it.each([undefined, null, {}, { _runtimeDataModel: {} }, { _runtimeDataModel: { models: [] } }])(
    'falha fechada sem modelo de dados (%j)',
    (client) => {
      expect(() => relationFieldsOfClient(client)).toThrow(/Modelo de dados/);
    },
  );

  it('falha se um modelo tem formato invalido ou se falta um modelo privado', () => {
    expect(() =>
      relationFieldsOfClient(clientWith(allPrivate({ Resume: { fields: 'x' } }))),
    ).toThrow(/invalido/);
    const missing = allPrivate();
    delete missing.Resume;
    expect(() => relationFieldsOfClient(clientWith(missing))).toThrow(/ausente/);
    const missingGlobal = allPrivate();
    delete missingGlobal.Invite;
    expect(() => relationFieldsOfClient(clientWith(missingGlobal))).toThrow(
      /Modelo global "Invite" ausente/,
    );
  });
});
