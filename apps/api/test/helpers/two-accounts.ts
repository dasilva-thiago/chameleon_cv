import type { AuthSessionResponse } from '@chameleon/contracts';
import type { Db } from '@chameleon/db';
import type { Express } from 'express';
import { createInvite } from '../../src/auth/invites';
import type { AppConfig } from '../../src/config';
import { TestClient } from './test-client';

export const TEST_PASSWORD = 'correct horse battery staple';

export interface TestAccount {
  ownerId: string;
  email: string;
  password: string;
  displayName: string;
  /** Cliente ja autenticado (cookie de sessao + CSRF). */
  client: TestClient;
}

/**
 * Cria uma conta pelo fluxo REAL (convite -> aceite), nao por insercao direta: o cliente devolvido
 * ja esta autenticado. Reutilizado pela suite de isolamento da S1.4.
 */
export async function createTestAccount(
  ctx: { app: Express; config: Pick<AppConfig, 'APP_ORIGIN'>; db: Db },
  options: { email: string; password?: string; displayName?: string },
): Promise<TestAccount> {
  const password = options.password ?? TEST_PASSWORD;
  const displayName = options.displayName ?? `Conta ${options.email}`;
  const { token } = await createInvite(ctx.db, { email: options.email });
  const client = new TestClient(ctx.app, ctx.config);
  const response = await client.post('/api/auth/invites/accept', { token, password, displayName });
  if (response.status !== 201) {
    throw new Error(`createTestAccount: aceite falhou (${response.status})`);
  }
  const body = response.body as AuthSessionResponse;
  return { ownerId: body.user.id, email: options.email, password, displayName, client };
}

/**
 * Duas contas independentes (A e B), cada uma com cliente proprio, para os casos cruzados do
 * gate de isolamento (ADR-0008): o que A faz nao pode alcancar dados de B e vice-versa.
 */
export async function createTwoAccounts(ctx: {
  app: Express;
  config: Pick<AppConfig, 'APP_ORIGIN'>;
  db: Db;
}): Promise<{ a: TestAccount; b: TestAccount }> {
  const a = await createTestAccount(ctx, { email: 'conta-a@example.test' });
  const b = await createTestAccount(ctx, { email: 'conta-b@example.test' });
  return { a, b };
}
