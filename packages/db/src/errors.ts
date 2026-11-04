/** Erros de isolamento do `@chameleon/db` (ADR-0008). Sao bugs de programacao, nao erros de usuario. */

export class DbScopeError extends Error {
  override readonly name: string = 'DbScopeError';
}

/** Modelo privado usado sem `forOwner(ownerId)`. */
export class UnscopedAccessError extends DbScopeError {
  override readonly name = 'UnscopedAccessError';
  constructor(
    readonly model: string,
    readonly operation: string,
  ) {
    super(
      `Acesso sem escopo ao modelo privado "${model}" (${operation}). ` +
        `Use db.forOwner(ownerId).${lowerFirst(model)}.${operation}(...).`,
    );
  }
}

/** `ownerId` ausente/invalido em forOwner, ou tentativa de ler/escrever em outro dono. */
export class OwnerScopeViolationError extends DbScopeError {
  override readonly name: string = 'OwnerScopeViolationError';
}

/**
 * Escrita por relacao aninhada (`connect`, `create`, `set`, `disconnect`...) em modelo privado via
 * `forOwner()`. O `connect` do Prisma troca `(xId, ownerId)` juntos e podia mover a linha para outro
 * dono; use o escalar `xId`. Subclasse de `OwnerScopeViolationError`.
 */
export class NestedRelationWriteError extends OwnerScopeViolationError {
  override readonly name = 'NestedRelationWriteError';
  constructor(readonly relation: string) {
    super(
      `Escrita por relacao ("${relation}") nao e permitida em forOwner(): use o escalar da FK ` +
        `(ex.: ${relation}Id) e escritas por tabela.`,
    );
  }
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
