import { z } from 'zod';

/**
 * Enums canonicos do contrato (domain-model.md 2.4). Valores em ingles e snake_case.
 * Taxonomias abertas por natureza (area profissional, setor, familia de vaga) NAO sao enums.
 */

const e = <const T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

export const FACT_STATUS_VALUES = ['confirmed', 'needs_review', 'conflicting', 'archived'] as const;
export const factStatusSchema = e(FACT_STATUS_VALUES);
export type FactStatus = z.infer<typeof factStatusSchema>;

export const VISIBILITY_VALUES = ['public', 'private', 'conditional'] as const;
export const visibilitySchema = e(VISIBILITY_VALUES);
export type Visibility = z.infer<typeof visibilitySchema>;

export const RESUME_USE_VALUES = ['allowed', 'requires_approval', 'never'] as const;
export const resumeUseSchema = e(RESUME_USE_VALUES);
export type ResumeUse = z.infer<typeof resumeUseSchema>;

export const FIELD_STATE_VALUES = [
  'not_provided',
  'not_applicable',
  'not_assessed',
  'declined',
  'needs_confirmation',
] as const;
export const fieldStateSchema = e(FIELD_STATE_VALUES);
export type FieldState = z.infer<typeof fieldStateSchema>;

export const FACT_SOURCE_VALUES = [
  'user_declared',
  'form_entry',
  'profile_import',
  'resume_import',
  'document',
  'repository',
  'certificate',
  'interview',
  'api',
  'ai_extraction',
  'other',
] as const;
export const factSourceSchema = e(FACT_SOURCE_VALUES);
export type FactSource = z.infer<typeof factSourceSchema>;

/** ADR-0007: vocabulario unico de contexto de uso de competencias. */
export const USAGE_CONTEXT_VALUES = [
  'professional_experience',
  'project_experience',
  'volunteer_experience',
  'coursework',
  'certification',
  'self_declared_knowledge',
  'conceptual_familiarity',
  'unverified',
] as const;
export const usageContextSchema = e(USAGE_CONTEXT_VALUES);
export type UsageContext = z.infer<typeof usageContextSchema>;

export const EMPLOYMENT_TYPE_VALUES = [
  'employee',
  'internship',
  'apprenticeship',
  'contractor',
  'freelance',
  'self_employed',
  'business_owner',
  'temporary',
  'public_service',
  'volunteer',
  'other',
] as const;
export const employmentTypeSchema = e(EMPLOYMENT_TYPE_VALUES);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

export const WORK_MODE_VALUES = ['onsite', 'hybrid', 'remote'] as const;
export const workModeSchema = e(WORK_MODE_VALUES);
export type WorkMode = z.infer<typeof workModeSchema>;

export const PROJECT_CATEGORY_VALUES = [
  'personal',
  'academic',
  'open_source',
  'freelance',
  'professional',
  'research',
  'volunteer',
  'entrepreneurial',
  'other',
] as const;
export const projectCategorySchema = e(PROJECT_CATEGORY_VALUES);
export type ProjectCategory = z.infer<typeof projectCategorySchema>;

