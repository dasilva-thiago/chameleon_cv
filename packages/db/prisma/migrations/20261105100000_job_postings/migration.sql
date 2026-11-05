-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('saved', 'analyzed', 'application_prepared', 'application_sent', 'interview', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "JobWorkMode" AS ENUM ('remote', 'hybrid', 'onsite');

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" TEXT,
    "company" TEXT,
    "url" TEXT,
    "location" TEXT,
    "workMode" "JobWorkMode",
    "postedOn" DATE,
    "status" "JobStatus" NOT NULL DEFAULT 'saved',
    "description" TEXT NOT NULL,
    "descriptionHash" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPosting_ownerId_status_updatedAt_idx" ON "JobPosting"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "JobPosting_ownerId_createdAt_idx" ON "JobPosting"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosting_id_ownerId_key" ON "JobPosting"("id", "ownerId");

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integridade no banco (defesa em profundidade; o contrato Zod e a primeira barreira).
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_description_chk"
  CHECK (length("description") BETWEEN 1 AND 30000 AND "description" ~ '\S');
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_descriptionHash_chk"
  CHECK ("descriptionHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_short_text_chk"
  CHECK (
    length(coalesce("title", '')) <= 200 AND length(coalesce("company", '')) <= 200
    AND length(coalesce("location", '')) <= 200 AND length(coalesce("url", '')) <= 2048
    AND length(coalesce("notes", '')) <= 5000
  );
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_url_scheme_chk"
  CHECK ("url" IS NULL OR "url" ~* '^https?://');

-- ownerId imutavel (migracao owner_immutable): instala o trigger na tabela nova.
SELECT chameleon_install_owner_immutable_triggers();
