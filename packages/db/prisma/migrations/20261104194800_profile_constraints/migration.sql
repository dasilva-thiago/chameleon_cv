-- Restricoes do agregado de perfil que o Prisma nao expressa (S1.1b; ADR-0005/0006/0007; domain-model §3.2).
-- Identificadores entre aspas (tabelas PascalCase, colunas camelCase). Cada CHECK/trigger tem nome
-- proprio: os testes conferem o NOME da constraint (a mensagem do PostgreSQL e localizada).

-- ---------------------------------------------------------------------------
-- 1. Funcao de formato de `field_states` (ADR-0005; contrato 2.1.0: chaves aninhadas ate 3 niveis)
-- ---------------------------------------------------------------------------
-- Chave: campo ou caminho `metric.value` / `business.portfolio_url` (mesmo regex de FIELD_NAME_REGEX);
-- valor: um dos 5 estados. A existencia do campo no tipo de registro e validada pelo contrato Zod.
CREATE FUNCTION chameleon_field_states_valid(fs jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT fs IS NULL OR (
    jsonb_typeof(fs) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(fs) AS e
       WHERE char_length(e.key) > 200
          OR e.key !~ '^[a-z][a-z0-9_]{0,63}(\.[a-z][a-z0-9_]{0,63}){0,2}$'
          OR jsonb_typeof(e.value) <> 'string'
          OR (e.value #>> '{}') NOT IN ('not_provided', 'not_applicable', 'not_assessed', 'declined', 'needs_confirmation')
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. ProfessionalProfile
-- ---------------------------------------------------------------------------
-- No maximo um perfil primario por dono (o MVP tem um perfil por dono).
CREATE UNIQUE INDEX "ProfessionalProfile_primary_key" ON "ProfessionalProfile" ("ownerId") WHERE "isPrimary";

-- Versao do contrato persistida: 2.x (2.0.0 legado de revisoes/arquivos antigos; 2.1.0 corrente).
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_schemaVersion_chk"
  CHECK ("schemaVersion" ~ '^2\.[0-9]+\.[0-9]+$');

ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_blocks_object_chk"
  CHECK (
    ("identity" IS NULL OR jsonb_typeof("identity") = 'object')
    AND ("positioning" IS NULL OR jsonb_typeof("positioning") = 'object')
    AND ("availabilityPreferences" IS NULL OR jsonb_typeof("availabilityPreferences") = 'object')
    AND ("careerPreferences" IS NULL OR jsonb_typeof("careerPreferences") = 'object')
    AND ("resumePreferences" IS NULL OR jsonb_typeof("resumePreferences") = 'object')
    AND ("additionalContext" IS NULL OR jsonb_typeof("additionalContext") = 'object')
    AND ("usageRules" IS NULL OR jsonb_typeof("usageRules") = 'object')
    AND ("review" IS NULL OR jsonb_typeof("review") = 'object')
  );

-- Blocos singleton carregam `field_states` proprio (mesmo formato do `meta.field_states`).
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_field_states_chk"
  CHECK (
    chameleon_field_states_valid("identity" -> 'field_states')
    AND chameleon_field_states_valid("positioning" -> 'field_states')
    AND chameleon_field_states_valid("availabilityPreferences" -> 'field_states')
    AND chameleon_field_states_valid("careerPreferences" -> 'field_states')
    AND chameleon_field_states_valid("resumePreferences" -> 'field_states')
    AND chameleon_field_states_valid("additionalContext" -> 'field_states')
    AND chameleon_field_states_valid("usageRules" -> 'field_states')
    AND chameleon_field_states_valid("review" -> 'field_states')
  );

-- Colecoes de topo que podem constar como `[]` explicito.
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_emptyCollections_chk"
  CHECK ("emptyCollections" <@ ARRAY[
    'contact_points', 'statements', 'competency_examples', 'experiences', 'projects', 'education',
    'courses', 'skills', 'skill_usages', 'languages', 'certifications', 'awards', 'publications',
    'volunteering', 'evidence', 'pending_items'
  ]::text[]);

-- ---------------------------------------------------------------------------
-- 3. ProfileFact (governanca)
-- ---------------------------------------------------------------------------
ALTER TABLE "ProfileFact" ADD CONSTRAINT "ProfileFact_fieldStates_chk"
  CHECK (chameleon_field_states_valid("fieldStates"));

ALTER TABLE "ProfileFact" ADD CONSTRAINT "ProfileFact_metaKeys_chk"
  CHECK (
    "metaKeys" <@ ARRAY[
      'status', 'declared_status', 'visibility', 'resume_use', 'source', 'source_detail',
      'source_excerpt', 'evidence_ids', 'field_states', 'private_notes'
    ]::text[]
    AND ("metaPresent" OR cardinality("metaKeys") = 0)
  );

-- `archivedAt` existe se e somente se o fato esta arquivado (arquivar e o padrao de exclusao, ADR-0006).
ALTER TABLE "ProfileFact" ADD CONSTRAINT "ProfileFact_archived_chk"
  CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL));

ALTER TABLE "ProfileFact" ADD CONSTRAINT "ProfileFact_sortOrder_chk" CHECK ("sortOrder" >= 0);

-- ---------------------------------------------------------------------------
-- 4. Coerencia ProfileFact.kind x tabela tipada (gap documentado na S1.1a)
-- ---------------------------------------------------------------------------
-- (a) a linha tipada so pode apontar para um fato do `kind` correspondente (e do mesmo perfil, quando
--     a tabela tem `profileId`); (b) todo fato precisa ter a linha tipada ao final da transacao
--     (CONSTRAINT TRIGGER deferivel: fato e tipada sao inseridos na mesma transacao); (c) a linha
--     tipada nao pode ser apagada deixando o fato orfao; (d) `kind` e imutavel.
CREATE FUNCTION chameleon_fact_kind_table(k text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE k
    WHEN 'statement' THEN 'ProfileStatement'
    WHEN 'competency_example' THEN 'CompetencyExample'
    WHEN 'experience' THEN 'Experience'
    WHEN 'experience_item' THEN 'ExperienceItem'
    WHEN 'project' THEN 'Project'
    WHEN 'project_item' THEN 'ProjectItem'
    WHEN 'education' THEN 'Education'
    WHEN 'course' THEN 'Course'
    WHEN 'skill' THEN 'Skill'
    WHEN 'skill_usage' THEN 'SkillUsage'
    WHEN 'language' THEN 'LanguageProficiency'
    WHEN 'certification' THEN 'Certification'
    WHEN 'award' THEN 'Award'
    WHEN 'publication' THEN 'Publication'
    WHEN 'volunteering' THEN 'Volunteering'
  END;
$$;

CREATE FUNCTION chameleon_typed_row_matches_fact() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fact_kind text;
  fact_profile uuid;
BEGIN
  SELECT f."kind"::text, f."profileId" INTO fact_kind, fact_profile
    FROM "ProfileFact" f WHERE f."id" = NEW."id" AND f."ownerId" = NEW."ownerId";
  IF NOT FOUND THEN
    RETURN NEW; -- fato inexistente: a FK composta reporta o erro
  END IF;
  IF fact_kind <> TG_ARGV[0] THEN
    RAISE EXCEPTION '%_fact_kind_chk: ProfileFact.kind "%" incoerente com a tabela % (esperado "%")',
      TG_TABLE_NAME, fact_kind, TG_TABLE_NAME, TG_ARGV[0]
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_fact_kind_chk';
  END IF;
  IF (to_jsonb(NEW) ? 'profileId') AND (to_jsonb(NEW) ->> 'profileId')::uuid <> fact_profile THEN
    RAISE EXCEPTION '%_fact_profile_chk: o perfil da linha difere do perfil do ProfileFact', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_fact_profile_chk';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION chameleon_fact_has_typed_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tbl text;
  found_row boolean;
BEGIN
  -- O fato pode ter sido apagado depois do INSERT, na mesma transacao.
  IF NOT EXISTS (SELECT 1 FROM "ProfileFact" WHERE "id" = NEW."id" AND "ownerId" = NEW."ownerId") THEN
    RETURN NULL;
  END IF;
  tbl := chameleon_fact_kind_table(NEW."kind"::text);
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1 AND "ownerId" = $2)', tbl)
    INTO found_row USING NEW."id", NEW."ownerId";
  IF NOT found_row THEN
    RAISE EXCEPTION 'ProfileFact_typed_row_chk: ProfileFact do tipo "%" sem linha na tabela %', NEW."kind", tbl
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ProfileFact_typed_row_chk';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION chameleon_typed_row_has_fact() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Apagar a linha tipada isolada deixaria o fato orfao (a cascata fato -> tipada nao entra aqui:
  -- ao final da transacao o fato ja nao existe).
  IF EXISTS (SELECT 1 FROM "ProfileFact" WHERE "id" = OLD."id" AND "ownerId" = OLD."ownerId") THEN
    RAISE EXCEPTION '%_fact_orphan_chk: a linha tipada foi apagada mas o ProfileFact continua', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_fact_orphan_chk';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION chameleon_fact_kind_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" <> OLD."kind" THEN
    RAISE EXCEPTION 'ProfileFact_kind_immutable_chk: ProfileFact.kind nao pode mudar (% -> %)', OLD."kind", NEW."kind"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ProfileFact_kind_immutable_chk';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProfileFact_kind_immutable" BEFORE UPDATE OF "kind" ON "ProfileFact"
  FOR EACH ROW EXECUTE FUNCTION chameleon_fact_kind_immutable();

