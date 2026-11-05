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

## Profile module (S2.1a): `/api/profile/**`

Code in `src/modules/profiles/`; DTOs in `packages/contracts/src/api/profile.ts` (strict Zod, reusing the v2.1.0 record
schemas; no DTO carries an `ownerId` or `profileId`). One primary profile per owner.

**Structural guarantees**

- **Consent gate.** Every route is declared through `profileRoutes()` (`gate.ts`), which puts, in this order, the session guard
  (registry), `requireProfileConsent` and the owner-bound scope in front of the handlers. A caller whose LATEST
  `profile_processing` record is not `granted` (absent or withdrawn) gets `403 CONSENT_REQUIRED_FOR_PROFILE` before any body is
  read. Test: `test/profiles-consent.int.test.ts` sweeps the real manifest.
- **Owner-bound store.** Handlers never see `ProfileStore`: `scopeOf(res)` returns an `OwnerProfileStore` built per request from
  `req.auth` (`scope.ts`); the owner is closed over, `profileId` is not accepted. `test/profiles-owner-binding.test.ts` scans the
  module sources (no `ownerId`, `req.auth` or raw store outside `scope.ts`/`gate.ts`/`index.ts`).
- **Not-found parity.** Missing, foreign and malformed ids in a URL all answer the same `404 NOT_FOUND` (same body). Records are
  created by OMITTING the id (the server generates it); ids the stored profile does not know are `400 VALIDATION_ERROR`, so there
  is no `ID_CONFLICT` existence oracle on edits.
- **Writes are serialized per owner** (`OwnerLocks`, in-process): every edit is read-modify-write over the whole document
  (the contract validates references on the full document). Single-instance assumption.
- **Body limits.** `JSON_BODY_LIMIT_BYTES` (100 KiB) applies everywhere EXCEPT three route patterns that declare their own parser
  with `UPLOAD_MAX_BYTES` (default 2 MiB): `POST /profile/imports/preview`, `PUT /profile` and `PUT /profile/sections/:section`
  (`isLargeBodyRoute`, exact method + path; `app.ts` skips the global parser only for them).
- **Audit trail** (`AuditEvent`, no PII): `profile.save`, `profile.record.*`, `profile.confirm_batch`, `profile.import.*`,
  `profile.revision.create`, `profile.export`.

**Routes** (all `auth: session` + consent gate; mutations also need Origin + `X-CSRF-Token`)

