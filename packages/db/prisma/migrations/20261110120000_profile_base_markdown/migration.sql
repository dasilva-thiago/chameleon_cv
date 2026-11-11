-- Base profissional em Markdown (fluxo career-ops). Substitui o perfil estruturado (ProfileFact e tabelas tipadas,
-- revisoes, importacoes, evidencias, pendencias, restricoes) por dois textos: o CV e o perfil/regras.
--
-- Dados: avaliacoes (JobAnalysis) e curriculos (Resume/ResumeVersion) do formato antigo nao sao compativeis com o
-- novo (o conteudo citava ids de registros que deixam de existir) e sao apagados; as vagas (JobPosting) ficam.
-- Faca backup antes de aplicar em producao. A base nova e criada depois, pelo app ou pelo script de carga.

DELETE FROM "Resume";
DELETE FROM "JobAnalysis";
UPDATE "JobPosting" SET "status" = 'saved' WHERE "status" = 'analyzed';

ALTER TABLE "JobAnalysis" DROP CONSTRAINT "JobAnalysis_json_chk";

-- DropForeignKey
ALTER TABLE "Award" DROP CONSTRAINT "Award_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Certification" DROP CONSTRAINT "Certification_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "CompetencyExample" DROP CONSTRAINT "CompetencyExample_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "CompetencyExampleSkill" DROP CONSTRAINT "CompetencyExampleSkill_exampleId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "CompetencyExampleSkill" DROP CONSTRAINT "CompetencyExampleSkill_skillId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ContactPoint" DROP CONSTRAINT "ContactPoint_profileId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Course" DROP CONSTRAINT "Course_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Education" DROP CONSTRAINT "Education_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Evidence" DROP CONSTRAINT "Evidence_profileId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "EvidenceLink" DROP CONSTRAINT "EvidenceLink_evidenceId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "EvidenceLink" DROP CONSTRAINT "EvidenceLink_factId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Experience" DROP CONSTRAINT "Experience_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ExperienceItem" DROP CONSTRAINT "ExperienceItem_experienceId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ExperienceItem" DROP CONSTRAINT "ExperienceItem_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRecord" DROP CONSTRAINT "ImportRecord_profileId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRecord" DROP CONSTRAINT "ImportRecord_revisionId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "LanguageProficiency" DROP CONSTRAINT "LanguageProficiency_certificationId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "LanguageProficiency" DROP CONSTRAINT "LanguageProficiency_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "PendingItem" DROP CONSTRAINT "PendingItem_profileId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "PendingItem" DROP CONSTRAINT "PendingItem_targetContactPointId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "PendingItem" DROP CONSTRAINT "PendingItem_targetEvidenceId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "PendingItem" DROP CONSTRAINT "PendingItem_targetFactId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ProfessionalProfile" DROP CONSTRAINT "ProfessionalProfile_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ProfileFact" DROP CONSTRAINT "ProfileFact_profileId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ProfileRevision" DROP CONSTRAINT "ProfileRevision_profileId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ProfileStatement" DROP CONSTRAINT "ProfileStatement_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_relatedEducationId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_relatedExperienceId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectCollaborator" DROP CONSTRAINT "ProjectCollaborator_projectId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectItem" DROP CONSTRAINT "ProjectItem_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectItem" DROP CONSTRAINT "ProjectItem_projectId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Publication" DROP CONSTRAINT "Publication_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ResumeVersion" DROP CONSTRAINT "ResumeVersion_profileRevisionId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Skill" DROP CONSTRAINT "Skill_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Skill" DROP CONSTRAINT "Skill_profileId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SkillUsage" DROP CONSTRAINT "SkillUsage_certificationId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SkillUsage" DROP CONSTRAINT "SkillUsage_courseId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SkillUsage" DROP CONSTRAINT "SkillUsage_educationId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SkillUsage" DROP CONSTRAINT "SkillUsage_experienceId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SkillUsage" DROP CONSTRAINT "SkillUsage_id_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SkillUsage" DROP CONSTRAINT "SkillUsage_projectId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SkillUsage" DROP CONSTRAINT "SkillUsage_skillId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SkillUsage" DROP CONSTRAINT "SkillUsage_volunteeringId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "UsageRestriction" DROP CONSTRAINT "UsageRestriction_profileId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "UsageRestriction" DROP CONSTRAINT "UsageRestriction_targetContactPointId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "UsageRestriction" DROP CONSTRAINT "UsageRestriction_targetEvidenceId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "UsageRestriction" DROP CONSTRAINT "UsageRestriction_targetFactId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Volunteering" DROP CONSTRAINT "Volunteering_id_ownerId_fkey";

