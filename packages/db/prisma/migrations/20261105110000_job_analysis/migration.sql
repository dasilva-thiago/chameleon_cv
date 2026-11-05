-- CreateTable
CREATE TABLE "JobAnalysis" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "descriptionHash" TEXT NOT NULL,
    "profileHash" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "review" JSONB NOT NULL DEFAULT '{}',
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobAnalysis_ownerId_jobId_createdAt_idx" ON "JobAnalysis"("ownerId", "jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobAnalysis_id_ownerId_key" ON "JobAnalysis"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "JobAnalysis_jobId_descriptionHash_profileHash_engineVersion_key" ON "JobAnalysis"("jobId", "descriptionHash", "profileHash", "engineVersion");

-- AddForeignKey
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_jobId_ownerId_fkey" FOREIGN KEY ("jobId", "ownerId") REFERENCES "JobPosting"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Formato dos hashes e da versao (defesa em profundidade; o contrato Zod valida o JSON).
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_hashes_chk"
  CHECK ("descriptionHash" ~ '^[0-9a-f]{64}$' AND "profileHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_engine_chk"
  CHECK ("engine" IN ('deterministic') AND length("engineVersion") BETWEEN 1 AND 40);
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_json_chk"
  CHECK (jsonb_typeof("result") = 'object' AND jsonb_typeof("review") = 'object');

-- ownerId imutavel (migracao owner_immutable).
SELECT chameleon_install_owner_immutable_triggers();