| Method and path                                               | Request DTO                                       | Response DTO                                            |
| ------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/profile`                                            | -                                                 | `ProfileStateResponse` (`exists:false` when no profile) |
| `PUT /api/profile`                                            | `SaveProfileRequest` (`onMissing` default `keep`) | `ProfileWriteResponse`                                  |
| `GET /api/profile/sections/:section`                          | -                                                 | `ProfileSectionResponse`                                |
| `PUT /api/profile/sections/:section`                          | `SaveSectionRequest`                              | `ProfileWriteResponse`                                  |
| `POST /api/profile/records`                                   | `CreateRecordRequest`                             | `ProfileRecordWriteResponse` (`201`)                    |
| `GET /api/profile/records/:recordId`                          | -                                                 | `ProfileRecordResponse`                                 |
| `PUT /api/profile/records/:recordId`                          | `ReplaceRecordRequest`                            | `ProfileRecordWriteResponse`                            |
| `DELETE /api/profile/records/:recordId`                       | -                                                 | `DeleteRecordResponse` (`409 RECORD_IN_USE`)            |
| `PATCH /api/profile/records/:recordId/meta`                   | `PatchRecordMetaRequest`                          | `ProfileRecordWriteResponse`                            |
| `POST /api/profile/records/:recordId/archive`                 | -                                                 | `ProfileRecordWriteResponse`                            |
| `POST /api/profile/confirmations`                             | `ConfirmRecordsRequest` (explicit ids, max 500)   | `ConfirmRecordsResponse`                                |
| `GET /api/profile/evidence`                                   | -                                                 | `EvidenceListResponse`                                  |
| `GET /api/profile/evidence/:evidenceId/links`                 | -                                                 | `EvidenceLinksResponse`                                 |
| `POST /api/profile/evidence/:evidenceId/links`                | `LinkEvidenceRequest`                             | `EvidenceLinksResponse`                                 |
| `DELETE /api/profile/evidence/:evidenceId/links/:recordId`    | -                                                 | `EvidenceLinksResponse` (idempotent)                    |
| `GET /api/profile/pending?status=open/resolved/dismissed/all` | -                                                 | `PendingListResponse`                                   |
| `PATCH /api/profile/pending/:pendingId`                       | `PatchPendingRequest`                             | `ProfileRecordResponse`                                 |
| `POST /api/profile/revisions`                                 | `CreateRevisionRequest`                           | `CreateRevisionResponse` (`201`, `200` if reused)       |
| `GET /api/profile/revisions?limit=&before=`                   | -                                                 | `ListRevisionsResponse`                                 |
| `GET /api/profile/revisions/:revisionId`                      | -                                                 | `RevisionDetailResponse` (`verified` = hash recomputed) |
| `POST /api/profile/imports/preview`                           | `ImportPreviewRequest` or raw `text/yaml` body    | `ImportPreviewResponse` (`201`; `422 IMPORT_INVALID`)   |
| `GET /api/profile/imports?status=&limit=`                     | -                                                 | `ListImportsResponse`                                   |
| `GET /api/profile/imports/:importRecordId`                    | -                                                 | `ImportDetailResponse`                                  |
| `POST /api/profile/imports/:importRecordId/apply`             | `ApplyImportRequest` (`mode` required)            | `ApplyImportResponse`                                   |
| `POST /api/profile/imports/:importRecordId/discard`           | -                                                 | `DiscardImportResponse`                                 |
| `GET /api/profile/export?format=yaml/json`                    | -                                                 | the v2.1.0 document (attachment, `no-store`)            |

**Governance rules the API enforces** (ADR-0005): records have no `meta` until someone sets it (the store treats that as the most
restrictive default); `PATCH .../meta` is the only way to confirm one by one, `POST /confirmations` the only batch way (explicit ids,
only `needs_review` -> `confirmed`; unknown ids are reported as `not_found`, foreign ones identically); `archived` always means
`resume_use: never` (filled when missing, `400` when a write says otherwise, on every write path); a file can never confirm
anything. Per-record edits use `onMissing: archive` over the COMPLETE document (nothing is missing, and link rows removed from
`supports`/`evidence_ids` are really dropped); whole-document and section saves default to `keep` (explicit `archive`/`delete`
only). With `keep`, removing an id from `evidence.supports`/`meta.evidence_ids` does NOT unlink (store limitation): use the
`.../links` routes, or an explicit `onMissing`.

**Import (ADR-0013)**

1. `POST /imports/preview`: JSON `{ text, format?, mode? }` or a raw body (`text/yaml`, `application/yaml`, `application/x-yaml`,
   `text/plain`; `?mode=`). Text is UNTRUSTED: at most `UPLOAD_MAX_BYTES` bytes of UTF-8 (default 2 MiB; `413 PAYLOAD_TOO_LARGE`;
   the JSON envelope is accepted up to 2x + 4 KiB for escaping and then checked on the decoded text), content type allowlist (`415`),
   `profile-io` parse limits (depth 32, 200k nodes, strings 20k, no aliases/anchors/tags/merge keys, no `__proto__`/`constructor`/
   `prototype` keys), then migration/validation. Errors carry a FIXED text per code (JSON/YAML library messages quote the input and are
   never forwarded); nothing from the file reaches the logs. A failing file creates no `ImportRecord` (`422 IMPORT_INVALID`). A valid
   one creates an `ImportRecord` in `preview` (source/target versions, steps, warnings, `idMap`) and returns the `ImportPreview`
   (counts, per-record `create|update|unchanged` against the CURRENT profile, using `getImportIdMap` + the stored document).
   Per-owner quota: 30 previews / 10 min (`429` + `Retry-After`). The first preview creates the (empty) profile row the
   `ImportRecord` hangs from.
2. The processed document of a preview is kept in memory (30 min, 5 per owner, 100 total) because `ImportRecord` does not persist it.
   After a restart or the TTL, apply answers `409 IMPORT_PREVIEW_EXPIRED` and the user previews again.
3. `POST /imports/:id/apply { mode: merge|replace }`: explicit, one-shot. `replace` needs `confirmReplace: true` (it archives facts and
   removes contacts/evidence/pending/restrictions the file omits). Before applying, a revision of the previous state is created
   (`previousRevision`). Everything imported is `needs_review` (`archived` stays `archived`, with `resume_use: never`), EXCEPT records
   the file leaves unchanged against the stored profile: those keep their current `meta` (confirmed/archived decisions survive
   re-importing your own export; a changed record goes back to review). Ids that belong to another account give
   `409 ID_CONFLICT` (no hint of whose); `regenerateConflictingIds: true` imports them with new ids.
4. Re-importing an export is idempotent: `preview.totals.create == 0`, `update == 0`, and applying creates/updates nothing.

**Export.** `GET /export?format=yaml|json` returns the canonical v2.1.0 document with ids (round-trips with import), including
private fields (it is the owner's own data). File name `chameleon-profile-YYYYMMDD.<ext>`, `Content-Disposition: attachment`,
`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. A profile that does not exist yet answers `404`.

