import { describe, expect, it } from 'vitest';
import { OwnerScopeViolationError } from '../src/errors';
import { assertOwnerId, scopeArgs as scopeArgsWith } from '../src/for-owner';

const A = '0197a1a4-5fd2-737e-8c2c-471c8423221a';
const B = '0197a1a4-5fd2-7bbb-8c2c-471c8423221b';

/** Relacoes de um modelo ficticio; a bateria por relacao esta em `for-owner-relations.test.ts`. */
const RELATIONS: ReadonlySet<string> = new Set(['owner', 'profile']);
const scopeArgs = (operation: string, args: unknown, ownerId: string) =>
  scopeArgsWith(operation, args, ownerId, RELATIONS);

describe('assertOwnerId', () => {
  it.each([undefined, null, '', 'abc', 123, '0197a1a4-5fd2-737e-8c2c'])('recusa %s', (value) => {
    expect(() => assertOwnerId(value)).toThrow(OwnerScopeViolationError);
  });
  it('aceita UUID', () => {
    expect(() => assertOwnerId(A)).not.toThrow();
  });
});

describe('scopeArgs: leituras e escritas por where', () => {
  it.each([
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'count',
    'aggregate',
    'groupBy',
    'updateMany',
    'deleteMany',
  ])('%s sem where recebe { ownerId }', (op) => {
    expect(scopeArgs(op, undefined, A).where).toEqual({ ownerId: A });
    expect(scopeArgs(op, {}, A).where).toEqual({ ownerId: A });
  });

  it('preserva o where do chamador e injeta ownerId (inclusive com OR no topo)', () => {
    const args = scopeArgs('findMany', { where: { OR: [{ a: 1 }, { b: 2 }] }, take: 5 }, A);
    expect(args).toEqual({ where: { OR: [{ a: 1 }, { b: 2 }], ownerId: A }, take: 5 });
  });

  it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete'])(
    '%s estende o where unico com ownerId',
    (op) => {
      const args = scopeArgs(op, { where: { id: 'x' }, data: { name: 'y' } }, A);
      expect(args.where).toEqual({ id: 'x', ownerId: A });
    },
  );

  it('aceita ownerId igual ao do escopo', () => {
    expect(scopeArgs('findMany', { where: { ownerId: A } }, A).where).toEqual({ ownerId: A });
  });

  it('recusa ownerId de outro dono (string) em qualquer operacao com where', () => {
    for (const op of ['findMany', 'findUnique', 'update', 'delete', 'deleteMany', 'count']) {
      expect(() => scopeArgs(op, { where: { id: 'x', ownerId: B } }, A)).toThrow(
        OwnerScopeViolationError,
      );
    }
  });

  it('filtro composto em ownerId vira intersecao (nao unica) ou erro (unica)', () => {
    const args = scopeArgs('findMany', { where: { ownerId: { in: [A, B] } } }, A);
    expect(args.where).toEqual({ AND: [{ ownerId: { in: [A, B] } }, { ownerId: A }] });
    expect(() => scopeArgs('findUnique', { where: { id: 'x', ownerId: { in: [B] } } }, A)).toThrow(
      OwnerScopeViolationError,
    );
  });

  it('where undefined explicito em ownerId e sobrescrito', () => {
    expect(scopeArgs('findFirst', { where: { ownerId: undefined, id: 'x' } }, A).where).toEqual({
      id: 'x',
      ownerId: A,
    });
  });

  it('nao muta os argumentos do chamador', () => {
    const where = { id: 'x' };
    scopeArgs('findFirst', { where }, A);
    expect(where).toEqual({ id: 'x' });
  });

  it('update/updateMany recusam alterar o ownerId', () => {
    expect(() => scopeArgs('update', { where: { id: 'x' }, data: { ownerId: B } }, A)).toThrow(
      OwnerScopeViolationError,
    );
    expect(() => scopeArgs('updateMany', { data: { ownerId: A } }, A)).toThrow(
      OwnerScopeViolationError,
    );
    expect(() =>
      scopeArgs('update', { where: { id: 'x' }, data: { owner: { connect: { id: B } } } }, A),
    ).toThrow(OwnerScopeViolationError);
  });
});

describe('scopeArgs: criacao e upsert', () => {
  it('create injeta ownerId', () => {
    expect(scopeArgs('create', { data: { a: 1 } }, A).data).toEqual({ a: 1, ownerId: A });
  });

  it('create aceita ownerId igual e recusa diferente ou a relacao owner', () => {
    expect(scopeArgs('create', { data: { ownerId: A } }, A).data).toEqual({ ownerId: A });
    expect(() => scopeArgs('create', { data: { ownerId: B } }, A)).toThrow(
      OwnerScopeViolationError,
    );
    expect(() => scopeArgs('create', { data: { owner: { connect: { id: A } } } }, A)).toThrow(
      OwnerScopeViolationError,
    );
  });

  it('create sem data e invalido', () => {
    expect(() => scopeArgs('create', {}, A)).toThrow(OwnerScopeViolationError);
  });

  it('createMany injeta em cada linha (array) e aceita objeto unico', () => {
    expect(scopeArgs('createMany', { data: [{ a: 1 }, { a: 2 }] }, A).data).toEqual([
      { a: 1, ownerId: A },
      { a: 2, ownerId: A },
    ]);
    expect(scopeArgs('createMany', { data: { a: 1 } }, A).data).toEqual({ a: 1, ownerId: A });
    expect(scopeArgs('createManyAndReturn', { data: [] }, A).data).toEqual([]);
  });

  it('createMany recusa uma linha de outro dono (e nao deixa passar parcialmente)', () => {
    expect(() => scopeArgs('createMany', { data: [{ a: 1 }, { ownerId: B }] }, A)).toThrow(
      OwnerScopeViolationError,
    );
  });

  it('upsert escopa where e create e protege update', () => {
    const args = scopeArgs('upsert', { where: { id: 'x' }, create: { a: 1 }, update: { a: 2 } }, A);
    expect(args).toEqual({
      where: { id: 'x', ownerId: A },
      create: { a: 1, ownerId: A },
      update: { a: 2 },
    });
    expect(() =>
      scopeArgs('upsert', { where: { id: 'x' }, create: {}, update: { ownerId: B } }, A),
    ).toThrow(OwnerScopeViolationError);
  });
});

describe('scopeArgs: fail closed', () => {
  it.each(['findRaw', 'aggregateRaw', 'qualquerCoisa', ''])(
    'operacao desconhecida "%s" e recusada',
    (op) => {
      expect(() => scopeArgs(op, {}, A)).toThrow(OwnerScopeViolationError);
    },
  );
});
