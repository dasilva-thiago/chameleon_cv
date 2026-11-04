-- Restricoes que o Prisma nao expressa (ADR-0006, ADR-0009, ADR-0014). Identificadores entre aspas.

-- Segredos so em hash: SHA-256 hex minusculo (64). Um token em claro (32 bytes em base64url/hex-64
-- aleatorio) nao passa de forma confiavel; o formato e conferido tambem na aplicacao.
ALTER TABLE "Session" ADD CONSTRAINT "Session_tokenHash_format_chk"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tokenHash_format_chk"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- Expiracao absoluta nunca anterior a criacao; deslizante nunca depois da absoluta.
ALTER TABLE "Session" ADD CONSTRAINT "Session_expiry_order_chk"
  CHECK ("absoluteExpiresAt" >= "createdAt" AND "expiresAt" <= "absoluteExpiresAt");

-- Hash de senha nao pode ser vazio; argon2id em formato PHC (`$argon2id$...`).
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_passwordHash_argon2id_chk"
  CHECK ("kind" <> 'password' OR "passwordHash" LIKE '$argon2id$%');

-- Finalidade do consentimento: `<nome>` ou `<nome>:<id>` (ex.: profile_processing, ai_processing:anthropic).
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_purpose_format_chk"
  CHECK ("purpose" ~ '^[a-z][a-z_]*(:[a-z0-9][a-z0-9_.-]*)?$');

-- Um unico convite em aberto (nao usado) por e-mail. Convites usados ficam como historico.
CREATE UNIQUE INDEX "Invite_email_open_key" ON "Invite" ("email") WHERE "usedAt" IS NULL;

-- userAgent truncado (minimizacao).
ALTER TABLE "Session" ADD CONSTRAINT "Session_userAgent_len_chk"
  CHECK ("userAgent" IS NULL OR char_length("userAgent") <= 256);
