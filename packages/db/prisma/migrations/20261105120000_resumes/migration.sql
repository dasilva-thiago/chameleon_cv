-- CreateEnum
CREATE TYPE "ResumeVersionStatus" AS ENUM ('draft', 'approved');

-- CreateTable
CREATE TABLE "Resume" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeVersion" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "resumeId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "ResumeVersionStatus" NOT NULL DEFAULT 'draft',
    "language" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "issueErrors" INTEGER NOT NULL DEFAULT 0,
    "issueWarnings" INTEGER NOT NULL DEFAULT 0,
    "profileRevisionId" UUID,
    "analysisId" UUID,
    "sourceVersionId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resume_ownerId_jobId_updatedAt_idx" ON "Resume"("ownerId", "jobId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Resume_id_ownerId_key" ON "Resume"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ResumeVersion_ownerId_resumeId_createdAt_idx" ON "ResumeVersion"("ownerId", "resumeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_id_ownerId_key" ON "ResumeVersion"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_resumeId_versionNumber_key" ON "ResumeVersion"("resumeId", "versionNumber");

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_jobId_ownerId_fkey" FOREIGN KEY ("jobId", "ownerId") REFERENCES "JobPosting"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_resumeId_ownerId_fkey" FOREIGN KEY ("resumeId", "ownerId") REFERENCES "Resume"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_profileRevisionId_ownerId_fkey" FOREIGN KEY ("profileRevisionId", "ownerId") REFERENCES "ProfileRevision"("id", "ownerId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_analysisId_ownerId_fkey" FOREIGN KEY ("analysisId", "ownerId") REFERENCES "JobAnalysis"("id", "ownerId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Integridade no banco (defesa em profundidade; o contrato Zod valida o JSON).
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_name_chk" CHECK (length("name") BETWEEN 1 AND 120);
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_shape_chk" CHECK (
  "versionNumber" > 0
  AND "contentHash" ~ '^[0-9a-f]{64}$'
  AND "language" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  AND jsonb_typeof("content") = 'object'
  AND "issueErrors" >= 0 AND "issueWarnings" >= 0
  AND (("status" = 'approved') = ("approvedAt" IS NOT NULL))
);

-- Versao aprovada e imutavel: nenhum UPDATE (conteudo, status, data) e nenhum retorno a rascunho. A copia para
-- editar e uma NOVA linha. Apagar o curriculo (DELETE em cascata) continua permitido.
CREATE FUNCTION chameleon_forbid_approved_resume_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'approved' THEN
    RAISE EXCEPTION 'resume_version_approved: a versao aprovada de curriculo nao pode ser alterada'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'resume_version_approved';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ResumeVersion_approved_immutable"
  BEFORE UPDATE ON "ResumeVersion"
  FOR EACH ROW EXECUTE FUNCTION chameleon_forbid_approved_resume_change();

-- ownerId imutavel (migracao owner_immutable).
SELECT chameleon_install_owner_immutable_triggers();
