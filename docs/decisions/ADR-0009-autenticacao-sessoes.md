# ADR-0009 — Autenticação, sessões e rate limit

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
O plano §17 pede senhas com hash seguro, cookies `HttpOnly`/`Secure`/`SameSite`, TLS em produção e, no início, acesso privado ou lista de usuários autorizados. O escopo do MVP é e-mail + senha.

## Decisão
- **Sessões no servidor** (tabela `Session`):
  - token aleatório de 32 bytes (`crypto.randomBytes`), entregue em cookie e armazenado **apenas** como SHA-256;
  - expiração deslizante de 7 dias e absoluta de 30 dias;
  - rotação no login e em mudança de senha;
  - logout revoga a sessão; "sair de todos os dispositivos" revoga todas.
- **Cookie:** `__Host-cc_session` em produção (`Secure`, `Path=/`, sem `Domain`), `HttpOnly`, `SameSite=Lax`. Em desenvolvimento, `cc_session` sem `Secure` em `localhost`.
- **CSRF:** verificação de `Origin`/`Referer` contra `APP_ORIGIN` + cabeçalho `X-CSRF-Token` (double-submit, com cookie legível não-HttpOnly) em métodos não seguros.
- **Senha:** argon2id via `@node-rs/argon2` (parâmetros OWASP: m=19 MiB, t=2, p=1, revisáveis), mínimo de 12 caracteres, verificação de lista de senhas comuns (lista local pequena). Não há política de composição forçada.
- **Cadastro:** `SIGNUP_MODE=invite` (padrão no MVP) | `open` | `closed`. O primeiro convite é emitido por CLI (`pnpm --filter @chameleon/api admin:invite <email>`).
- **Rate limit** (`express-rate-limit`, store em memória no MVP de instância única):
  - login: 5 por 15 min por IP+e-mail;
  - cadastro e convite: 10 por hora por IP;
  - rotas de IA: limite por usuário + teto diário de tokens (`AI_DAILY_TOKEN_LIMIT_PER_USER`).
  Ao escalar horizontalmente, troca-se por store em Postgres.
- **Mensagens de erro de login genéricas.** O tempo de resposta é equalizado com um hash fictício para e-mail inexistente.
- **`helmet`** com CSP restritiva para a SPA servida pela API em produção.

## Alternativas
- **JWT em localStorage:** exposto a XSS e sem revogação simples.
- **better-auth (1.7.x):** completo e com adaptador Prisma, mas adiciona tabelas e convenções próprias e muita superfície para um MVP de e-mail+senha. Reavaliar se houver OAuth ou 2FA.
- **Lucia:** descontinuada como biblioteca.
- **bcrypt:** aceitável, mas argon2id é a recomendação atual da OWASP.

## Consequências
- Implementação própria e pequena, a ser **revisada pelo security-reviewer** antes de sair da Fase 1.
- Não há SSO no MVP.

## Verificação
Testes de integração:
- os flags do cookie;
- o token não aparece em claro no banco;
- a rotação no login;
- CSRF sem cabeçalho → 403;
- 6ª tentativa de login → 429;
- e-mail inexistente e senha errada → mesma resposta;
- sessão expirada → 401.