-- AlterTable
ALTER TABLE "JobAnalysis" DROP COLUMN "review",
DROP COLUMN "reviewedAt";

-- DropTable
DROP TABLE "Award";

-- DropTable
DROP TABLE "Certification";

-- DropTable
DROP TABLE "CompetencyExample";

-- DropTable
DROP TABLE "CompetencyExampleSkill";

-- DropTable
DROP TABLE "ContactPoint";

-- DropTable
DROP TABLE "Course";

-- DropTable
DROP TABLE "Education";

-- DropTable
DROP TABLE "Evidence";

-- DropTable
DROP TABLE "EvidenceLink";

-- DropTable
DROP TABLE "Experience";

-- DropTable
DROP TABLE "ExperienceItem";

-- DropTable
DROP TABLE "ImportRecord";

-- DropTable
DROP TABLE "LanguageProficiency";

-- DropTable
DROP TABLE "PendingItem";

-- DropTable
DROP TABLE "ProfessionalProfile";

-- DropTable
DROP TABLE "ProfileFact";

-- DropTable
DROP TABLE "ProfileRevision";

-- DropTable
DROP TABLE "ProfileStatement";

-- DropTable
DROP TABLE "Project";

-- DropTable
DROP TABLE "ProjectCollaborator";

-- DropTable
DROP TABLE "ProjectItem";

-- DropTable
DROP TABLE "Publication";

-- DropTable
DROP TABLE "Skill";

-- DropTable
DROP TABLE "SkillUsage";

-- DropTable
DROP TABLE "UsageRestriction";

-- DropTable
DROP TABLE "Volunteering";

-- DropEnum
DROP TYPE "AwardScope";

-- DropEnum
DROP TYPE "CertificationCategory";

-- DropEnum
DROP TYPE "CertificationStatus";

-- DropEnum
DROP TYPE "ContactKind";

-- DropEnum
DROP TYPE "ContactSubtype";

-- DropEnum
DROP TYPE "CourseStatus";

-- DropEnum
DROP TYPE "DatePrecision";

-- DropEnum
DROP TYPE "DegreeType";

-- DropEnum
DROP TYPE "EducationStatus";

-- DropEnum
DROP TYPE "EmploymentType";

-- DropEnum
DROP TYPE "EvidenceType";

-- DropEnum
DROP TYPE "ExperienceItemKind";

-- DropEnum
DROP TYPE "FactKind";

-- DropEnum
DROP TYPE "FactSource";

-- DropEnum
DROP TYPE "FactStatus";

-- DropEnum
DROP TYPE "ImportMode";

-- DropEnum
DROP TYPE "ImportSourceFormat";

-- DropEnum
DROP TYPE "ImportStatus";

-- DropEnum
DROP TYPE "LanguageLevel";

-- DropEnum
DROP TYPE "ParticipationType";

-- DropEnum
DROP TYPE "PendingReason";

-- DropEnum
DROP TYPE "PendingStatus";

-- DropEnum
DROP TYPE "Priority";

-- DropEnum
DROP TYPE "ProjectCategory";

-- DropEnum
DROP TYPE "ProjectItemKind";

-- DropEnum
DROP TYPE "ProjectStatus";

-- DropEnum
DROP TYPE "PublicAccess";

-- DropEnum
DROP TYPE "PublicationStatus";

-- DropEnum
DROP TYPE "PublicationType";

-- DropEnum
DROP TYPE "RecruiterSharing";

-- DropEnum
DROP TYPE "RestrictionRule";

-- DropEnum
DROP TYPE "ResumeUse";

-- DropEnum
DROP TYPE "RevisionReason";

-- DropEnum
DROP TYPE "SelfAssessedLevel";

-- DropEnum
DROP TYPE "SkillCategory";

-- DropEnum
DROP TYPE "StatementKind";

-- DropEnum
DROP TYPE "StudyModality";

-- DropEnum
DROP TYPE "UsageContext";

-- DropEnum
DROP TYPE "Visibility";

-- DropEnum
DROP TYPE "WorkMode";

