// Configuracao do Prisma 7 (CLI). O client em runtime usa o adapter-pg (src/client.ts).
// Os scripts da raiz (`pnpm db:*`) rodam com cwd em packages/db; o .env fica na raiz do repo.
import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile('../../.env');
} catch {
  // sem .env: o ambiente (ex.: CI) fornece DATABASE_URL.
}

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // O CLI (migrate) usa a conexao direta da Neon quando existir: o pooler (PgBouncer) nao serve para
    // migrations. O app em runtime continua usando DATABASE_URL (pooled). Sem Neon, vale DATABASE_URL.
    // `prisma generate` e `prisma validate` nao conectam; o fallback evita exigir .env nesses casos.
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      'postgresql://chameleon@127.0.0.1:54329/chameleon_dev',
  },
});
