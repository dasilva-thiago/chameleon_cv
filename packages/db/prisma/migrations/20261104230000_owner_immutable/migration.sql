-- ownerId imutavel em TODA tabela privada (defesa em profundidade do forOwner, ADR-0008).
--
-- Defeito corrigido: `forOwner(B).contactPoint.update({ data: { profile: { connect: { id: A.profileId } } } })`
-- fazia o Prisma trocar `(profileId, ownerId)` juntos; as FKs compostas ficavam satisfeitas e a linha
-- de B passava a pertencer ao dono A. A camada de aplicacao agora rejeita escrita por relacao; este
-- trigger garante no banco que NENHUM UPDATE (inclusive SQL cru, `db.unsafeRaw`, psql) muda `ownerId`.
-- Tambem cobre as tabelas cuja unica FK e para User (Credential, Session, ConsentRecord, AuditEvent,
-- ProfessionalProfile), onde a FK composta nao ajudava.
--
-- Sem excecao para purge: a exclusao de conta e DELETE (`DELETE FROM "User"` em cascata), que o trigger
-- nao toca. Mudar de dono nunca e uma operacao legitima.
--
-- Tabelas futuras: chame `SELECT chameleon_install_owner_immutable_triggers();` ao fim da migracao que
-- cria a tabela (idempotente). O teste de catalogo (`test/owner-immutable.int.test.ts`) falha se
-- alguma tabela com a coluna "ownerId" ficar sem o trigger.

CREATE FUNCTION chameleon_forbid_owner_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" THEN
    RAISE EXCEPTION 'owner_immutable: "ownerId" de % nao pode ser alterado', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'owner_immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- Instala (ou reinstala) o trigger `<Tabela>_owner_immutable` em toda tabela de `public` com a coluna
-- "ownerId". A lista vem do catalogo, nunca escrita a mao. Devolve os nomes das tabelas tratadas.
CREATE FUNCTION chameleon_install_owner_immutable_triggers() RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.relname::text
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'ownerId' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     ORDER BY 1
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tbl || '_owner_immutable', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW '
      'WHEN (OLD."ownerId" IS DISTINCT FROM NEW."ownerId") '
      'EXECUTE FUNCTION chameleon_forbid_owner_change()',
      tbl || '_owner_immutable', tbl);
    RETURN NEXT tbl;
  END LOOP;
END;
$$;

SELECT chameleon_install_owner_immutable_triggers();
