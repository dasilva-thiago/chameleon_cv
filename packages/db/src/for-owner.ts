import { Prisma } from './generated/prisma/client';
import { NestedRelationWriteError, OwnerScopeViolationError, UnscopedAccessError } from './errors';
import {
  GLOBAL_MODELS,
  PRIVATE_MODELS,
  PRIVATE_RELATIONS_OF_GLOBAL,
  isPrivateModel,
} from './private-models';

/**
 * Extensoes de isolamento (ADR-0008, item 2).
 *
 * - `globalGuardExtension`: aplicada ao cliente SEM escopo. Modelo privado -> lanca UnscopedAccessError.
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
 * GLOBAL models (S1.5a, security review findings F2/F13), all fail CLOSED:
 * - No argument (`where`/`select`/`include`/`data`/`orderBy`, at any depth) may contain a relation field
 *   of a global model (derived from the runtime data model) nor `_count` inside `select`/`include`.
 *   This closes global -> private traversal (and the User <-> Invite cycle) independently of depth;
 *   exceeding the depth limit THROWS.
 * - Inside `forOwner(id)`, `User` is restricted to `id = ownerId` and `Invite` only accepts
 *   `update`/`updateMany` of `usedAt`/`usedByUserId` (invite-acceptance flow).
 * - Client-level raw operations (`$queryRaw`, ...) throw on both clients.
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
  for (const model of Object.keys(GLOBAL_MODELS)) {
    if (!result.has(model)) {
      throw new Error(`Modelo global "${model}" ausente do modelo de dados do Prisma Client.`);
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

function scopeWhere(where: unknown, ownerId: string, unique: boolean, field = 'ownerId'): Json {
  if (where === undefined || where === null) {
    // Sem `where`: so valido em operacoes nao unicas (o Prisma exige `where` nas unicas).
    return { [field]: ownerId };
  }
  if (!isObject(where)) throw new OwnerScopeViolationError('`where` invalido.');
  const current = where[field];
  if (current === undefined) return { ...where, [field]: ownerId };
  if (current === ownerId) return where;
  if (typeof current === 'string' || unique) {
    throw new OwnerScopeViolationError(`\`where.${field}\` difere do ownerId do escopo.`);
  }
  // Filtro composto no campo (ex.: { in: [...] }) numa operacao nao unica: intersecao.
  return { AND: [where, { [field]: ownerId }] };
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

// ---------------------------------------------------------------------------------------------
// Global models (User, Invite) and client-level operations (S1.5a, findings F2/F13).
// ---------------------------------------------------------------------------------------------

/** Maximum nesting depth walked in the arguments of a global-model operation. Exceeding it THROWS. */
export const MAX_GLOBAL_ARGS_DEPTH = 32;

/** Operations a global model accepts; anything else is rejected (fail closed). */
const GLOBAL_OPERATIONS = new Set([...WHERE_OPS, ...UNIQUE_OPS, ...CREATE_OPS, 'upsert']);

/**
 * Relation field names that must never appear in the arguments of a global-model operation. It is the
 * union of every relation field of every global model (read from the runtime data model, so a new
 * relation is covered automatically) and of the hand-written, test-checked private relation list.
 * Global <-> global relations (`Invite.usedBy`, `User.invitesUsed`) are forbidden too: they form a
 * cycle that could reach private relations through an arbitrarily long chain.
 */
export function forbiddenGlobalKeys(relationFields: RelationFields): ReadonlySet<string> {
  const keys = new Set<string>(Object.values(PRIVATE_RELATIONS_OF_GLOBAL).flat());
  for (const model of Object.keys(GLOBAL_MODELS)) {
    const fields = relationFields.get(model);
    if (!fields) {
      throw new OwnerScopeViolationError(`Global model "${model}" has no known data model.`);
    }
    for (const field of fields) keys.add(field);
  }
  return keys;
}

/**
 * Walks `value` looking for a forbidden relation key (at any depth, in `where`, `select`, `include`,
 * `orderBy`, `data`...) or for the relation-count selector `_count` inside a `select`/`include`.
 * A top-level `_count` of `aggregate`/`groupBy` counts scalar columns and stays allowed. Throws
 * `OwnerScopeViolationError` when the depth limit is hit instead of assuming the rest is safe.
 */