-- CreateTable
CREATE TABLE "ProfileBase" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "cvMarkdown" TEXT NOT NULL,
    "profileMarkdown" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "revisionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfileBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileBaseRevision" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "cvMarkdown" TEXT NOT NULL,
    "profileMarkdown" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileBaseRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileBase_ownerId_key" ON "ProfileBase"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileBase_id_ownerId_key" ON "ProfileBase"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ProfileBaseRevision_ownerId_createdAt_idx" ON "ProfileBaseRevision"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileBaseRevision_id_ownerId_key" ON "ProfileBaseRevision"("id", "ownerId");

-- AddForeignKey
ALTER TABLE "ProfileBase" ADD CONSTRAINT "ProfileBase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileBase" ADD CONSTRAINT "ProfileBase_revisionId_ownerId_fkey" FOREIGN KEY ("revisionId", "ownerId") REFERENCES "ProfileBaseRevision"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileBaseRevision" ADD CONSTRAINT "ProfileBaseRevision_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_profileRevisionId_ownerId_fkey" FOREIGN KEY ("profileRevisionId", "ownerId") REFERENCES "ProfileBaseRevision"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Funcoes do perfil estruturado (as tabelas que as usavam foram removidas acima).
DROP FUNCTION IF EXISTS chameleon_typed_row_matches_fact() CASCADE;
DROP FUNCTION IF EXISTS chameleon_typed_row_has_fact() CASCADE;
DROP FUNCTION IF EXISTS chameleon_fact_has_typed_row() CASCADE;
DROP FUNCTION IF EXISTS chameleon_fact_kind_immutable() CASCADE;
DROP FUNCTION IF EXISTS chameleon_fact_kind_table(text) CASCADE;
DROP FUNCTION IF EXISTS chameleon_field_states_valid(jsonb) CASCADE;
DROP FUNCTION IF EXISTS chameleon_forbid_revision_mutation() CASCADE;

-- JobAnalysis: so IA (a avaliacao do career-ops nao tem versao local); resultado JSON objeto.
ALTER TABLE "JobAnalysis" DROP CONSTRAINT "JobAnalysis_engine_chk";
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_engine_chk"
  CHECK ("engine" IN ('ai') AND length("engineVersion") BETWEEN 1 AND 40);
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_json_chk"
  CHECK (jsonb_typeof("result") = 'object');

-- Integridade da base (defesa em profundidade; o contrato Zod valida os limites).
ALTER TABLE "ProfileBase" ADD CONSTRAINT "ProfileBase_shape_chk" CHECK (
  "contentHash" ~ '^[0-9a-f]{64}$'
  AND length("cvMarkdown") <= 40000
  AND length("profileMarkdown") <= 30000
);
ALTER TABLE "ProfileBaseRevision" ADD CONSTRAINT "ProfileBaseRevision_shape_chk" CHECK (
  "contentHash" ~ '^[0-9a-f]{64}$'
  AND length("cvMarkdown") <= 40000
  AND length("profileMarkdown") <= 30000
);

-- Revisao imutavel: nenhum UPDATE; DELETE so na exclusao de conta (chameleon.allow_purge = 'on').
CREATE FUNCTION chameleon_forbid_base_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('chameleon.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ProfileBaseRevision_immutable: ProfileBaseRevision e imutavel (% bloqueado)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'ProfileBaseRevision_immutable';
END;
$$;

CREATE TRIGGER "ProfileBaseRevision_immutable" BEFORE UPDATE OR DELETE ON "ProfileBaseRevision"
  FOR EACH ROW EXECUTE FUNCTION chameleon_forbid_base_revision_mutation();

-- ownerId imutavel nas tabelas novas (migracao owner_immutable).
SELECT chameleon_install_owner_immutable_triggers();

-- Apagar em cascata (e nao NO ACTION) as referencias a revisao e a avaliacao: o NO ACTION era conferido antes de a
-- cascata do dono/da vaga remover as versoes de curriculo, e a exclusao de conta (ou de uma vaga com curriculo)
-- falhava. Revisoes so somem na exclusao de conta; avaliacoes so com a propria vaga.
ALTER TABLE "ResumeVersion" DROP CONSTRAINT "ResumeVersion_analysisId_ownerId_fkey";
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_analysisId_ownerId_fkey" FOREIGN KEY ("analysisId", "ownerId") REFERENCES "JobAnalysis"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;
