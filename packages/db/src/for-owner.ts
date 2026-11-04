import { Prisma } from './generated/prisma/client';
import { NestedRelationWriteError, OwnerScopeViolationError, UnscopedAccessError } from './errors';
import { PRIVATE_MODELS, isPrivateModel, isPrivateRelationKey } from './private-models';

/**
 * Extensoes de isolamento (ADR-0008, item 2).
 *
 * - `guardExtension`: aplicada ao cliente SEM escopo. Modelo privado -> lanca UnscopedAccessError.
 * - `ownerScopeExtension(ownerId)`: aplicada ao cliente escopado. Injeta `ownerId` em `where`
 *   (leituras, update/delete, count/aggregate/groupBy) e em `data` (create/createMany/upsert) dos
 *   modelos privados; lanca erro ao detectar outro `ownerId` ou tentativa de alterar o `ownerId`.
 *
 * Escrita por RELACAO (`data: { profile: { connect: ... } }`, `create`, `set`, `disconnect`...) em
 * `data` de create/createMany/update/updateMany/upsert e REJEITADA em modelos privados
 * (`NestedRelationWriteError`): o Prisma resolve `connect` trocando `(xId, ownerId)` juntos, o que
 * satisfaz a FK composta e transferia a linha para outro dono. As chaves de relacao vem do modelo de
 * dados do client gerado (nunca escritas a mao). Use os escalares `xId` (formato unchecked): o `ownerId`
 * continua injetado/conferido e a FK composta rejeita pai de outro dono. Defesa em profundidade: o
 * trigger `<Tabela>_owner_immutable` (migracao `owner_immutable`) recusa qualquer UPDATE de `ownerId`.
 *
 * Lacunas conhecidas (R3) -> README. Em resumo: SQL cru nao e filtrado e operacao desconhecida em
 * modelo privado e REJEITADA (fail closed).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertOwnerId(ownerId: unknown): asserts ownerId is string {
  if (typeof ownerId !== 'string' || !UUID_RE.test(ownerId)) {
    throw new OwnerScopeViolationError('forOwner exige um ownerId UUID valido.');
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Nome do modelo -> nomes dos campos de RELACAO (kind `object`) do client gerado. */
export type RelationFields = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Le os campos de relacao do modelo de dados em tempo de execucao do client gerado. O Prisma 7 nao
 * exporta `Prisma.dmmf`; a fonte e `_runtimeDataModel` (interna). Falha fechada se o formato mudar:
 * `test/relation-fields.test.ts` confere o resultado contra os arquivos `prisma/schema/*.prisma`.
 */
export function relationFieldsOfClient(client: unknown): RelationFields {
  const models = (client as { _runtimeDataModel?: { models?: unknown } } | null)?._runtimeDataModel
    ?.models;
  if (!isObject(models)) {
    throw new Error(
      'Modelo de dados do Prisma Client indisponivel: nao e possivel isolar escritas.',
    );
  }
  const result = new Map<string, ReadonlySet<string>>();
  for (const [model, def] of Object.entries(models)) {
    const fields = isObject(def) ? def.fields : undefined;
    if (!Array.isArray(fields)) {
      throw new Error(`Modelo de dados do Prisma Client invalido para "${model}".`);
    }
    const relations = new Set<string>();
    for (const field of fields) {
      if (isObject(field) && field.kind === 'object' && typeof field.name === 'string') {
        relations.add(field.name);
      }
    }
    result.set(model, relations);
  }
  for (const model of PRIVATE_MODELS) {
    if (!result.has(model)) {
      throw new Error(`Modelo privado "${model}" ausente do modelo de dados do Prisma Client.`);
    }
  }
  return result;
}

/** Operacoes com `where` livre (nao unico). */
const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);
/** Operacoes com `where` unico (aceita filtros extras nao unicos desde o Prisma 5). */
const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

function scopeWhere(where: unknown, ownerId: string, unique: boolean): Json {
  if (where === undefined || where === null) {
    // Sem `where`: so valido em operacoes nao unicas (o Prisma exige `where` nas unicas).
    return { ownerId };
  }
  if (!isObject(where)) throw new OwnerScopeViolationError('`where` invalido.');
  const current = where.ownerId;
  if (current === undefined) return { ...where, ownerId };
  if (current === ownerId) return where;
  if (typeof current === 'string' || unique) {
    throw new OwnerScopeViolationError('`where.ownerId` difere do ownerId do escopo.');
  }
  // Filtro composto em ownerId (ex.: { in: [...] }) numa operacao nao unica: intersecao.
  return { AND: [where, { ownerId }] };
}

/**
 * Recusa qualquer relacao com valor definido em `data`: a operacao (connect, create, set...) e
 * irrelevante, pois todas podem mover linhas entre donos ou criar filhos fora do escopo.
 */