export function findForbiddenGlobalKey(
  value: unknown,
  forbidden: ReadonlySet<string>,
  inSelection = false,
  depth = 0,
): string | undefined {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return undefined;
  if (depth > MAX_GLOBAL_ARGS_DEPTH) {
    throw new OwnerScopeViolationError(
      `Arguments of a global model are nested deeper than ${MAX_GLOBAL_ARGS_DEPTH} levels.`,
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenGlobalKey(item, forbidden, inSelection, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, inner] of Object.entries(value)) {
    if (forbidden.has(key)) return key;
    if (inSelection && key === '_count') return key;
    const found = findForbiddenGlobalKey(
      inner,
      forbidden,
      inSelection || key === 'select' || key === 'include',
      depth + 1,
    );
    if (found) return found;
  }
  return undefined;
}

/** A global model must not be a doorway to private rows (include/select/where/data/_count). */
export function assertGlobalModelArgs(
  model: string,
  operation: string,
  args: unknown,
  forbidden: ReadonlySet<string>,
): void {
  if (!GLOBAL_OPERATIONS.has(operation)) {
    throw new OwnerScopeViolationError(`Operation "${operation}" is not supported on ${model}.`);
  }
  const key = findForbiddenGlobalKey(args, forbidden);
  if (key) {
    throw new OwnerScopeViolationError(
      `${model}.${operation} traverses the relation "${key}". Global models cannot be used to ` +
        'reach related rows; query the related model through db.forOwner(ownerId) instead.',
    );
  }
}

/** `User` inside `forOwner(ownerId)`: only the owner's own row. */
function scopeUserArgs(operation: string, rawArgs: unknown, ownerId: string): Json {
  const args: Json = isObject(rawArgs) ? { ...rawArgs } : {};
  const scopeCreate = (data: unknown): Json => {
    if (!isObject(data)) throw new OwnerScopeViolationError('`data` invalido.');
    if (data.id !== undefined && data.id !== ownerId) {
      throw new OwnerScopeViolationError('`data.id` of User differs from the scope ownerId.');
    }
    return { ...data, id: ownerId };
  };
  const checkUpdate = (data: unknown): unknown => {
    if (isObject(data) && data.id !== undefined) {
      throw new OwnerScopeViolationError(
        'User.id is immutable and cannot appear in update `data`.',
      );
    }
    return data;
  };
  if (operation === 'upsert') {
    return {
      ...args,
      where: scopeWhere(args.where, ownerId, true, 'id'),
      create: scopeCreate(args.create),
      update: checkUpdate(args.update),
    };
  }
  if (CREATE_OPS.has(operation)) {
    return {
      ...args,
      data: Array.isArray(args.data) ? args.data.map(scopeCreate) : scopeCreate(args.data),
    };
  }
  if (WHERE_OPS.has(operation) || UNIQUE_OPS.has(operation)) {
    const scoped: Json = {
      ...args,
      where: scopeWhere(args.where, ownerId, UNIQUE_OPS.has(operation), 'id'),
    };
    if (UPDATE_OPS.has(operation)) scoped.data = checkUpdate(args.data);
    return scoped;
  }
  throw new OwnerScopeViolationError(`Operation "${operation}" is not supported on User.`);
}

/** Invite columns the invite-acceptance flow may write through `forOwner`. */
const INVITE_OWNER_WRITE_FIELDS: ReadonlySet<string> = new Set(['usedAt', 'usedByUserId']);

/**
 * `Invite` inside `forOwner(ownerId)`: invites exist before any owner, so they cannot be scoped by
 * owner. Only the acceptance flow is allowed: `update`/`updateMany` targeting one invite by
 * `tokenHash` or `id`, writing `usedAt` and/or `usedByUserId` (which must be the scope owner).
 * Everything else (reads, create, delete, other columns) must use `db.global.invite`.
 */
function scopeInviteArgs(operation: string, rawArgs: unknown, ownerId: string): Json {
  const reject = (reason: string): never => {
    throw new OwnerScopeViolationError(
      `Invite.${operation} through forOwner() is not allowed (${reason}). Use db.global.invite.`,
    );
  };
  if (operation !== 'update' && operation !== 'updateMany') return reject('only update/updateMany');
  const args: Json = isObject(rawArgs) ? { ...rawArgs } : {};
  const where = args.where;
  if (!isObject(where) || (typeof where.tokenHash !== 'string' && typeof where.id !== 'string')) {
    return reject('`where` must target one invite by tokenHash or id');
  }
  const data = args.data;
  if (!isObject(data)) return reject('`data` is invalid');
  const copy: Json = { ...data };
  for (const key of Object.keys(copy)) {
    if (copy[key] !== undefined && !INVITE_OWNER_WRITE_FIELDS.has(key)) {
      return reject(`column "${key}" is not writable`);
    }
  }
  if (copy.usedByUserId !== undefined && copy.usedByUserId !== ownerId) {
    return reject('`usedByUserId` must be the scope owner');
  }
  return { ...args, data: copy };
}

/** Policy of a global model inside `forOwner`; unknown global models are rejected (fail closed). */
export function scopeGlobalModelArgs(
  model: string,
  operation: string,
  args: unknown,
  ownerId: string,
): Json {
  if (model === 'User') return scopeUserArgs(operation, args, ownerId);
  if (model === 'Invite') return scopeInviteArgs(operation, args, ownerId);
  throw new OwnerScopeViolationError(`Global model "${model}" has no forOwner() policy.`);
}

function rejectRawOperation(operation: string): never {
  throw new OwnerScopeViolationError(
    `${operation} is not available on scoped or global clients: raw SQL bypasses owner isolation. ` +
      'Use the typed model API (or db.unsafeRaw, restricted to apps/api/src/auth and packages/db).',
  );
}

/**
 * Unscoped client: private models throw; global models are guarded against relation traversal;
 * raw operations throw.
 */
export function globalGuardExtension(relationFields: RelationFields) {
  const forbidden = forbiddenGlobalKeys(relationFields);
  return Prisma.defineExtension({
    name: 'chameleon-unscoped-guard',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (isPrivateModel(model)) throw new UnscopedAccessError(model, operation);
          assertGlobalModelArgs(model, operation, args, forbidden);
          return query(args);
        },
      },
      // Client-level operations (no model): `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, ...
      $allOperations({ model, operation, query, args }) {
        if (model === undefined) rejectRawOperation(operation);
        return query(args);
      },
    },
  });
}

export function ownerScopeExtension(ownerId: string, relationFields: RelationFields) {
  assertOwnerId(ownerId);
  const forbidden = forbiddenGlobalKeys(relationFields);
  return Prisma.defineExtension({
    name: 'chameleon-for-owner',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!isPrivateModel(model)) {
            assertGlobalModelArgs(model, operation, args, forbidden);
            return query(scopeGlobalModelArgs(model, operation, args, ownerId));
          }
          const fields = relationFields.get(model);
          if (!fields) {
            throw new OwnerScopeViolationError(`Modelo "${model}" sem modelo de dados conhecido.`);
          }
          return query(scopeArgs(operation, args, ownerId, fields));
        },
      },
      $allOperations({ model, operation, query, args }) {
        if (model === undefined) rejectRawOperation(operation);
        return query(args);
      },
    },
  });
}