**New error codes** (`API_ERROR_CODES`): `CONSENT_REQUIRED_FOR_PROFILE` (403), `IMPORT_INVALID` (422), `IMPORT_PREVIEW_EXPIRED` (409),
`IMPORT_NOT_APPLICABLE` (409), `ID_CONFLICT` (409), `DUPLICATE_SKILL` (409), `CONCURRENT_MODIFICATION` (409), `RECORD_IN_USE` (409).

**Tests.** Unit: `test/profiles-owner-binding.test.ts`, `test/profiles-units.test.ts`, `packages/contracts/test/api-profile.test.ts`.
Integration: `test/profiles-consent.int.test.ts`; `tests/integration/profile-api/` (`import-export` for all 13 fixtures through HTTP,
`records`, `lifecycle`, `hostile`); the A x B case `profile.api/cross-owner-behaves-like-not-found` in `tests/integration/isolation/`.

## Jobs module (P1): `/api/jobs/**`

Saved job postings of the owner. All routes are `auth: 'session'` and use only `req.auth.db` (owner-scoped), so a foreign
id is indistinguishable from a missing one (404). No profile-consent gate: a posting is not profile data (the consent
for **external AI processing** will gate the analysis routes, P2). Job text is untrusted data: stored verbatim (hash =
SHA-256 of the exact text, the cache key of the future analysis), never interpreted, never logged; audit events carry ids
and field names only. DTOs: `packages/contracts/src/api/jobs.ts`.

| Method | Path                          | What                                                                                                                                                                                                                                              |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/jobs?status=&q=&limit=` | List (summaries with an excerpt, no full text). `status`: `active` (default: not closed/archived), `all` or one status. `q` searches title, company, location and text (case-insensitive; `%`/`_` are literal). Always returns `counts` by status |
| POST   | `/api/jobs`                   | Save. Only `description` (≤ 30,000 chars) is required; blank optional text becomes `null`; `url` must be http(s) without credentials                                                                                                              |
| GET    | `/api/jobs/:jobId`            | One job with the original text, hash and notes                                                                                                                                                                                                    |
| PATCH  | `/api/jobs/:jobId`            | Change the sent fields (`null` clears); changing `description` recomputes the hash; `status` also archives                                                                                                                                        |
| DELETE | `/api/jobs/:jobId`            | Delete permanently                                                                                                                                                                                                                                |

Tests: `test/jobs.int.test.ts` (CRUD, validation, search, ownership, anonymous) and the isolation case
`jobs.api/cross-owner-behaves-like-not-found`.

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