export const PROJECT_STATUS_VALUES = [
  'idea',
  'in_progress',
  'active',
  'completed',
  'archived',
] as const;
export const projectStatusSchema = e(PROJECT_STATUS_VALUES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** Projeto publico? Sim/Nao/Parcial (corrige a perda de informacao do boolean `is_public` do 1.0.0). */
export const PUBLIC_ACCESS_VALUES = ['public', 'partial', 'not_public'] as const;
export const publicAccessSchema = e(PUBLIC_ACCESS_VALUES);
export type PublicAccess = z.infer<typeof publicAccessSchema>;

export const SELF_ASSESSED_LEVEL_VALUES = [
  'not_assessed',
  'exposure',
  'basic',
  'intermediate',
  'advanced',
  'expert',
] as const;
export const selfAssessedLevelSchema = e(SELF_ASSESSED_LEVEL_VALUES);
export type SelfAssessedLevel = z.infer<typeof selfAssessedLevelSchema>;

export const LANGUAGE_LEVEL_VALUES = [
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
  'native',
  'not_assessed',
] as const;
export const languageLevelSchema = e(LANGUAGE_LEVEL_VALUES);
export type LanguageLevel = z.infer<typeof languageLevelSchema>;

export const SENIORITY_VALUES = [
  'student',
  'entry',
  'junior',
  'mid',
  'senior',
  'specialist',
  'lead',
  'manager',
  'executive',
  'not_assessed',
] as const;
export const senioritySchema = e(SENIORITY_VALUES);
export type Seniority = z.infer<typeof senioritySchema>;

export const PENDING_REASON_VALUES = ['missing', 'conflict', 'stale', 'unclear'] as const;
export const pendingReasonSchema = e(PENDING_REASON_VALUES);
export type PendingReason = z.infer<typeof pendingReasonSchema>;

export const PENDING_STATUS_VALUES = ['open', 'resolved', 'dismissed'] as const;
export const pendingStatusSchema = e(PENDING_STATUS_VALUES);
export type PendingStatus = z.infer<typeof pendingStatusSchema>;

export const PRIORITY_VALUES = ['low', 'medium', 'high'] as const;
export const prioritySchema = e(PRIORITY_VALUES);
export type Priority = z.infer<typeof prioritySchema>;

export const EVIDENCE_TYPE_VALUES = [
  'repository',
  'certificate',
  'portfolio',
  'document',
  'publication',
  'demo',
  'reference',
  'self_declaration',
  'other',
] as const;
export const evidenceTypeSchema = e(EVIDENCE_TYPE_VALUES);
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;

export const RECRUITER_SHARING_VALUES = ['allowed', 'restricted', 'not_allowed'] as const;
export const recruiterSharingSchema = e(RECRUITER_SHARING_VALUES);
export type RecruiterSharing = z.infer<typeof recruiterSharingSchema>;

export const EDUCATION_STATUS_VALUES = [
  'completed',
  'in_progress',
  'suspended',
  'incomplete',
] as const;
export const educationStatusSchema = e(EDUCATION_STATUS_VALUES);
export type EducationStatus = z.infer<typeof educationStatusSchema>;

export const DEGREE_TYPE_VALUES = [
  'secondary',
  'technical',
  'associate',
  'bachelor',
  'specialization',
  'mba',
  'masters',
  'doctorate',
  'postdoc',
  'other',
] as const;
export const degreeTypeSchema = e(DEGREE_TYPE_VALUES);
export type DegreeType = z.infer<typeof degreeTypeSchema>;

export const STUDY_MODALITY_VALUES = ['onsite', 'online', 'hybrid'] as const;
export const studyModalitySchema = e(STUDY_MODALITY_VALUES);
export type StudyModality = z.infer<typeof studyModalitySchema>;

export const COURSE_STATUS_VALUES = ['completed', 'in_progress', 'incomplete'] as const;
export const courseStatusSchema = e(COURSE_STATUS_VALUES);
export type CourseStatus = z.infer<typeof courseStatusSchema>;

export const SKILL_CATEGORY_VALUES = [
  'language',
  'framework',
  'library',
  'database',
  'tool',
  'method',
  'domain',
  'soft_skill',
  'spoken_language',
  'other',
] as const;
export const skillCategorySchema = e(SKILL_CATEGORY_VALUES);
export type SkillCategory = z.infer<typeof skillCategorySchema>;

export const CERTIFICATION_CATEGORY_VALUES = [
  'professional_certification',
  'license',
  'credential',
  'attendance',
  'completion',
  'other',
] as const;
export const certificationCategorySchema = e(CERTIFICATION_CATEGORY_VALUES);
export type CertificationCategory = z.infer<typeof certificationCategorySchema>;

export const CERTIFICATION_STATUS_VALUES = [
  'valid',
  'expired',
  'renewal_in_progress',
  'no_expiration',
] as const;
export const certificationStatusSchema = e(CERTIFICATION_STATUS_VALUES);
export type CertificationStatus = z.infer<typeof certificationStatusSchema>;

export const AWARD_SCOPE_VALUES = [
  'institutional',
  'regional',
  'national',
  'international',
  'other',
] as const;
export const awardScopeSchema = e(AWARD_SCOPE_VALUES);
export type AwardScope = z.infer<typeof awardScopeSchema>;

export const PUBLICATION_TYPE_VALUES = [
  'article',
  'research',
  'thesis',
  'dissertation',
  'talk',
  'lecture',
  'book',
  'chapter',
  'documentation',
  'other',
] as const;
export const publicationTypeSchema = e(PUBLICATION_TYPE_VALUES);
export type PublicationType = z.infer<typeof publicationTypeSchema>;

export const PUBLICATION_STATUS_VALUES = [
  'published',
  'presented',
  'submitted',
  'in_progress',
] as const;
export const publicationStatusSchema = e(PUBLICATION_STATUS_VALUES);
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;

export const PARTICIPATION_TYPE_VALUES = [
  'volunteer',
  'community',
  'association',
  'leadership',
  'mentoring',
  'student_activity',
  'other',
] as const;
export const participationTypeSchema = e(PARTICIPATION_TYPE_VALUES);
export type ParticipationType = z.infer<typeof participationTypeSchema>;

export const CONTACT_KIND_VALUES = ['email', 'phone', 'link'] as const;
export const contactKindSchema = e(CONTACT_KIND_VALUES);
export type ContactKind = z.infer<typeof contactKindSchema>;

export const CONTACT_SUBTYPE_VALUES = [
  'professional',
  'personal',
  'mobile',
  'landline',
  'whatsapp',
  'linkedin',
  'github',
  'gitlab',
  'bitbucket',
  'portfolio',
  'website',
  'behance',
  'dribbble',
  'artstation',
  'other',
] as const;
export const contactSubtypeSchema = e(CONTACT_SUBTYPE_VALUES);
export type ContactSubtype = z.infer<typeof contactSubtypeSchema>;

export const STATEMENT_KIND_VALUES = [
  'one_sentence_intro',
  'short_summary',
  'full_summary',
  'career_narrative',
  'differentiator',
  'value',
] as const;
export const statementKindSchema = e(STATEMENT_KIND_VALUES);
export type StatementKind = z.infer<typeof statementKindSchema>;

export const EXPERIENCE_ITEM_KIND_VALUES = ['responsibility', 'achievement', 'delivery'] as const;
export const experienceItemKindSchema = e(EXPERIENCE_ITEM_KIND_VALUES);
export type ExperienceItemKind = z.infer<typeof experienceItemKindSchema>;

export const PROJECT_ITEM_KIND_VALUES = [
  'feature',
  'contribution',
  'deliverable',
  'outcome',
  'metric',
  'business_rule',
  'workflow',
  'decision',
  'test',
  'integration',
] as const;
export const projectItemKindSchema = e(PROJECT_ITEM_KIND_VALUES);
export type ProjectItemKind = z.infer<typeof projectItemKindSchema>;

export const FREQUENCY_VALUES = ['daily', 'weekly', 'occasional', 'project_based'] as const;
export const frequencySchema = e(FREQUENCY_VALUES);
export type Frequency = z.infer<typeof frequencySchema>;

export const AUTONOMY_VALUES = ['supervised', 'partial', 'independent', 'not_assessed'] as const;
export const autonomySchema = e(AUTONOMY_VALUES);
export type Autonomy = z.infer<typeof autonomySchema>;

export const TRI_STATE_VALUES = ['yes', 'no', 'depends'] as const;
export const triStateSchema = e(TRI_STATE_VALUES);
export type TriState = z.infer<typeof triStateSchema>;

export const REFERENCE_PERMISSION_VALUES = ['allowed', 'not_allowed', 'ask_first'] as const;
export const referencePermissionSchema = e(REFERENCE_PERMISSION_VALUES);
export type ReferencePermission = z.infer<typeof referencePermissionSchema>;

export const SALARY_PERIOD_VALUES = ['hourly', 'monthly', 'yearly'] as const;
export const salaryPeriodSchema = e(SALARY_PERIOD_VALUES);
export type SalaryPeriod = z.infer<typeof salaryPeriodSchema>;

export const TONE_VALUES = [
  'formal',
  'professional_direct',
  'technical',
  'executive',
  'academic',
  'other',
] as const;
export const toneSchema = e(TONE_VALUES);
export type Tone = z.infer<typeof toneSchema>;

export const PREFERRED_LENGTH_VALUES = ['one_page', 'two_pages', 'content_based'] as const;
export const preferredLengthSchema = e(PREFERRED_LENGTH_VALUES);
export type PreferredLength = z.infer<typeof preferredLengthSchema>;

export const OUTPUT_FORMAT_VALUES = ['docx', 'pdf'] as const;
export const outputFormatSchema = e(OUTPUT_FORMAT_VALUES);
export type OutputFormat = z.infer<typeof outputFormatSchema>;

export const VISUAL_STYLE_VALUES = [
  'ats_simple',
  'traditional',
  'modern_discreet',
  'academic',
  'portfolio',
] as const;
export const visualStyleSchema = e(VISUAL_STYLE_VALUES);
export type VisualStyle = z.infer<typeof visualStyleSchema>;

export const PHOTO_PREFERENCE_VALUES = ['never', 'when_appropriate'] as const;
export const photoPreferenceSchema = e(PHOTO_PREFERENCE_VALUES);
export type PhotoPreference = z.infer<typeof photoPreferenceSchema>;

export const RESUME_SECTION_VALUES = [
  'summary',
  'experience',
  'projects',
  'education',
  'courses',
  'skills',
  'languages',
  'certifications',
  'awards',
  'publications',
  'volunteering',
] as const;
export const resumeSectionSchema = e(RESUME_SECTION_VALUES);
export type ResumeSection = z.infer<typeof resumeSectionSchema>;

export const RESTRICTION_RULE_VALUES = [
  'never_include',
  'require_approval',
  'private_guidance_only',
] as const;
export const restrictionRuleSchema = e(RESTRICTION_RULE_VALUES);
export type RestrictionRule = z.infer<typeof restrictionRuleSchema>;

export const REVIEWED_BY_VALUES = ['self', 'other_authorized'] as const;
export const reviewedBySchema = e(REVIEWED_BY_VALUES);
export type ReviewedBy = z.infer<typeof reviewedBySchema>;

/** Campos de `identity` cuja visibilidade pode ser configurada (pronomes sao privados por construcao). */
export const IDENTITY_VISIBILITY_FIELDS = [
  'full_name',
  'preferred_name',
  'pronunciation',
  'country_of_residence',
  'city',
  'region',
  'timezone',
] as const;
export type IdentityVisibilityField = (typeof IDENTITY_VISIBILITY_FIELDS)[number];

/** Tipos de registro com `id` no documento. */
export const RECORD_KIND_VALUES = [
  'contact_point',
  'statement',
  'competency_example',
  'experience',
  'experience_item',
  'project',
  'project_item',
  'collaborator',
  'education',
  'course',
  'skill',
  'skill_usage',
  'language',
  'certification',
  'award',
  'publication',
  'volunteering',
  'evidence',
  'pending_item',
  'restriction',
] as const;
export type RecordKind = (typeof RECORD_KIND_VALUES)[number];

/** Registros "citaveis" (FactKind do ADR-0006): carregam `meta` e podem sustentar afirmacoes. */
export const FACT_KINDS = [
  'statement',
  'competency_example',
  'experience',
  'experience_item',
  'project',
  'project_item',
  'education',
  'course',
  'skill',
  'skill_usage',
  'language',
  'certification',
  'award',
  'publication',
  'volunteering',
] as const satisfies readonly RecordKind[];
export type FactKind = (typeof FACT_KINDS)[number];