CREATE CONSTRAINT TRIGGER "ProfileFact_typed_row" AFTER INSERT ON "ProfileFact"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chameleon_fact_has_typed_row();

DO $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['ProfileStatement', 'statement'],
    ['CompetencyExample', 'competency_example'],
    ['Experience', 'experience'],
    ['ExperienceItem', 'experience_item'],
    ['Project', 'project'],
    ['ProjectItem', 'project_item'],
    ['Education', 'education'],
    ['Course', 'course'],
    ['Skill', 'skill'],
    ['SkillUsage', 'skill_usage'],
    ['LanguageProficiency', 'language'],
    ['Certification', 'certification'],
    ['Award', 'award'],
    ['Publication', 'publication'],
    ['Volunteering', 'volunteering']
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION chameleon_typed_row_matches_fact(%L)',
      pair[1] || '_fact_kind', pair[1], pair[2]);
    EXECUTE format(
      'CREATE CONSTRAINT TRIGGER %I AFTER DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chameleon_typed_row_has_fact()',
      pair[1] || '_fact_orphan', pair[1]);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Datas parciais: date + precisao andam juntas; `present` exclui a data final
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['Experience', 'startDate', 'startPrecision'],
    ['Experience', 'endDate', 'endPrecision'],
    ['Project', 'startDate', 'startPrecision'],
    ['Project', 'endDate', 'endPrecision'],
    ['Education', 'startDate', 'startPrecision'],
    ['Education', 'completionDate', 'completionPrecision'],
    ['Education', 'expectedCompletionDate', 'expectedCompletionPrecision'],
    ['Course', 'startDate', 'startPrecision'],
    ['Course', 'completionDate', 'completionPrecision'],
    ['SkillUsage', 'startDate', 'startPrecision'],
    ['SkillUsage', 'endDate', 'endPrecision'],
    ['Certification', 'issueDate', 'issuePrecision'],
    ['Certification', 'expirationDate', 'expirationPrecision'],
    ['Award', 'date', 'datePrecision'],
    ['Publication', 'date', 'datePrecision'],
    ['Volunteering', 'startDate', 'startPrecision'],
    ['Volunteering', 'endDate', 'endPrecision'],
    ['Evidence', 'evidenceDate', 'evidenceDatePrecision']
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%I IS NULL) = (%I IS NULL))',
      spec[1], spec[1] || '_' || spec[2] || '_precision_chk', spec[2], spec[3]);
    -- A data armazenada e sempre o primeiro dia do periodo declarado.
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I >= DATE ''1000-01-01'')',
      spec[1], spec[1] || '_' || spec[2] || '_min_chk', spec[2], spec[2]);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I <> ''year'' OR (EXTRACT(MONTH FROM %I) = 1 AND EXTRACT(DAY FROM %I) = 1))',
      spec[1], spec[1] || '_' || spec[2] || '_year_chk', spec[3], spec[3], spec[2], spec[2]);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I <> ''month'' OR EXTRACT(DAY FROM %I) = 1)',
      spec[1], spec[1] || '_' || spec[2] || '_month_chk', spec[3], spec[3], spec[2]);
  END LOOP;
