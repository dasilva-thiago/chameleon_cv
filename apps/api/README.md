# @chameleon/api

API Express 5 do Chameleon CV (monólito modular, ADR-0001). Todas as rotas de negócio ficam sob
`/api`; `/health` também existe na raiz. O proxy do Vite repassa `/api/*` sem reescrever o caminho.

## Como rodar

```
pnpm db:local:init && pnpm db:local:start     # uma vez (cluster 127.0.0.1:54329, ADR-0002)
pnpm db:migrate:deploy                        # aplica as migrações em DATABASE_URL
cp .env.example .env                          # ajuste, se preciso
pnpm --filter @chameleon/api dev              # tsx watch, ouve em 127.0.0.1:$API_PORT
pnpm --filter @chameleon/api build && pnpm --filter @chameleon/api start
```

Testes (da raiz): `pnpm test` (unitários, sem banco), `pnpm test:integration` (banco real por arquivo,
precisa do cluster no ar e de `TEST_DATABASE_ADMIN_URL`).

## Variáveis de ambiente

Validadas por Zod na subida (`src/config/env.ts`); o erro lista só os **nomes** inválidos.

| Variável                  | Padrão             | Observações                                                                                                                                                                                                     |
| ------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | (obrigatória)      | `postgres://...`                                                                                                                                                                                                |
| `APP_ORIGIN`              | (obrigatória)      | Origem da SPA (`https://cv.exemplo.com`, `http://localhost:5173`). Base do CSRF e dos cookies (ver abaixo)                                                                                                      |
| `API_PORT`                | `3000`             | Ouve só em `127.0.0.1`                                                                                                                                                                                          |
| `SIGNUP_MODE`             | `invite`           | `invite` (padrão) ou `closed`. `open` é reservado (ADR-0009) e **rejeitado** por enquanto                                                                                                                       |
| `TRUST_PROXY`             | `0`                | Number of trusted reverse proxies in front of the API (`0` = none). **Must be `>=1` in production behind a proxy**; see "Proxy contract" below                                                                  |
| `TRUST_PROXY_ACK_DIRECT`  | `false`            | `true` documents a DIRECT deployment (no proxy). Required to run `NODE_ENV=production` with `TRUST_PROXY=0`; rejected together with `TRUST_PROXY>=1`                                                            |
| `PROFILE_POLICY_VERSIONS` | `2026-11.1`        | Comma-separated policy text versions accepted for `profile_processing` consent (first = current). Must include the version the web app shows (`DEFAULT_PROFILE_POLICY_VERSION` / `VITE_PROFILE_POLICY_VERSION`) |
| `JSON_BODY_LIMIT_BYTES`   | `102400`           | Limite do corpo JSON em `/api` (413 acima). Rotas com payload maior definem o próprio parser                                                                                                                    |
| `LOG_LEVEL`               | `info`             | `silent` nos testes                                                                                                                                                                                             |
| demais                    | ver `.env.example` | `STORAGE_ROOT`, `UPLOAD_MAX_BYTES`, `AI_*`, `PDF_BROWSER` pertencem a fatias futuras                                                                                                                            |

Regras entre variáveis: em `NODE_ENV=production` o `APP_ORIGIN` precisa ser `https`; `http` só é aceito
para `localhost`, `127.0.0.1` e `[::1]`. Em produção, `TRUST_PROXY=0` é recusado a menos que
`TRUST_PROXY_ACK_DIRECT=true` (implantação direta, sem proxy).

### Proxy contract (rate limits depend on it)

Rate limits key on `req.ip`. The API listens on `127.0.0.1` (`src/main.ts`), so a reverse proxy on the same
host is the expected production topology, and the client address reaches the API only through
`X-Forwarded-For`. Both misconfigurations are exploitable, which is why production refuses the default:

- `TRUST_PROXY=0` behind a proxy: every client shares the proxy address as key, so 20 failed logins on
  random e-mails lock out everyone (shared lockout). Set `TRUST_PROXY` to the number of trusted hops.
