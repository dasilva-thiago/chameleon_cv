-- Fuso da base: UTC. Todas as colunas de instante ja sao timestamptz(3) (identity_init/profile_init),
-- entao nao ha dado a converter; o que faltava era a sessao: o @prisma/adapter-pg envia DateTime sem
-- deslocamento e o cluster local usa America/Sao_Paulo (12:00Z era gravado como 15:00Z). O app e o
-- harness tambem forcam `-c timezone=UTC` por conexao (src/client.ts); isto cobre psql, jobs e ferramentas.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;