END
$$;

-- `end_date: present` (isCurrent) nao convive com data final.
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_isCurrent_chk" CHECK (NOT "isCurrent" OR "endDate" IS NULL);
ALTER TABLE "Project" ADD CONSTRAINT "Project_isCurrent_chk" CHECK (NOT "isCurrent" OR "endDate" IS NULL);
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_isCurrent_chk" CHECK (NOT "isCurrent" OR "endDate" IS NULL);
ALTER TABLE "Volunteering" ADD CONSTRAINT "Volunteering_isCurrent_chk" CHECK (NOT "isCurrent" OR "endDate" IS NULL);

-- ---------------------------------------------------------------------------
-- 6. Competencias e contexto de uso (ADR-0007)
-- ---------------------------------------------------------------------------
-- No maximo uma fonte tipada por uso.
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_single_source_chk"
  CHECK (num_nonnulls("experienceId", "projectId", "educationId", "courseId", "certificationId", "volunteeringId") <= 1);

-- O contexto e estrutural: ter so "estudo" nunca produz uma linha `professional_experience`.
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_context_source_chk"
  CHECK (
    CASE "usageContext"
      WHEN 'professional_experience' THEN "experienceId" IS NOT NULL
      WHEN 'project_experience' THEN "projectId" IS NOT NULL
      WHEN 'volunteer_experience' THEN "volunteeringId" IS NOT NULL OR "experienceId" IS NOT NULL
      WHEN 'coursework' THEN "educationId" IS NOT NULL OR "courseId" IS NOT NULL
      WHEN 'certification' THEN "certificationId" IS NOT NULL
      ELSE TRUE
    END
  );