- `TRUST_PROXY>=1` while clients can reach the API without a proxy that **overwrites or appends** to
  `X-Forwarded-For`: the client controls `req.ip` and per-IP limits are bypassable.

The proxy must (1) be the only network path to the API, (2) set `X-Forwarded-For` itself (nginx:
`proxy_set_header X-Forwarded-For $remote_addr;` for one hop; `$proxy_add_x_forwarded_for` only when a
trusted proxy precedes it), and (3) `TRUST_PROXY` must equal the number of trusted proxies that append to
the header. As a second line, login has a **per-account progressive delay** that does not depend on the IP
(see Rate limit below), so a forged header cannot make guessing one account free.

## Autenticação e sessões (ADR-0009)

- **Convite → conta.** `SIGNUP_MODE=invite`: a conta só nasce de um convite emitido por CLI. O e-mail
  vem do convite (o cliente não o envia no aceite). Senha: 12 a 128 caracteres, argon2id
  (m=19 MiB, t=2, p=1), sem regra de composição, com lista local de senhas comuns e checagem de e-mail
  embutido na senha.
- **Sessão no servidor.** Token de 32 bytes aleatórios (base64url, 43 caracteres) no cookie; no banco
  só o SHA-256 hex. Expiração deslizante de 7 dias (renovada no uso, no máx. a cada 60 s) e absoluta
  de 30 dias. Login **rotaciona**: cria sessão nova e revoga a apresentada no cookie. No máximo 10
  sessões ativas por usuário (as mais antigas são revogadas).
- **Cookies** (estratégia derivada de `APP_ORIGIN`, sem flag separada para desligar `Secure`):

  | `APP_ORIGIN`                     | Sessão                                                                               | CSRF (legível por JS)                            |
  | -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
  | `https://...` (produção)         | `__Host-cc_session`; `HttpOnly; Secure; SameSite=Lax; Path=/`, sem `Domain`; 30 dias | `__Host-cc_csrf`; `Secure; SameSite=Lax; Path=/` |
  | `http://localhost[:porta]` (dev) | `cc_session`; `HttpOnly; SameSite=Lax; Path=/`, **sem `Secure` e sem prefixo**       | `cc_csrf`; `SameSite=Lax; Path=/`                |

  O prefixo `__Host-` exige `Secure`, e `Secure` em `http://` não é aceito de forma consistente (Safari
  recusa), então a exceção de desenvolvimento existe só quando a config prova que é loopback e não é
  produção; um deploy `http` ou um host não loopback falha na validação.

- **CSRF** (métodos `POST/PUT/PATCH/DELETE`): (1) `Origin` (ou, na falta, a origem do `Referer`)
  igual a `APP_ORIGIN`, senão `403 CSRF_ORIGIN`; (2) cabeçalho `X-CSRF-Token` igual ao cookie CSRF
  (double-submit), senão `403 CSRF_TOKEN`. Qualquer requisição `/api/*` sem o cookie o recebe, então o
  `GET /api/auth/me` do carregamento da SPA basta. O cookie é regenerado no login e no logout: releia-o.
  Não há CORS (a SPA usa o mesmo origem, via proxy do Vite em dev).
- **Rate limit** (`express-rate-limit`, memória; instância única): login falho 5 por 15 min por
  IP+e-mail e 20 por 15 min por IP (a chave não depende do e-mail existir); convite (preview e aceite
  juntos) 10 por hora por IP. `429 RATE_LIMITED` com `Retry-After`. Login bem-sucedido não consome limite.
  **Per-account progressive delay** (`loginAccountDelay`, independent of the IP): key = normalized e-mail only;
  after 5 attempts in 15 min each further attempt waits 250 ms, doubling up to a **2 s ceiling**. It is a delay,
  never a block (a block keyed only by e-mail would let anyone lock a chosen victim out): a flood against one
  account slows only that account's logins by at most 2 s and leaves other accounts untouched. Attempts count
  when they start (parallel guesses see growing delays) and are refunded on success. Residual risk: the ceiling
  bounds sequential guessing to about 30 attempts/min per account, not parallel guessing; the real control is the
  proxy contract above.