function assertNoRelationWrites(data: Json, relationFields: ReadonlySet<string>): void {
  for (const key of Object.keys(data)) {
    if (relationFields.has(key) && data[key] !== undefined) {
      throw new NestedRelationWriteError(key);
    }
  }
}

function scopeData(data: unknown, ownerId: string, relationFields: ReadonlySet<string>): Json {
  if (!isObject(data)) throw new OwnerScopeViolationError('`data` invalido.');
  // Copia unica: o que e validado e exatamente o que segue para o Prisma.
  const copy: Json = { ...data };
  if (copy.owner !== undefined) {
    throw new OwnerScopeViolationError(
      'Nao informe a relacao `owner` em forOwner(); o ownerId e injetado.',
    );
  }
  if (copy.ownerId !== undefined && copy.ownerId !== ownerId) {
    throw new OwnerScopeViolationError('`data.ownerId` difere do ownerId do escopo.');
  }
  assertNoRelationWrites(copy, relationFields);
  return { ...copy, ownerId };
}

/** `data` de update: sem `ownerId`/`owner` e sem escrita por relacao. Devolve a copia validada. */
function checkUpdateData(data: unknown, relationFields: ReadonlySet<string>): unknown {
  if (!isObject(data)) return data;
  const copy: Json = { ...data };
  if (copy.ownerId !== undefined || copy.owner !== undefined) {
    throw new OwnerScopeViolationError(
      'O ownerId e imutavel: nao pode constar em `data` de update.',
    );
  }
  assertNoRelationWrites(copy, relationFields);
  return copy;
}

function scopeCreateData(
  data: unknown,
  ownerId: string,
  relationFields: ReadonlySet<string>,
): unknown {
  return Array.isArray(data)
    ? data.map((row: unknown) => scopeData(row, ownerId, relationFields))
    : scopeData(data, ownerId, relationFields);
}

/**
 * Reescreve os argumentos de uma operacao sobre modelo privado; lanca se nao souber como.
 * `relationFields`: campos de relacao do MODELO (ver `relationFieldsOfClient`); escrever por eles
 * lanca `NestedRelationWriteError`.
 */
export function scopeArgs(
  operation: string,
  rawArgs: unknown,
  ownerId: string,
  relationFields: ReadonlySet<string>,
): Record<string, unknown> {
  const args: Json = isObject(rawArgs) ? { ...rawArgs } : {};

  if (operation === 'upsert') {
    return {
      ...args,
      where: scopeWhere(args.where, ownerId, true),
      create: scopeData(args.create, ownerId, relationFields),
      update: checkUpdateData(args.update, relationFields),
    };
  }
  if (CREATE_OPS.has(operation)) {
    return { ...args, data: scopeCreateData(args.data, ownerId, relationFields) };
  }
  if (WHERE_OPS.has(operation) || UNIQUE_OPS.has(operation)) {
    const scoped: Json = {
      ...args,
      where: scopeWhere(args.where, ownerId, UNIQUE_OPS.has(operation)),
    };
    if (UPDATE_OPS.has(operation)) scoped.data = checkUpdateData(args.data, relationFields);
    return scoped;
  }
  throw new OwnerScopeViolationError(
    `Operacao "${operation}" nao suportada por forOwner() em modelos privados.`,
  );
}

/** Procura (em profundidade) uma chave de relacao que leva a modelo privado. */
function findPrivateRelationKey(value: unknown, depth = 0): string | undefined {
  if (depth > 16 || typeof value !== 'object' || value === null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPrivateRelationKey(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, inner] of Object.entries(value)) {
    if (isPrivateRelationKey(key)) return key;
    const found = findPrivateRelationKey(inner, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Modelo global nao pode ser porta de entrada para linhas privadas (include/select/where/data). */
function assertNoPrivateRelations(model: string, operation: string, args: unknown): void {
  const key = findPrivateRelationKey(args);
  if (key) {
    throw new OwnerScopeViolationError(
      `${model}.${operation} atravessa a relacao privada "${key}". ` +
        'Acesse o modelo privado por db.forOwner(ownerId).',
    );
  }
}

/** Cliente sem escopo: modelos privados lancam. */
export const guardExtension = Prisma.defineExtension({
  name: 'chameleon-unscoped-guard',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (isPrivateModel(model)) throw new UnscopedAccessError(model, operation);
        assertNoPrivateRelations(model, operation, args);
        return query(args);
      },
    },
  },
});

export function ownerScopeExtension(ownerId: string, relationFields: RelationFields) {
  assertOwnerId(ownerId);
  return Prisma.defineExtension({
    name: 'chameleon-for-owner',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!isPrivateModel(model)) {
            assertNoPrivateRelations(model, operation, args);
            return query(args);
          }
          const fields = relationFields.get(model);
          if (!fields) {
            throw new OwnerScopeViolationError(`Modelo "${model}" sem modelo de dados conhecido.`);
          }
          return query(scopeArgs(operation, args, ownerId, fields));
        },
      },
    },
  });
}
