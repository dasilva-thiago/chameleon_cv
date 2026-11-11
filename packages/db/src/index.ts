export const PACKAGE_NAME = '@chameleon/db' as const;

export { createDb } from './client';
export type { CreateDbOptions, Db, GlobalClient, OwnerScopedClient } from './client';
export {
  DbScopeError,
  NestedRelationWriteError,
  OwnerScopeViolationError,
  UnscopedAccessError,
} from './errors';
export * from './account';
export { GLOBAL_MODELS, PRIVATE_MODELS, isPrivateModel } from './private-models';
export type { GlobalModelName, PrivateModelName } from './private-models';
export type {
  AuditEvent,
  ConsentRecord,
  Credential,
  Invite,
  Session,
  User,
} from './generated/prisma/client';
export { CredentialKind, UserStatus } from './generated/prisma/enums';