- **Sem enumeração.** E-mail inexistente, senha errada, conta desativada e conta sem credencial dão a
  mesma resposta `401 INVALID_CREDENTIALS` e o mesmo trabalho (uma verificação argon2, com hash
  fictício, e as mesmas duas consultas ao banco: usuário + credencial, esta com um `ownerId` aleatório quando
  o e-mail não existe). Convite desconhecido, expirado, usado ou revogado dão o mesmo `400 INVITE_INVALID`.

### Consent (LGPD, ADR-0014)

Invite acceptance **requires** `consents: [{ purpose: 'profile_processing', granted: true, policyVersion }]`
(exactly one entry; the schema rejects `ai_processing:*` at signup because the international-transfer notice is
not shown at that step). The server then checks: `granted` must be `true` (else `400 CONSENT_REQUIRED`) and
`policyVersion` must be one of `PROFILE_POLICY_VERSIONS` (else `400 CONSENT_INVALID`); a missing or empty list,
or another purpose, is a `400 VALIDATION_ERROR`. On rejection nothing is created and the invite is not consumed.
The stored `ConsentRecord` takes purpose and grant from the server; only the (validated) version comes from the
client. Phase 2 routes that process profile data must gate on
`hasGrantedConsent(req.auth.db, req.auth.ownerId, 'profile_processing')` (`src/consent`): the **latest** record
for the purpose wins, so a later withdrawal revokes an earlier grant; the owner-scoped client makes a mismatched
`ownerId` throw instead of reading another owner's consent.

### Rotas

| Método e caminho                 | Auth    | Descrição                                                               |
| -------------------------------- | ------- | ----------------------------------------------------------------------- |
| `GET /health`, `GET /api/health` | pública | Liveness                                                                |
| `POST /api/auth/invites/preview` | pública | `{token}` → `{email, expiresAt}`                                        |
| `POST /api/auth/invites/accept`  | pública | Cria a conta, grava o consentimento obrigatório, `201`, inicia a sessão |
| `POST /api/auth/login`           | pública | `{email, password}` → `{user, session}`                                 |
| `GET /api/auth/me`               | sessão  | `{user, session}`                                                       |
| `POST /api/auth/logout`          | sessão  | Revoga a sessão atual → `{revokedSessions}`                             |
| `POST /api/auth/logout-all`      | sessão  | Revoga todas as sessões do usuário                                      |

Os DTOs estão em `packages/contracts/src/api/` (`auth.ts`, `errors.ts`). Erros seguem
`{ error: { code, message, requestId, details? } }` (`details` só com caminho e motivo, nunca o valor).

## CLI de convites

```
pnpm --filter @chameleon/api admin:invite <email> [--expires-in-hours N] [--replace]
pnpm --filter @chameleon/api admin:invite <email> --revoke
```

Lê o `.env` da raiz. Cria um convite para o e-mail (validade padrão **72 h**, até 720 h), imprime o
**token uma única vez** e o link `APP_ORIGIN/accept-invite#token=<token>` (o token vai no fragmento,
que o navegador não envia ao servidor; a tela de aceite é da S1.3). No banco fica só o SHA-256.
Existe no máximo **um convite em aberto por e-mail** (índice parcial): um segundo pedido falha a menos
que o anterior tenha expirado ou que se use `--replace`. `--revoke` encerra o convite em aberto. Um
convite revogado/substituído é registrado como `usedAt` preenchido **sem** `usedByUserId`. A CLI recusa
e-mail que já tem conta. Códigos de saída: `0` ok, `1` erro de regra de negócio, `2` uso incorreto.

## Como um módulo de domínio entra (S2+)

```ts
// src/modules/profiles/index.ts
export const profilesModule: ApiModule = ({ routes, profileStore }) => {
  // auth: 'session' makes the registry put requireAuth in front of the handlers: it cannot be forgotten.
  routes.get('/profiles/:id', { auth: 'session' }, async (req, res) => {
    const auth = requireAuthContext(req);
    const revision = await profileStore.getRevision(auth.ownerId, String(req.params.id)); // owner-scoped
    if (!revision)
      return void (res.status(404).json(/* standard 404 body, same as "other owner" */));
    res.json(revision);
  });
};
// createApp({ ..., modules: [profilesModule] })
```

