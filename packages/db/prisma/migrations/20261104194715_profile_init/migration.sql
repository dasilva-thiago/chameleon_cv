-- CreateEnum
CREATE TYPE "FactKind" AS ENUM ('statement', 'competency_example', 'experience', 'experience_item', 'project', 'project_item', 'education', 'course', 'skill', 'skill_usage', 'language', 'certification', 'award', 'publication', 'volunteering');

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('confirmed', 'needs_review', 'conflicting', 'archived');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('public', 'private', 'conditional');

-- CreateEnum
CREATE TYPE "ResumeUse" AS ENUM ('allowed', 'requires_approval', 'never');

-- CreateEnum
CREATE TYPE "FactSource" AS ENUM ('user_declared', 'form_entry', 'profile_import', 'resume_import', 'document', 'repository', 'certificate', 'interview', 'api', 'ai_extraction', 'other');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('year', 'month', 'day');

-- CreateEnum
CREATE TYPE "UsageContext" AS ENUM ('professional_experience', 'project_experience', 'volunteer_experience', 'coursework', 'certification', 'self_declared_knowledge', 'conceptual_familiarity', 'unverified');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('employee', 'internship', 'apprenticeship', 'contractor', 'freelance', 'self_employed', 'business_owner', 'temporary', 'public_service', 'volunteer', 'other');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('onsite', 'hybrid', 'remote');

