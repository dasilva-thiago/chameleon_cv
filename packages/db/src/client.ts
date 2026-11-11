import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import {
  globalGuardExtension,
  ownerScopeExtension,
  relationFieldsOfClient,
  type RelationFields,
} from './for-owner';
import { purgeAccountData, type PurgeAccountResult } from './account/purge';

/** Opcao de startup do PostgreSQL aplicada a TODA conexao do app e dos testes. */
export const SESSION_TIMEZONE_OPTION = '-c timezone=UTC';

export interface CreateDbOptions {
  /** Padrao: process.env.DATABASE_URL. */
  connectionString?: string;
  /** Tamanho maximo do pool do `pg` (padrao do driver: 10). */
  maxConnections?: number;
}

function createBaseClient(options: CreateDbOptions): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL nao definida (ou passe connectionString a createDb).');
  }
  const adapter = new PrismaPg({
    connectionString,
    // O adapter-pg envia DateTime sem deslocamento: o instante so e correto se a SESSAO estiver em UTC
    // (o cluster local usa America/Sao_Paulo e deslocava 12:00Z para 15:00Z). Forcado por conexao.
    options: SESSION_TIMEZONE_OPTION,
    ...(options.maxConnections ? { max: options.maxConnections } : {}),
  });
  return new PrismaClient({ adapter });
}

function buildGlobalClient(base: PrismaClient, relations: RelationFields) {
  return base.$extends(globalGuardExtension(relations));
}

function buildOwnerClient(base: PrismaClient, ownerId: string, relations: RelationFields) {
  return base.$extends(ownerScopeExtension(ownerId, relations));
}

/** Cliente sem escopo: so modelos GLOBAIS; modelo privado lanca UnscopedAccessError. */
export type GlobalClient = ReturnType<typeof buildGlobalClient>;
/** Cliente escopado a um dono: modelos privados recebem `ownerId` automaticamente. */
export type OwnerScopedClient = ReturnType<typeof buildOwnerClient>;

export interface Db {
  /** Cliente escopado. E o unico caminho para modelos privados nos repositorios dos modulos. */
  forOwner(ownerId: string): OwnerScopedClient;
  /** Modelos globais (User, Invite). Modelos privados lancam erro. */
  readonly global: GlobalClient;
  /**
   * ESCAPE HATCH sem nenhuma protecao de isolamento. Permitido somente na camada de auth (lookup de
   * sessao por tokenHash) e em jobs de manutencao (ADR-0008, item 2). Nao use em repositorios.
   */
  readonly unsafeRaw: PrismaClient;
  /**
   * Account deletion (ADR-0014): deletes ALL data of `ownerId` (user, credentials, sessions, base,
   * immutable base revisions, jobs, resumes, consent, audit) in one transaction that sets `chameleon.allow_purge`
   * transaction-locally, verifies that nothing remains and records a minimal PII-free
   * `AccountDeletion` row. Narrow, trusted-server-only entry point: callers need no `unsafeRaw`. The
   * caller authenticates/authorizes the request and deletes stored files separately.
   */
  purgeAccount(ownerId: string): Promise<PurgeAccountResult>;
  $disconnect(): Promise<void>;
}

export function createDb(options: CreateDbOptions = {}): Db {
  const base = createBaseClient(options);
  const relations = relationFieldsOfClient(base); // falha cedo se o modelo de dados nao estiver acessivel
  const global = buildGlobalClient(base, relations);
  return {
    forOwner: (ownerId) => buildOwnerClient(base, ownerId, relations),
    global,
    unsafeRaw: base,
    purgeAccount: (ownerId) => purgeAccountData(base, ownerId),
    $disconnect: () => base.$disconnect(),
  };
}