ALTER TABLE "Skill" ADD CONSTRAINT "Skill_normalizedKey_chk"
  CHECK ("normalizedKey" <> '' AND "normalizedKey" = lower("normalizedKey") AND char_length("name") BETWEEN 1 AND 200);

-- ---------------------------------------------------------------------------
-- 7. Contatos (telefone canonico, contrato 2.1.0)
-- ---------------------------------------------------------------------------
-- Forma canonica: `+` opcional + 7 a 15 digitos. A formatacao para exibicao e de quem renderiza.
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_phone_canonical_chk"
  CHECK ("kind" <> 'phone' OR "value" ~ '^\+?[0-9]{7,15}$');

ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_value_chk"
  CHECK (char_length("value") BETWEEN 1 AND 2048 AND "value" ~ '\S');

ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_subtype_kind_chk"
  CHECK (
    "subtype" IS NULL
    OR ("kind" = 'email' AND "subtype"::text IN ('professional', 'personal', 'other'))
    OR ("kind" = 'phone' AND "subtype"::text IN ('professional', 'personal', 'mobile', 'landline', 'whatsapp', 'other'))
    OR ("kind" = 'link' AND "subtype"::text IN (
         'linkedin', 'github', 'gitlab', 'bitbucket', 'portfolio', 'website', 'behance', 'dribbble',
         'artstation', 'professional', 'personal', 'other'))
  );

-- ---------------------------------------------------------------------------
-- 8. Idiomas, cursos
-- ---------------------------------------------------------------------------
-- Nivel descritivo em texto livre (2.1.0): ate 200 caracteres, nunca promovido a CEFR.
ALTER TABLE "LanguageProficiency" ADD CONSTRAINT "LanguageProficiency_selfDescribedLevel_chk"
  CHECK ("selfDescribedLevel" IS NULL OR char_length("selfDescribedLevel") BETWEEN 1 AND 200);
ALTER TABLE "Course" ADD CONSTRAINT "Course_workloadHours_chk"
  CHECK ("workloadHours" IS NULL OR ("workloadHours" >= 0 AND "workloadHours" <= 100000));

-- ---------------------------------------------------------------------------
-- 9. Evidencias, pendencias, restricoes
-- ---------------------------------------------------------------------------
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_declared_chk"
  CHECK (
    ("supportsPosition" IS NOT NULL OR "evidenceIdsPosition" IS NOT NULL)
    AND ("supportsPosition" IS NULL OR "supportsPosition" >= 0)
    AND ("evidenceIdsPosition" IS NULL OR "evidenceIdsPosition" >= 0)
  );

