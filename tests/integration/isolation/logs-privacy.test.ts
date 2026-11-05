import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrossCaseContext } from './support/context';
import { assertLogsClean, registerSecret } from './support/logs';
import { TEST_PASSWORD, TEST_SIGNUP_CONSENTS, type ApiModule } from './support/workspace';
import { createWorld, type World } from './support/world';

/**
 * ADR-0014 / ADR-0008 item 5(c): nenhum log contem senha, token, e-mail, canario de perfil ou trecho
 * de corpo. Alem do `assertLogsClean` que TODO arquivo da suite roda no `afterAll`, aqui o trafego e
 * deliberadamente hostil: segredos e canarios em corpo, query, cabecalhos, cookies, JSON malformado,
 * corpo gigante e uma rota que explode (500) com o canario na mensagem do erro.
 */
const HOSTILE = {
  password: 'CANARY-LOG-senha-7f3a91c2d4',
  email: 'canary.log.9d41aa07@example.test',
  body: 'CANARY-LOG-corpo-5b8e2f10',
  query: 'CANARY-LOG-query-c03d77e9',
  header: 'CANARY-LOG-cabecalho-12ab45cd',
  cookie: 'CANARY-LOG-cookie-88f0e1b2',
  agent: 'CANARY-LOG-user-agent-4e6d9a31',
  boom: 'CANARY-LOG-excecao-a1b2c3d4',
};

const boomModule: ApiModule = ({ routes, requireAuth }) => {
  routes.get('/boom', { auth: 'session' }, requireAuth, () => {
    throw new Error(`falha interna com dado privado ${HOSTILE.boom} ${HOSTILE.email}`);
  });
  routes.post('/profiles', { auth: 'session' }, requireAuth, (_req, res) => {
    res.status(201).json({});
  });
};

let world: World;
beforeAll(async () => {
  world = await createWorld({ modules: [boomModule] });
  for (const [label, value] of Object.entries(HOSTILE))
    registerSecret(world, `hostil ${label}`, value);
}, 120_000);
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

describe('logs com trafego hostil', () => {
  it('gera trafego com segredos/canarios em todos os canais e nada aparece no log', async () => {
    const ctx = new CrossCaseContext(world);
    const { a, b } = world;
    const clientA = ctx.http(a.client);
    const anon = () => ctx.anonymous();
    const profileBody = { nota: a.canaries[0], outra: a.canaries[1], extra: HOSTILE.body };

    // 200 autenticados
    await clientA.get('/api/auth/me', { headers: { 'User-Agent': HOSTILE.agent } });
    // login: falho com senha/e-mail hostis, e valido
    await anon().post('/api/auth/login', { email: HOSTILE.email, password: HOSTILE.password });
    await anon().post('/api/auth/login', { email: a.email, password: HOSTILE.password });
    await anon().post('/api/auth/login', {
      email: a.email,
      password: a.password,
      extra: HOSTILE.body,
    });
    const ok = anon();
    expect(
      (
        await ok.post(
          '/api/auth/login',
          { email: b.email, password: TEST_PASSWORD },
          {
            headers: { 'User-Agent': HOSTILE.agent },
          },
        )
      ).status,
    ).toBe(200);

    // 400: JSON malformado, tipo errado, corpo grande (413), content-type indevido
    await anon().postRaw(
      '/api/auth/login',
      `{"email":"${HOSTILE.email}","password":"${HOSTILE.password}",`,
    );
    await anon().postRaw(
      '/api/auth/login',
      JSON.stringify({ email: 1, password: HOSTILE.password }),
    );
    const big = await anon().postRaw(
      '/api/auth/login',
      JSON.stringify({ email: a.email, password: HOSTILE.password, lixo: 'x'.repeat(200_000) }),
    );
    expect(big.status).toBe(413);
    await anon().postRaw('/api/auth/login', `password=${HOSTILE.password}`, {
      contentType: 'application/x-www-form-urlencoded',
    });
    // 401/403/404 com segredos em query, cabecalhos e cookies
    await anon().get(`/api/auth/me?token=${HOSTILE.query}&email=${HOSTILE.email}`);
    await anon().get('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${HOSTILE.header}`,
        'X-Custom': HOSTILE.header,
        Cookie: `${ok.sessionCookieName}=${HOSTILE.cookie}; outro=${HOSTILE.cookie}`,
        Referer: `https://exemplo.test/?q=${HOSTILE.query}`,
      },
    });
    await clientA.post('/api/auth/logout', profileBody, { csrf: HOSTILE.header });
    await clientA.post('/api/auth/logout', profileBody, {
      origin: `https://${HOSTILE.header}.test`,
    });
    await clientA.get(`/api/inexistente?dado=${HOSTILE.query}`);
    await clientA.post('/api/inexistente', profileBody);
    await anon().post('/api/auth/invites/preview', { token: HOSTILE.body });
    await anon().post('/api/auth/invites/accept', {
      token: HOSTILE.body,
      password: HOSTILE.password,
      displayName: HOSTILE.body,
      consents: TEST_SIGNUP_CONSENTS,
    });
    // corpo de perfil com canarios para uma rota que aceita POST (nao deve ser registrado)
    expect((await clientA.post('/api/profiles', profileBody)).status).toBe(201);
    // 500: excecao cuja mensagem carrega canario e e-mail
    const boom = await clientA.get('/api/boom');
    expect(boom.status).toBe(500);
    expect(JSON.stringify(boom.body)).not.toContain(HOSTILE.boom);
    expect(JSON.stringify(boom.body)).not.toContain(HOSTILE.email);

    const output = world.logs.text();
    for (const [label, value] of Object.entries(HOSTILE)) {
      expect(output, `vazou ${label}`).not.toContain(value);
    }
    for (const canary of [...a.canaries, ...b.canaries]) expect(output).not.toContain(canary);
    assertLogsClean(world);
  });

  it('o 500 e registrado (tipo/codigo/pilha) e as linhas de acesso tem so campos permitidos', () => {
    const lines = world.logs.lines();
    const errors = lines.filter((line) => Number(line.level) >= 50);
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).not.toContain('falha interna'); // a mensagem nao e registrada
    const access = lines.filter((line) => line.msg === 'request completed');
    expect(access.length).toBeGreaterThan(15);
    for (const line of access) {
      expect(Object.keys(line.req as object).sort()).toEqual(['method', 'path']);
      expect(String((line.req as { path: string }).path)).not.toContain('?');
      expect(JSON.stringify(line)).not.toMatch(
        /authorization|cookie|x-csrf|set-cookie|user-agent/i,
      );
    }
  });
});