-- CreateEnum
CREATE TYPE "ProjectCategory" AS ENUM ('personal', 'academic', 'open_source', 'freelance', 'professional', 'research', 'volunteer', 'entrepreneurial', 'other');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('idea', 'in_progress', 'active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "PublicAccess" AS ENUM ('public', 'partial', 'not_public');

-- CreateEnum
CREATE TYPE "SelfAssessedLevel" AS ENUM ('not_assessed', 'exposure', 'basic', 'intermediate', 'advanced', 'expert');

-- CreateEnum
CREATE TYPE "LanguageLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native', 'not_assessed');

-- CreateEnum
CREATE TYPE "EducationStatus" AS ENUM ('completed', 'in_progress', 'suspended', 'incomplete');

-- CreateEnum
CREATE TYPE "DegreeType" AS ENUM ('secondary', 'technical', 'associate', 'bachelor', 'specialization', 'mba', 'masters', 'doctorate', 'postdoc', 'other');

-- CreateEnum
CREATE TYPE "StudyModality" AS ENUM ('onsite', 'online', 'hybrid');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('completed', 'in_progress', 'incomplete');

-- CreateEnum
CREATE TYPE "SkillCategory" AS ENUM ('language', 'framework', 'library', 'database', 'tool', 'method', 'domain', 'soft_skill', 'spoken_language', 'other');

-- CreateEnum
CREATE TYPE "CertificationCategory" AS ENUM ('professional_certification', 'license', 'credential', 'attendance', 'completion', 'other');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('valid', 'expired', 'renewal_in_progress', 'no_expiration');

-- CreateEnum
CREATE TYPE "AwardScope" AS ENUM ('institutional', 'regional', 'national', 'international', 'other');

-- CreateEnum
CREATE TYPE "PublicationType" AS ENUM ('article', 'research', 'thesis', 'dissertation', 'talk', 'lecture', 'book', 'chapter', 'documentation', 'other');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('published', 'presented', 'submitted', 'in_progress');

-- CreateEnum
CREATE TYPE "ParticipationType" AS ENUM ('volunteer', 'community', 'association', 'leadership', 'mentoring', 'student_activity', 'other');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('email', 'phone', 'link');

-- CreateEnum
CREATE TYPE "ContactSubtype" AS ENUM ('professional', 'personal', 'mobile', 'landline', 'whatsapp', 'linkedin', 'github', 'gitlab', 'bitbucket', 'portfolio', 'website', 'behance', 'dribbble', 'artstation', 'other');

-- CreateEnum
CREATE TYPE "StatementKind" AS ENUM ('one_sentence_intro', 'short_summary', 'full_summary', 'career_narrative', 'differentiator', 'value');

-- CreateEnum
CREATE TYPE "ExperienceItemKind" AS ENUM ('responsibility', 'achievement', 'delivery');

-- CreateEnum
CREATE TYPE "ProjectItemKind" AS ENUM ('feature', 'contribution', 'deliverable', 'outcome', 'metric', 'business_rule', 'workflow', 'decision', 'test', 'integration');

-- CreateEnum
CREATE TYPE "PendingReason" AS ENUM ('missing', 'conflict', 'stale', 'unclear');

-- CreateEnum
CREATE TYPE "PendingStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('repository', 'certificate', 'portfolio', 'document', 'publication', 'demo', 'reference', 'self_declaration', 'other');

-- CreateEnum
CREATE TYPE "RecruiterSharing" AS ENUM ('allowed', 'restricted', 'not_allowed');

-- CreateEnum
CREATE TYPE "RestrictionRule" AS ENUM ('never_include', 'require_approval', 'private_guidance_only');

-- CreateEnum
CREATE TYPE "RevisionReason" AS ENUM ('manual_save', 'import', 'pre_generation', 'migration');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('preview', 'applied', 'discarded');

-- CreateEnum
CREATE TYPE "ImportSourceFormat" AS ENUM ('yaml', 'json', 'object');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('strict', 'lenient');

-- CreateTable
CREATE TABLE "ProfessionalProfile" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "identity" JSONB,
    "positioning" JSONB,
    "availabilityPreferences" JSONB,
    "careerPreferences" JSONB,
    "resumePreferences" JSONB,
    "additionalContext" JSONB,
    "usageRules" JSONB,
    "review" JSONB,
    "emptyCollections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfessionalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileFact" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "kind" "FactKind" NOT NULL,
    "status" "FactStatus" NOT NULL DEFAULT 'needs_review',
    "declaredStatus" "FactStatus",
    "visibility" "Visibility" NOT NULL DEFAULT 'private',
    "resumeUse" "ResumeUse" NOT NULL DEFAULT 'requires_approval',
    "source" "FactSource" NOT NULL DEFAULT 'other',
    "sourceDetail" TEXT,
    "sourceExcerpt" TEXT,
    "privateNotes" TEXT,
    "fieldStates" JSONB NOT NULL DEFAULT '{}',
    "metaPresent" BOOLEAN NOT NULL DEFAULT true,
    "metaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfileFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPoint" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "subtype" "ContactSubtype",
    "value" TEXT NOT NULL,
    "label" TEXT,
    "visibility" "Visibility",
    "includeByDefault" BOOLEAN,
    "isPrimary" BOOLEAN,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "title" TEXT,
    "urlOrLocation" TEXT,
    "evidenceDate" DATE,
    "evidenceDatePrecision" "DatePrecision",
    "isPublic" BOOLEAN,
    "recruiterSharing" "RecruiterSharing",
    "notes" TEXT,
    "details" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "factId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "supportsPosition" INTEGER,
    "evidenceIdsPosition" INTEGER,

    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingItem" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "targetFactId" UUID,
    "targetContactPointId" UUID,
    "targetEvidenceId" UUID,
    "targetField" TEXT,
    "subject" TEXT NOT NULL,
    "currentInformation" TEXT,
    "reason" "PendingReason",
    "reasonDetail" TEXT,
    "safeStatement" TEXT,
    "confirmationMethod" TEXT,
    "priority" "Priority",
    "status" "PendingStatus",
    "resolvedAt" TIMESTAMPTZ(3),
    "details" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PendingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRestriction" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "targetFactId" UUID,
    "targetContactPointId" UUID,
    "targetEvidenceId" UUID,
    "targetField" TEXT,
    "term" TEXT,
    "rule" "RestrictionRule" NOT NULL,
    "reason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UsageRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileRevision" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reason" "RevisionReason" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "sourceFormat" "ImportSourceFormat" NOT NULL,
    "sourceSchemaVersion" TEXT,
    "targetSchemaVersion" TEXT NOT NULL,
    "mode" "ImportMode" NOT NULL DEFAULT 'strict',
    "status" "ImportStatus" NOT NULL DEFAULT 'preview',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "idMap" JSONB NOT NULL DEFAULT '{}',
    "unmapped" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "revisionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileStatement" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "kind" "StatementKind" NOT NULL,
    "text" TEXT NOT NULL,
    "locale" TEXT,

    CONSTRAINT "ProfileStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyExample" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "competency" TEXT,
    "details" JSONB,

    CONSTRAINT "CompetencyExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyExampleSkill" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "exampleId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompetencyExampleSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "organizationName" TEXT,
    "organizationPublicName" TEXT,
    "organizationGroup" TEXT,
    "industry" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "officialTitle" TEXT,
    "displayTitle" TEXT,
    "employmentType" "EmploymentType",
    "workMode" "WorkMode",
    "startDate" DATE,
    "startPrecision" "DatePrecision",
    "endDate" DATE,
    "endPrecision" "DatePrecision",
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,

    CONSTRAINT "Experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperienceItem" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "experienceId" UUID NOT NULL,
    "kind" "ExperienceItemKind" NOT NULL,
    "text" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "ExperienceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT,
    "category" "ProjectCategory",
    "teamBased" BOOLEAN,
    "status" "ProjectStatus",
    "startDate" DATE,
    "startPrecision" "DatePrecision",
    "endDate" DATE,
    "endPrecision" "DatePrecision",
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT,
    "publicAccess" "PublicAccess",
    "license" TEXT,
    "publicUrl" TEXT,
    "repositoryUrl" TEXT,
    "documentationUrl" TEXT,
    "demoUrl" TEXT,
    "relatedExperienceId" UUID,
    "relatedEducationId" UUID,
    "details" JSONB,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectItem" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "ProjectItemKind" NOT NULL,
    "text" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "ProjectItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCollaborator" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "nameOrRole" TEXT,
    "contribution" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Education" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "institution" TEXT,
    "courseName" TEXT,
    "degreeType" "DegreeType",
    "fieldOfStudy" TEXT,
    "status" "EducationStatus",
    "modality" "StudyModality",
    "location" TEXT,
    "qualificationAwarded" TEXT,
    "startDate" DATE,
    "startPrecision" "DatePrecision",
    "completionDate" DATE,
    "completionPrecision" "DatePrecision",
    "expectedCompletionDate" DATE,
    "expectedCompletionPrecision" "DatePrecision",
    "details" JSONB,

    CONSTRAINT "Education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT,
    "provider" TEXT,
    "status" "CourseStatus",
    "startDate" DATE,
    "startPrecision" "DatePrecision",
    "completionDate" DATE,
    "completionPrecision" "DatePrecision",
    "workloadHours" DOUBLE PRECISION,
    "certificateIssued" BOOLEAN,
    "details" JSONB,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "category" "SkillCategory",
    "selfAssessedLevel" "SelfAssessedLevel",
    "details" JSONB,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillUsage" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "usageContext" "UsageContext" NOT NULL,
    "experienceId" UUID,
    "projectId" UUID,
    "educationId" UUID,
    "courseId" UUID,
    "certificationId" UUID,
    "volunteeringId" UUID,
    "facet" TEXT,
    "levelInContext" "SelfAssessedLevel",
    "startDate" DATE,
    "startPrecision" "DatePrecision",
    "endDate" DATE,
    "endPrecision" "DatePrecision",
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,

    CONSTRAINT "SkillUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LanguageProficiency" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "languageLabel" TEXT NOT NULL,
    "languageCode" TEXT,
    "overallLevel" "LanguageLevel",
    "selfDescribedLevel" TEXT,
    "reading" "LanguageLevel",
    "writing" "LanguageLevel",
    "listening" "LanguageLevel",
    "speaking" "LanguageLevel",
    "certificationId" UUID,
    "details" JSONB,

    CONSTRAINT "LanguageProficiency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT,
    "issuer" TEXT,
    "category" "CertificationCategory",
    "status" "CertificationStatus",
    "issueDate" DATE,
    "issuePrecision" "DatePrecision",
    "expirationDate" DATE,
    "expirationPrecision" "DatePrecision",
    "publicIdentifier" TEXT,
    "verificationUrl" TEXT,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Award" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT,
    "organization" TEXT,
    "date" DATE,
    "datePrecision" "DatePrecision",
    "scope" "AwardScope",
    "details" JSONB,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" TEXT,
    "type" "PublicationType",
    "status" "PublicationStatus",
    "date" DATE,
    "datePrecision" "DatePrecision",
    "venueOrInstitution" TEXT,
    "url" TEXT,
    "doi" TEXT,
    "details" JSONB,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Volunteering" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "organization" TEXT,
    "role" TEXT,
    "participationType" "ParticipationType",
    "startDate" DATE,
    "startPrecision" "DatePrecision",
    "endDate" DATE,
    "endPrecision" "DatePrecision",
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,

    CONSTRAINT "Volunteering_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalProfile_ownerId_idx" ON "ProfessionalProfile"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalProfile_id_ownerId_key" ON "ProfessionalProfile"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ProfileFact_ownerId_profileId_status_idx" ON "ProfileFact"("ownerId", "profileId", "status");

-- CreateIndex
CREATE INDEX "ProfileFact_profileId_kind_idx" ON "ProfileFact"("profileId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileFact_id_ownerId_key" ON "ProfileFact"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ContactPoint_ownerId_profileId_sortOrder_idx" ON "ContactPoint"("ownerId", "profileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPoint_id_ownerId_key" ON "ContactPoint"("id", "ownerId");

-- CreateIndex
CREATE INDEX "Evidence_ownerId_profileId_sortOrder_idx" ON "Evidence"("ownerId", "profileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_id_ownerId_key" ON "Evidence"("id", "ownerId");

-- CreateIndex
CREATE INDEX "EvidenceLink_ownerId_factId_idx" ON "EvidenceLink"("ownerId", "factId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceLink_id_ownerId_key" ON "EvidenceLink"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceLink_evidenceId_factId_key" ON "EvidenceLink"("evidenceId", "factId");

-- CreateIndex
CREATE INDEX "PendingItem_ownerId_profileId_status_idx" ON "PendingItem"("ownerId", "profileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PendingItem_id_ownerId_key" ON "PendingItem"("id", "ownerId");

-- CreateIndex
CREATE INDEX "UsageRestriction_ownerId_profileId_idx" ON "UsageRestriction"("ownerId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRestriction_id_ownerId_key" ON "UsageRestriction"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ProfileRevision_ownerId_profileId_createdAt_idx" ON "ProfileRevision"("ownerId", "profileId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileRevision_id_ownerId_key" ON "ProfileRevision"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileRevision_profileId_revisionNumber_key" ON "ProfileRevision"("profileId", "revisionNumber");

-- CreateIndex
CREATE INDEX "ImportRecord_ownerId_profileId_createdAt_idx" ON "ImportRecord"("ownerId", "profileId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ImportRecord_id_ownerId_key" ON "ImportRecord"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ProfileStatement_ownerId_kind_idx" ON "ProfileStatement"("ownerId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileStatement_id_ownerId_key" ON "ProfileStatement"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyExample_id_ownerId_key" ON "CompetencyExample"("id", "ownerId");

-- CreateIndex
CREATE INDEX "CompetencyExampleSkill_ownerId_skillId_idx" ON "CompetencyExampleSkill"("ownerId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyExampleSkill_id_ownerId_key" ON "CompetencyExampleSkill"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyExampleSkill_exampleId_skillId_key" ON "CompetencyExampleSkill"("exampleId", "skillId");

-- CreateIndex
CREATE INDEX "Experience_ownerId_organizationGroup_idx" ON "Experience"("ownerId", "organizationGroup");

-- CreateIndex
CREATE UNIQUE INDEX "Experience_id_ownerId_key" ON "Experience"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ExperienceItem_ownerId_experienceId_idx" ON "ExperienceItem"("ownerId", "experienceId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperienceItem_id_ownerId_key" ON "ExperienceItem"("id", "ownerId");

-- CreateIndex
CREATE INDEX "Project_ownerId_category_idx" ON "Project"("ownerId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_ownerId_key" ON "Project"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ProjectItem_ownerId_projectId_idx" ON "ProjectItem"("ownerId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectItem_id_ownerId_key" ON "ProjectItem"("id", "ownerId");

-- CreateIndex
CREATE INDEX "ProjectCollaborator_ownerId_projectId_sortOrder_idx" ON "ProjectCollaborator"("ownerId", "projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCollaborator_id_ownerId_key" ON "ProjectCollaborator"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Education_id_ownerId_key" ON "Education"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_id_ownerId_key" ON "Course"("id", "ownerId");

-- CreateIndex
CREATE INDEX "Skill_ownerId_category_idx" ON "Skill"("ownerId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_id_ownerId_key" ON "Skill"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_profileId_normalizedKey_key" ON "Skill"("profileId", "normalizedKey");

-- CreateIndex
CREATE INDEX "SkillUsage_ownerId_skillId_usageContext_idx" ON "SkillUsage"("ownerId", "skillId", "usageContext");

-- CreateIndex
CREATE UNIQUE INDEX "SkillUsage_id_ownerId_key" ON "SkillUsage"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LanguageProficiency_id_ownerId_key" ON "LanguageProficiency"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_id_ownerId_key" ON "Certification"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Award_id_ownerId_key" ON "Award"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_id_ownerId_key" ON "Publication"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Volunteering_id_ownerId_key" ON "Volunteering"("id", "ownerId");

-- AddForeignKey
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileFact" ADD CONSTRAINT "ProfileFact_profileId_ownerId_fkey" FOREIGN KEY ("profileId", "ownerId") REFERENCES "ProfessionalProfile"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_profileId_ownerId_fkey" FOREIGN KEY ("profileId", "ownerId") REFERENCES "ProfessionalProfile"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_profileId_ownerId_fkey" FOREIGN KEY ("profileId", "ownerId") REFERENCES "ProfessionalProfile"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_evidenceId_ownerId_fkey" FOREIGN KEY ("evidenceId", "ownerId") REFERENCES "Evidence"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_factId_ownerId_fkey" FOREIGN KEY ("factId", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingItem" ADD CONSTRAINT "PendingItem_profileId_ownerId_fkey" FOREIGN KEY ("profileId", "ownerId") REFERENCES "ProfessionalProfile"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingItem" ADD CONSTRAINT "PendingItem_targetFactId_ownerId_fkey" FOREIGN KEY ("targetFactId", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingItem" ADD CONSTRAINT "PendingItem_targetContactPointId_ownerId_fkey" FOREIGN KEY ("targetContactPointId", "ownerId") REFERENCES "ContactPoint"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingItem" ADD CONSTRAINT "PendingItem_targetEvidenceId_ownerId_fkey" FOREIGN KEY ("targetEvidenceId", "ownerId") REFERENCES "Evidence"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRestriction" ADD CONSTRAINT "UsageRestriction_profileId_ownerId_fkey" FOREIGN KEY ("profileId", "ownerId") REFERENCES "ProfessionalProfile"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRestriction" ADD CONSTRAINT "UsageRestriction_targetFactId_ownerId_fkey" FOREIGN KEY ("targetFactId", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRestriction" ADD CONSTRAINT "UsageRestriction_targetContactPointId_ownerId_fkey" FOREIGN KEY ("targetContactPointId", "ownerId") REFERENCES "ContactPoint"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRestriction" ADD CONSTRAINT "UsageRestriction_targetEvidenceId_ownerId_fkey" FOREIGN KEY ("targetEvidenceId", "ownerId") REFERENCES "Evidence"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileRevision" ADD CONSTRAINT "ProfileRevision_profileId_ownerId_fkey" FOREIGN KEY ("profileId", "ownerId") REFERENCES "ProfessionalProfile"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_profileId_ownerId_fkey" FOREIGN KEY ("profileId", "ownerId") REFERENCES "ProfessionalProfile"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_revisionId_ownerId_fkey" FOREIGN KEY ("revisionId", "ownerId") REFERENCES "ProfileRevision"("id", "ownerId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileStatement" ADD CONSTRAINT "ProfileStatement_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyExample" ADD CONSTRAINT "CompetencyExample_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyExampleSkill" ADD CONSTRAINT "CompetencyExampleSkill_exampleId_ownerId_fkey" FOREIGN KEY ("exampleId", "ownerId") REFERENCES "CompetencyExample"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyExampleSkill" ADD CONSTRAINT "CompetencyExampleSkill_skillId_ownerId_fkey" FOREIGN KEY ("skillId", "ownerId") REFERENCES "Skill"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceItem" ADD CONSTRAINT "ExperienceItem_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceItem" ADD CONSTRAINT "ExperienceItem_experienceId_ownerId_fkey" FOREIGN KEY ("experienceId", "ownerId") REFERENCES "Experience"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_relatedExperienceId_ownerId_fkey" FOREIGN KEY ("relatedExperienceId", "ownerId") REFERENCES "Experience"("id", "ownerId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_relatedEducationId_ownerId_fkey" FOREIGN KEY ("relatedEducationId", "ownerId") REFERENCES "Education"("id", "ownerId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectItem" ADD CONSTRAINT "ProjectItem_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectItem" ADD CONSTRAINT "ProjectItem_projectId_ownerId_fkey" FOREIGN KEY ("projectId", "ownerId") REFERENCES "Project"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCollaborator" ADD CONSTRAINT "ProjectCollaborator_projectId_ownerId_fkey" FOREIGN KEY ("projectId", "ownerId") REFERENCES "Project"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Education" ADD CONSTRAINT "Education_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_profileId_ownerId_fkey" FOREIGN KEY ("profileId", "ownerId") REFERENCES "ProfessionalProfile"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_skillId_ownerId_fkey" FOREIGN KEY ("skillId", "ownerId") REFERENCES "Skill"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_experienceId_ownerId_fkey" FOREIGN KEY ("experienceId", "ownerId") REFERENCES "Experience"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_projectId_ownerId_fkey" FOREIGN KEY ("projectId", "ownerId") REFERENCES "Project"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_educationId_ownerId_fkey" FOREIGN KEY ("educationId", "ownerId") REFERENCES "Education"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_courseId_ownerId_fkey" FOREIGN KEY ("courseId", "ownerId") REFERENCES "Course"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_certificationId_ownerId_fkey" FOREIGN KEY ("certificationId", "ownerId") REFERENCES "Certification"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillUsage" ADD CONSTRAINT "SkillUsage_volunteeringId_ownerId_fkey" FOREIGN KEY ("volunteeringId", "ownerId") REFERENCES "Volunteering"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LanguageProficiency" ADD CONSTRAINT "LanguageProficiency_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LanguageProficiency" ADD CONSTRAINT "LanguageProficiency_certificationId_ownerId_fkey" FOREIGN KEY ("certificationId", "ownerId") REFERENCES "Certification"("id", "ownerId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Volunteering" ADD CONSTRAINT "Volunteering_id_ownerId_fkey" FOREIGN KEY ("id", "ownerId") REFERENCES "ProfileFact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;