-- Alvo de pendencia: no maximo um registro (fato, contato ou evidencia); o campo e absoluto ou relativo.
ALTER TABLE "PendingItem" ADD CONSTRAINT "PendingItem_single_target_chk"
  CHECK (num_nonnulls("targetFactId", "targetContactPointId", "targetEvidenceId") <= 1);
ALTER TABLE "PendingItem" ADD CONSTRAINT "PendingItem_targetField_chk"
  CHECK ("targetField" IS NULL OR ("targetField" ~ '^[A-Za-z][A-Za-z0-9_.\[\]]*$' AND char_length("targetField") <= 128));
ALTER TABLE "PendingItem" ADD CONSTRAINT "PendingItem_resolved_chk"
  CHECK ("resolvedAt" IS NULL OR "status" IN ('resolved', 'dismissed'));

ALTER TABLE "UsageRestriction" ADD CONSTRAINT "UsageRestriction_single_target_chk"
  CHECK (num_nonnulls("targetFactId", "targetContactPointId", "targetEvidenceId") <= 1);
-- A restricao precisa de um alvo (registro, campo ou termo) e nao mistura `term` com `field` sem registro.
ALTER TABLE "UsageRestriction" ADD CONSTRAINT "UsageRestriction_has_target_chk"
  CHECK (
    num_nonnulls("targetFactId", "targetContactPointId", "targetEvidenceId", "targetField", "term") >= 1
    AND NOT ("targetField" IS NOT NULL AND "term" IS NOT NULL
             AND num_nonnulls("targetFactId", "targetContactPointId", "targetEvidenceId") = 0)
  );
ALTER TABLE "UsageRestriction" ADD CONSTRAINT "UsageRestriction_targetField_chk"
  CHECK ("targetField" IS NULL OR ("targetField" ~ '^[A-Za-z][A-Za-z0-9_.\[\]]*$' AND char_length("targetField") <= 128));

-- ---------------------------------------------------------------------------
-- 10. ProfileRevision: snapshot imutavel (ADR-0006, item 5)
-- ---------------------------------------------------------------------------
ALTER TABLE "ProfileRevision" ADD CONSTRAINT "ProfileRevision_contentHash_chk"
  CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ProfileRevision" ADD CONSTRAINT "ProfileRevision_schemaVersion_chk"
  CHECK ("schemaVersion" ~ '^2\.[0-9]+\.[0-9]+$');
ALTER TABLE "ProfileRevision" ADD CONSTRAINT "ProfileRevision_revisionNumber_chk"
  CHECK ("revisionNumber" >= 1);
ALTER TABLE "ProfileRevision" ADD CONSTRAINT "ProfileRevision_snapshot_chk"
  CHECK (jsonb_typeof("snapshot") = 'object' AND "snapshot" ->> 'schema_version' = "schemaVersion");

-- UPDATE e DELETE sempre falham. Unica excecao: DELETE dentro de transacao com
-- `SET LOCAL chameleon.allow_purge = 'on'` (exclusao de conta, ADR-0014).
CREATE FUNCTION chameleon_forbid_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('chameleon.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ProfileRevision_immutable: ProfileRevision e imutavel (% bloqueado)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'ProfileRevision_immutable';
END;
$$;

CREATE TRIGGER "ProfileRevision_immutable" BEFORE UPDATE OR DELETE ON "ProfileRevision"
  FOR EACH ROW EXECUTE FUNCTION chameleon_forbid_revision_mutation();

-- ---------------------------------------------------------------------------
-- 11. ImportRecord
-- ---------------------------------------------------------------------------
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_applied_chk"
  CHECK (("status" = 'applied') = ("appliedAt" IS NOT NULL));
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_json_types_chk"
  CHECK (
    jsonb_typeof("steps") = 'array' AND jsonb_typeof("warnings") = 'array'
    AND jsonb_typeof("errors") = 'array' AND jsonb_typeof("unmapped") = 'array'
    AND jsonb_typeof("idMap") = 'object' AND jsonb_typeof("summary") = 'object'
  );
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_versions_chk"
  CHECK (
    "targetSchemaVersion" ~ '^2\.[0-9]+\.[0-9]+$'
    AND ("sourceSchemaVersion" IS NULL OR "sourceSchemaVersion" ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
  );
-- Uma revisao so existe em importacao aplicada.
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_revision_chk"
  CHECK ("revisionId" IS NULL OR "status" = 'applied');
