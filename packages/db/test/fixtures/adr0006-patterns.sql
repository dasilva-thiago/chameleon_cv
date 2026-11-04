-- DDL do spike da S1.1a (ADR-0006, adendo): os padroes de PK compartilhada e FK composta (id, ownerId)
-- exatamente como o `prisma migrate diff` do Prisma 7.10.1 os gerou para o schema do spike
-- (ProfessionalProfile, ProfileFact, Experience, ExperienceItem, Skill, SkillUsage), mais o CHECK e o
-- trigger de migracao SQL manual. As tabelas usam o prefixo "Spike" para nao colidir com o schema real.
-- Usado por test/adr0006-patterns.int.test.ts em um clone descartavel.

CREATE TYPE "SpikeFactKind" AS ENUM ('experience', 'skill');

CREATE TABLE "SpikeProfile" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    CONSTRAINT "SpikeProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpikeProfile_id_ownerId_key" ON "SpikeProfile"("id", "ownerId");

CREATE TABLE "SpikeFact" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "kind" "SpikeFactKind" NOT NULL,
    CONSTRAINT "SpikeFact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpikeFact_id_ownerId_key" ON "SpikeFact"("id", "ownerId");
ALTER TABLE "SpikeFact" ADD CONSTRAINT "SpikeFact_profileId_ownerId_fkey"
  FOREIGN KEY ("profileId", "ownerId") REFERENCES "SpikeProfile"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- PK compartilhada: Experience.id = Fact.id, FK composta (id, ownerId).
CREATE TABLE "SpikeExperience" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    CONSTRAINT "SpikeExperience_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpikeExperience_id_ownerId_key" ON "SpikeExperience"("id", "ownerId");
ALTER TABLE "SpikeExperience" ADD CONSTRAINT "SpikeExperience_id_ownerId_fkey"
  FOREIGN KEY ("id", "ownerId") REFERENCES "SpikeFact"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SpikeItem" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "experienceId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    CONSTRAINT "SpikeItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpikeItem_id_ownerId_key" ON "SpikeItem"("id", "ownerId");
ALTER TABLE "SpikeItem" ADD CONSTRAINT "SpikeItem_experienceId_ownerId_fkey"
  FOREIGN KEY ("experienceId", "ownerId") REFERENCES "SpikeExperience"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SpikeSkill" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "SpikeSkill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpikeSkill_id_ownerId_key" ON "SpikeSkill"("id", "ownerId");
ALTER TABLE "SpikeSkill" ADD CONSTRAINT "SpikeSkill_id_ownerId_fkey"
  FOREIGN KEY ("id", "ownerId") REFERENCES "SpikeFact"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK composta OPCIONAL: experienceId nulo desliga a FK (MATCH SIMPLE) mesmo com ownerId preenchido.
CREATE TABLE "SpikeUsage" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "experienceId" UUID,
    "projectId" UUID,
    CONSTRAINT "SpikeUsage_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "SpikeUsage" ADD CONSTRAINT "SpikeUsage_skillId_ownerId_fkey"
  FOREIGN KEY ("skillId", "ownerId") REFERENCES "SpikeSkill"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpikeUsage" ADD CONSTRAINT "SpikeUsage_experienceId_ownerId_fkey"
  FOREIGN KEY ("experienceId", "ownerId") REFERENCES "SpikeExperience"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Migracao SQL manual: CHECK e trigger de imutabilidade com excecao `chameleon.allow_purge`.
ALTER TABLE "SpikeUsage" ADD CONSTRAINT "SpikeUsage_single_source_chk"
  CHECK (num_nonnulls("experienceId", "projectId") <= 1);

CREATE FUNCTION chameleon_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('chameleon.allow_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'imutavel: % em %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER "SpikeItem_immutable" BEFORE UPDATE OR DELETE ON "SpikeItem"
  FOR EACH ROW EXECUTE FUNCTION chameleon_forbid_mutation();
