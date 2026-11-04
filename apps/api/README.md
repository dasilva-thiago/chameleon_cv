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

| Variável                | Padrão             | Observações                                                                                                                     |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | (obrigatória)      | `postgres://...`                                                                                                                |
| `APP_ORIGIN`            | (obrigatória)      | Origem da SPA (`https://cv.exemplo.com`, `http://localhost:5173`). Base do CSRF e dos cookies (ver abaixo)                      |
| `API_PORT`              | `3000`             | Ouve só em `127.0.0.1`                                                                                                          |
| `SIGNUP_MODE`           | `invite`           | `invite` (padrão) ou `closed`. `open` é reservado (ADR-0009) e **rejeitado** por enquanto                                       |
| `TRUST_PROXY`           | `0`                | Nº de proxies confiáveis à frente da API. Defina (ex.: `1`) atrás de um proxy reverso, senão o rate limit enxerga o IP do proxy |
| `JSON_BODY_LIMIT_BYTES` | `102400`           | Limite do corpo JSON em `/api` (413 acima). Rotas com payload maior definem o próprio parser                                    |
| `LOG_LEVEL`             | `info`             | `silent` nos testes                                                                                                             |
| demais                  | ver `.env.example` | `STORAGE_ROOT`, `UPLOAD_MAX_BYTES`, `AI_*`, `PDF_BROWSER` pertencem a fatias futuras                                            |

Regras entre variáveis: em `NODE_ENV=production` o `APP_ORIGIN` precisa ser `https`; `http` só é aceito
para `localhost`, `127.0.0.1` e `[::1]`.

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
- **Sem enumeração.** E-mail inexistente, senha errada, conta desativada e conta sem credencial dão a
  mesma resposta `401 INVALID_CREDENTIALS` e o mesmo trabalho (uma verificação argon2, com hash
  fictício). Convite desconhecido, expirado, usado ou revogado dão o mesmo `400 INVITE_INVALID`.

### Rotas

| Método e caminho                 | Auth    | Descrição                                                         |
| -------------------------------- | ------- | ----------------------------------------------------------------- |
| `GET /health`, `GET /api/health` | pública | Liveness                                                          |
| `POST /api/auth/invites/preview` | pública | `{token}` → `{email, expiresAt}`                                  |
| `POST /api/auth/invites/accept`  | pública | Cria a conta (+ consentimentos opcionais), `201`, inicia a sessão |
| `POST /api/auth/login`           | pública | `{email, password}` → `{user, session}`                           |
| `GET /api/auth/me`               | sessão  | `{user, session}`                                                 |
| `POST /api/auth/logout`          | sessão  | Revoga a sessão atual → `{revokedSessions}`                       |
| `POST /api/auth/logout-all`      | sessão  | Revoga todas as sessões do usuário                                |

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
export const profilesModule: ApiModule = ({ routes, requireAuth }) => {
  routes.get('/profiles/:id', { auth: 'session' }, requireAuth, async (req, res) => {
    const auth = requireAuthContext(req);
    const row = await auth.db.profile.findFirst({ where: { id: req.params.id } }); // escopado ao dono
    if (!row) return void (res.status(404).json(/* corpo 404 padrão: igual a "de outro dono" */));
    res.json(row);
  });
};
// createApp({ ..., modules: [profilesModule] })
```

Regras: toda rota é declarada por `routes.<método>(path, { auth }, ...)` (senão aparece como
`unclassified` no manifesto e o gate falha); rotas privadas usam `requireAuth` e **somente**
`req.auth.db` / `req.auth.ownerId` (nunca `db.global`/`db.unsafeRaw` para dado privado; `unsafeRaw` está
restrito a `src/auth/sessions.ts`); recurso inexistente e recurso de outro dono respondem igual (404).

## Manifesto de rotas (gate de isolamento da S1.4)

`getRouteManifest(app)` (exportado por `@chameleon/api`) percorre a pilha **real** do Express e devolve
`{ method, path, auth: 'public' | 'session' | 'unclassified', mutating, resourceParams, hasResourceParam,
description? }`. `resourceParams` vem do próprio caminho (`:id`). O gate deve falhar se alguma rota for
`unclassified` ou se `hasResourceParam` não tiver caso cruzado A/B.

## Observabilidade e logs

`pino` + `pino-http`. O log de acesso tem só: `reqId` (= `X-Request-Id`), método, caminho **sem query**,
status, duração e `ownerId` (UUID). Nunca cabeçalhos, cookies, corpo nem query. Erros 5xx registram tipo,
código e quadros de pilha, **sem a mensagem** (que pode carregar trechos do corpo ou do SQL). `REDACT_PATHS`
é a segunda linha de defesa. Erros 4xx por JSON malformado não ecoam o conteúdo.

## Testes e helpers para a QA (S1.4)

- `test/helpers/` (importáveis por `tests/integration/**`): `buildTestApp(db, opts)` (app completo com log
  capturado e limites altos), `TestClient` (cookie jar manual + `Origin` + `X-CSRF-Token`, com opções para
  testes negativos), `createTestAccount` e **`createTwoAccounts({app, config, db})`** → `{a, b}` com
  clientes autenticados criados pelo fluxo real de convite, `LogCapture`, `testConfig`.
- Arquivos: `*.test.ts` (sem banco), `*.int.test.ts` (banco real via `createTestDb`).
- Nos testes, **leia/escreva datas pelo Prisma**, não por SQL cru: o cluster local usa
  `TimeZone=America/Sao_Paulo` e o `@prisma/adapter-pg` grava `DateTime` sem fuso, então um valor gravado
  pelo Prisma e lido por SQL cru (ou comparado com `now()`) difere do instante real pelo deslocamento do
  fuso (3 h). Dentro do Prisma tudo é consistente. Correção estrutural pertence a `packages/db`
  (forçar `TimeZone=UTC` na conexão/banco).
