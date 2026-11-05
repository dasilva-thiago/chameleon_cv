import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_MODELS, PRIVATE_MODELS } from '../src/private-models';
import { createTestDb, type TestDb } from '../src/testing';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const ARGON2 = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';
const inDays = (days: number): Date => new Date(Date.now() + days * 86_400_000);

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.drop();
});
beforeEach(async () => {
  await testDb.truncateAll();
});

async function makeUser(email = `${randomBytes(4).toString('hex')}@example.test`) {
  return testDb.db.global.user.create({ data: { email, displayName: 'Teste' } });
}

describe('invariantes do schema (rede de seguranca do isolamento, ADR-0008, R3)', () => {
  const tables = async (): Promise<string[]> => {
    const { rows } = await testDb.sql<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
         AND relname <> '_prisma_migrations' ORDER BY 1`,
    );
    return rows.map((r) => r.relname);
  };

  it('toda tabela do banco esta no registro (privada ou global) e vice-versa', async () => {
    const registered = [...PRIVATE_MODELS, ...Object.keys(GLOBAL_MODELS)].sort();
    expect(await tables()).toEqual(registered);
  });

  it('o registro privado coincide com as tabelas que tem a coluna ownerId', async () => {
    const { rows } = await testDb.sql<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'ownerId' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([...PRIVATE_MODELS].sort());
  });

  it('toda tabela com ownerId tem UNIQUE (id, ownerId)', async () => {
    const { rows } = await testDb.sql<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'ownerId' AND NOT a.attisdropped)
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
             WHERE i.indrelid = c.oid AND i.indisunique AND i.indnatts = 2
               AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) k JOIN pg_attribute a
                          ON a.attrelid = c.oid AND a.attnum = k ORDER BY a.attname::text) = ARRAY['id', 'ownerId'])`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('toda FK entre tabelas privadas e composta e inclui ownerId', async () => {
    const { rows } = await testDb.sql<{ conname: string; child: string; cols: string[] }>(
      `SELECT c.conname, cl.relname AS child,
              ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                     ORDER BY k.ord) AS cols
         FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE c.contype = 'f' AND cl.relnamespace = 'public'::regnamespace
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attname = 'ownerId' AND NOT a.attisdropped)`,
    );
    const offenders = rows.filter((r) => !r.cols.includes('ownerId')).map((r) => r.conname);
    expect(offenders, 'FK para tabela privada sem ownerId (use FK composta)').toEqual([]);
  });

  it('as tabelas privadas raiz (identidade, ProfessionalProfile e JobPosting) apontam para User(id) por ownerId com cascade', async () => {
    const { rows } = await testDb.sql<{ child: string; ondelete: string }>(
      `SELECT cl.relname AS child, c.confdeltype AS ondelete
         FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE c.contype = 'f' AND c.confrelid = '"User"'::regclass AND cl.relname <> 'Invite'
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.child)).toEqual([
      'AuditEvent',
      'ConsentRecord',
      'Credential',
      'JobPosting',
      'ProfessionalProfile',
      'Session',
    ]);
    expect(rows.every((r) => r.ondelete === 'c')).toBe(true); // 'c' = CASCADE
  });
});

describe('User', () => {
  it('cria com defaults e e-mail citext unico sem diferenciar caixa', async () => {
    const user = await testDb.db.global.user.create({ data: { email: 'Ana@Example.test' } });
    expect(user.status).toBe('active');
    expect(user.deletedAt).toBeNull();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      testDb.db.global.user.create({ data: { email: 'ana@example.TEST' } }),
    ).rejects.toThrow(/User_email_key/);
    // lookup tambem ignora caixa
    expect(
      (await testDb.db.global.user.findUnique({ where: { email: 'ANA@example.test' } }))?.id,
    ).toBe(user.id);
  });
});

describe('Credential', () => {
  it('guarda somente hash argon2id e permite uma credencial de senha por dono', async () => {
    const user = await makeUser();
    const scoped = testDb.db.forOwner(user.id);
    await scoped.credential.create({ data: { ownerId: user.id, passwordHash: ARGON2 } });
    await expect(
      scoped.credential.create({ data: { ownerId: user.id, passwordHash: ARGON2 } }),
    ).rejects.toThrow(/Credential_ownerId_kind_key/);
  });

  it('recusa senha em claro ou hash de outro algoritmo (CHECK)', async () => {
    const user = await makeUser();
    const scoped = testDb.db.forOwner(user.id);
    for (const passwordHash of ['senha-em-claro-123', '$2b$12$abcdefghijklmnopqrstuv', '']) {
      await expect(
        scoped.credential.create({ data: { ownerId: user.id, passwordHash } }),
      ).rejects.toThrow(/Credential_passwordHash_argon2id_chk/);
    }
  });
});

describe('Session: token guardado somente como hash (ADR-0009)', () => {
  it('nao existe coluna com o token em claro', async () => {
    const { rows } = await testDb.sql<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ILIKE '%token%' ORDER BY 1, 2`,
    );
    expect(rows).toEqual([
      { table_name: 'Invite', column_name: 'tokenHash' },
      { table_name: 'Session', column_name: 'tokenHash' },
    ]);
  });

  it('o token em claro nao e armazenado em nenhuma coluna da linha', async () => {
    const user = await makeUser();
    const token = randomBytes(32).toString('base64url');
    const session = await testDb.db.forOwner(user.id).session.create({
      data: {
        ownerId: user.id,
        tokenHash: sha256(token),
        expiresAt: inDays(7),
        absoluteExpiresAt: inDays(30),
        userAgent: 'vitest',
      },
    });
    const dump = await testDb.sql<{ row: string }>(`SELECT s::text AS row FROM "Session" s`);
    expect(dump.rows).toHaveLength(1);
    expect(dump.rows[0]?.row).toContain(sha256(token));
    expect(dump.rows[0]?.row).not.toContain(token);
    // lookup pelo hash (camada de auth: cliente bruto explicito)
    const found = await testDb.db.unsafeRaw.session.findUnique({
      where: { tokenHash: sha256(token) },
    });
    expect(found?.id).toBe(session.id);
  });

  it('recusa valor que nao seja SHA-256 hex minusculo (CHECK)', async () => {
    const user = await makeUser();
    const scoped = testDb.db.forOwner(user.id);
    const base = { ownerId: user.id, expiresAt: inDays(7), absoluteExpiresAt: inDays(30) };
    const token = randomBytes(32).toString('base64url');
    for (const tokenHash of [token, token.toUpperCase(), sha256(token).toUpperCase(), 'ab', '']) {
      await expect(scoped.session.create({ data: { ...base, tokenHash } })).rejects.toThrow(
        /Session_tokenHash_format_chk/,
      );
    }
  });

  it('tokenHash e unico', async () => {
    const user = await makeUser();
    const scoped = testDb.db.forOwner(user.id);
    const data = {
      ownerId: user.id,
      tokenHash: sha256('t'),
      expiresAt: inDays(7),
      absoluteExpiresAt: inDays(30),
    };
    await scoped.session.create({ data });
    await expect(scoped.session.create({ data })).rejects.toThrow(/Session_tokenHash_key/);
  });

  it('valida ordem de expiracao e tamanho do userAgent (CHECK)', async () => {
    const user = await makeUser();
    const scoped = testDb.db.forOwner(user.id);
    const ok = { ownerId: user.id, expiresAt: inDays(7), absoluteExpiresAt: inDays(30) };
    await expect(
      scoped.session.create({
        data: { ...ok, tokenHash: sha256('a'), expiresAt: inDays(31) },
      }),
    ).rejects.toThrow(/Session_expiry_order_chk/);
    await expect(
      scoped.session.create({
        data: {
          ...ok,
          tokenHash: sha256('b'),
          absoluteExpiresAt: inDays(-1),
          expiresAt: inDays(-2),
        },
      }),
    ).rejects.toThrow(/Session_expiry_order_chk/);
    await expect(
      scoped.session.create({
        data: { ...ok, tokenHash: sha256('c'), userAgent: 'x'.repeat(257) },
      }),
    ).rejects.toThrow(/Session_userAgent_len_chk/);
    await scoped.session.create({
      data: { ...ok, tokenHash: sha256('d'), userAgent: 'x'.repeat(256) },
    });
  });

  it('revogacao e uma marca; todas as sessoes do dono podem ser revogadas em lote', async () => {
    const user = await makeUser();
    const scoped = testDb.db.forOwner(user.id);
    for (const key of ['1', '2', '3']) {
      await scoped.session.create({
        data: {
          ownerId: user.id,
          tokenHash: sha256(key),
          expiresAt: inDays(7),
          absoluteExpiresAt: inDays(30),
        },
      });
    }
    const result = await scoped.session.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    expect(result.count).toBe(3);
    expect(await scoped.session.count({ where: { revokedAt: null } })).toBe(0);
  });
});

describe('Invite (cadastro por convite)', () => {
  const invite = (email: string, key: string) => ({
    email,
    tokenHash: sha256(key),
    expiresAt: inDays(7),
  });

  it('tokenHash unico e formato SHA-256 (CHECK)', async () => {
    await testDb.db.global.invite.create({ data: invite('a@example.test', 'k1') });
    await expect(
      testDb.db.global.invite.create({ data: invite('b@example.test', 'k1') }),
    ).rejects.toThrow(/Invite_tokenHash_key/);
    await expect(
      testDb.db.global.invite.create({
        data: { ...invite('c@example.test', 'k2'), tokenHash: 'em-claro' },
      }),
    ).rejects.toThrow(/Invite_tokenHash_format_chk/);
  });

  it('um unico convite em aberto por e-mail (sem diferenciar caixa); usado libera novo', async () => {
    const first = await testDb.db.global.invite.create({ data: invite('Dup@Example.test', 'k1') });
    await expect(
      testDb.db.global.invite.create({ data: invite('dup@example.test', 'k2') }),
    ).rejects.toThrow(/Invite_email_open_key/);

    const user = await makeUser('dup@example.test');
    await testDb.db.global.invite.update({
      where: { id: first.id },
      data: { usedAt: new Date(), usedByUserId: user.id },
    });
    await testDb.db.global.invite.create({ data: invite('dup@example.test', 'k3') });
    expect(await testDb.db.global.invite.count({ where: { email: 'dup@example.test' } })).toBe(2);
  });

  it('convites de e-mails diferentes convivem e o usuario removido vira NULL no convite usado', async () => {
    const user = await makeUser();
    await testDb.db.global.invite.create({ data: invite('x@example.test', 'k1') });
    const used = await testDb.db.global.invite.create({
      data: { ...invite('y@example.test', 'k2'), usedAt: new Date(), usedByUserId: user.id },
    });
    await testDb.db.global.user.delete({ where: { id: user.id } });
    expect(
      (await testDb.db.global.invite.findUnique({ where: { id: used.id } }))?.usedByUserId,
    ).toBeNull();
  });
});

describe('ConsentRecord', () => {
  it('registra finalidade, versao do texto e timestamp; mudancas sao novas linhas', async () => {
    const user = await makeUser();
    const scoped = testDb.db.forOwner(user.id);
    const before = Date.now();
    await scoped.consentRecord.create({
      data: {
        ownerId: user.id,
        purpose: 'profile_processing',
        granted: true,
        policyVersion: '2026-11-01',
      },
    });
    await scoped.consentRecord.create({
      data: {
        ownerId: user.id,
        purpose: 'profile_processing',
        granted: false,
        policyVersion: '2026-11-02',
      },
    });
    const rows = await scoped.consentRecord.findMany({ orderBy: { recordedAt: 'desc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.granted).toBe(false);
    expect(rows[0]!.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it.each([
    'profile_processing',
    'ai_processing',
    'ai_processing:anthropic',
    'ai_provider:openai-2',
  ])('aceita finalidade %s', async (purpose) => {
    const user = await makeUser();
    await testDb.db.forOwner(user.id).consentRecord.create({
      data: { ownerId: user.id, purpose, granted: true, policyVersion: 'v1' },
    });
  });

  it.each(['', 'Profile', 'ai processing', 'ai_processing:', ':x', 'ai_processing:A!', '1abc'])(
    'recusa finalidade invalida "%s"',
    async (purpose) => {
      const user = await makeUser();
      await expect(
        testDb.db.forOwner(user.id).consentRecord.create({
          data: { ownerId: user.id, purpose, granted: true, policyVersion: 'v1' },
        }),
      ).rejects.toThrow(/ConsentRecord_purpose_format_chk/);
    },
  );
});

describe('AuditEvent e exclusao de conta', () => {
  it('metadata vazio por padrao; excluir o usuario remove todas as linhas do dono (cascade)', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    for (const user of [a, b]) {
      const scoped = testDb.db.forOwner(user.id);
      await scoped.credential.create({ data: { ownerId: user.id, passwordHash: ARGON2 } });
      await scoped.session.create({
        data: {
          ownerId: user.id,
          tokenHash: sha256(user.id),
          expiresAt: inDays(7),
          absoluteExpiresAt: inDays(30),
        },
      });
      await scoped.consentRecord.create({
        data: {
          ownerId: user.id,
          purpose: 'profile_processing',
          granted: true,
          policyVersion: 'v1',
        },
      });
      await scoped.auditEvent.create({
        data: {
          ownerId: user.id,
          action: 'account.created',
          entityType: 'User',
          entityId: user.id,
        },
      });
    }
    expect((await testDb.db.forOwner(a.id).auditEvent.findFirstOrThrow()).metadata).toEqual({});

    await testDb.db.global.user.delete({ where: { id: a.id } });

    const remaining = await testDb.sql<{ owner: string; n: number }>(
      `SELECT "ownerId"::text AS owner, count(*)::int AS n FROM (
         SELECT "ownerId" FROM "Credential" UNION ALL SELECT "ownerId" FROM "Session"
         UNION ALL SELECT "ownerId" FROM "ConsentRecord" UNION ALL SELECT "ownerId" FROM "AuditEvent") t
       GROUP BY 1`,
    );
    expect(remaining.rows).toEqual([{ owner: b.id, n: 4 }]);
  });
});
