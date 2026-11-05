import type { Db } from '@chameleon/db';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/passwords';
import { AuthService } from '../src/auth/service';
import { createLogger } from '../src/logging';

/**
 * F6: login must do the same database work whether the account is unknown, disabled, credential-less
 * or active, so latency does not reveal which e-mails have active accounts. Fake database that
 * records every call; no real connection.
 */
const OWNER = '0198f7a0-0000-7000-8000-000000000001';

interface Fixture {
  user: { id: string; status: string; deletedAt: Date | null; email: string } | null;
  credential: { passwordHash: string } | null;
}

function serviceFor(fixture: Fixture) {
  const calls: string[] = [];
  const db = {
    global: {
      user: {
        findUnique: () => {
          calls.push('global.user.findUnique');
          return Promise.resolve(fixture.user);
        },
      },
    },
    forOwner: () => ({
      credential: {
        findFirst: () => {
          calls.push('forOwner.credential.findFirst');
          return Promise.resolve(fixture.credential);
        },
      },
    }),
  } as unknown as Db;
  const service = new AuthService({
    db,
    sessions: {} as never,
    logger: createLogger({ LOG_LEVEL: 'silent' }),
    now: () => new Date(),
    signupMode: 'invite',
    policyVersions: ['2026-11.1'],
  });
  return { service, calls };
}

describe('AuthService.login: uniform database work (F6)', () => {
  it('unknown, disabled, credential-less and wrong-password logins perform identical DB calls', async () => {
    const passwordHash = await hashPassword('the right password, long enough');
    const active = { id: OWNER, status: 'active', deletedAt: null, email: 'a@example.test' };
    const fixtures: Record<string, Fixture> = {
      'unknown e-mail': { user: null, credential: null },
      'disabled account': {
        user: { ...active, status: 'disabled' },
        credential: { passwordHash },
      },
      'deleted account': {
        user: { ...active, deletedAt: new Date() },
        credential: { passwordHash },
      },
      'no credential': { user: active, credential: null },
      'active, wrong password': { user: active, credential: { passwordHash } },
    };
    const sequences: Record<string, string[]> = {};
    for (const [name, fixture] of Object.entries(fixtures)) {
      const { service, calls } = serviceFor(fixture);
      await expect(
        service.login({
          email: 'a@example.test',
          password: 'a wrong password entirely',
          currentToken: undefined,
          userAgent: undefined,
          correlationId: 'c',
        }),
        name,
      ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
      sequences[name] = calls;
    }
    const expected = ['global.user.findUnique', 'forOwner.credential.findFirst'];
    for (const [name, calls] of Object.entries(sequences)) expect(calls, name).toEqual(expected);
  });

  it('a disabled account with the CORRECT password is still refused', async () => {
    const passwordHash = await hashPassword('the right password, long enough');
    const { service } = serviceFor({
      user: { id: OWNER, status: 'disabled', deletedAt: null, email: 'a@example.test' },
      credential: { passwordHash },
    });
    await expect(
      service.login({
        email: 'a@example.test',
        password: 'the right password, long enough',
        currentToken: undefined,
        userAgent: undefined,
        correlationId: 'c',
      }),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });
});