Rules:

- Every route is declared by `routes.<method>(path, { auth }, ...handlers)` (otherwise it shows up as
  `unclassified` in the manifest and the gate fails).
- `auth: 'session'` is **structural**: `RouteRegistry` prepends the session guard itself (an explicit
  `requireAuth` in the handler list is accepted and deduplicated). `auth: 'public'` routes never see
  `req.auth`, and registering one together with the session guard throws at startup.
- The module context carries **no `Db`**. Modules use `req.auth.db` / `req.auth.ownerId` or the injected
  `profileStore`. `db.global`, `db.unsafeRaw` and raw SQL (`$queryRaw*`, `$executeRaw*`, `$queryRawTyped`,
  `$runCommandRaw`) are restricted by ESLint to `packages/db` and `apps/api/src/auth` (`unsafeRaw` is only used by
  `auth/sessions.ts`); the auth module receives the unrestricted handle as `AuthModuleDeps.authDb`.
- A resource that does not exist and one that belongs to another owner answer the same (404).

## Manifesto de rotas (gate de isolamento da S1.4)

`getRouteManifest(app)` (exportado por `@chameleon/api`) percorre a pilha **real** do Express e devolve
`{ method, path, auth: 'public' | 'session' | 'unclassified', mutating, resourceParams, hasResourceParam,
description? }`. `resourceParams` vem do próprio caminho (`:id`). O gate deve falhar se alguma rota for
`unclassified` ou se `hasResourceParam` não tiver caso cruzado A/B.

## Observabilidade e logs

`pino` + `pino-http`. O log de acesso tem só: `reqId` (id de correlação **gerado no servidor**, devolvido em
`X-Request-Id` e gravado em `AuditEvent.correlationId`), `clientRequestId` (o `X-Request-Id` do cliente se casar
`^[A-Za-z0-9._-]{8,64}$`; só em log, nunca confiado), método, **template da rota casada** (`/api/things/:id`, ou
`<unmatched>`; nunca a URL crua nem a query), status, duração e `ownerId` (UUID). Nunca cabeçalhos, cookies, corpo nem query. Erros 5xx registram tipo,
código e quadros de pilha, **sem a mensagem** (que pode carregar trechos do corpo ou do SQL). `REDACT_PATHS`
é a segunda linha de defesa. Erros 4xx por JSON malformado não ecoam o conteúdo.

## Testes e helpers para a QA (S1.4)

- `test/helpers/` (importáveis por `tests/integration/**`): `buildTestApp(db, opts)` (app completo com log
  capturado e limites altos), `TestClient` (cookie jar manual + `Origin` + `X-CSRF-Token`, com opções para
  testes negativos), `createTestAccount` e **`createTwoAccounts({app, config, db})`** → `{a, b}` com
  clientes autenticados criados pelo fluxo real de convite (enviando `TEST_SIGNUP_CONSENTS`, o consentimento
  obrigatório), `LogCapture`, `testConfig`, `expectSessionRoutesRejectAnonymous(app, config)` (varre o manifesto e
  exige 401 sem cookie em toda rota `session`).
- Arquivos: `*.test.ts` (sem banco), `*.int.test.ts` (banco real via `createTestDb`).
- Nos testes, **leia/escreva datas pelo Prisma**, não por SQL cru: o cluster local usa
  `TimeZone=America/Sao_Paulo` e o `@prisma/adapter-pg` grava `DateTime` sem fuso, então um valor gravado
  pelo Prisma e lido por SQL cru (ou comparado com `now()`) difere do instante real pelo deslocamento do
  fuso (3 h). Dentro do Prisma tudo é consistente. Correção estrutural pertence a `packages/db`
  (forçar `TimeZone=UTC` na conexão/banco).
