import { z } from 'zod';
import {
  type IDENTITY_VISIBILITY_FIELDS,
  outputFormatSchema,
  photoPreferenceSchema,
  preferredLengthSchema,
  resumeSectionSchema,
  reviewedBySchema,
  salaryPeriodSchema,
  senioritySchema,
  toneSchema,
  triStateSchema,
  visualStyleSchema,
  workModeSchema,
  employmentTypeSchema,
  visibilitySchema,
} from '../../common/enums';
import {
  currencySchema,
  idList,
  LIMITS,
  localeSchema,
  longText,
  nonNegativeNumber,
  partialDateSchema,
  shortText,
  shortTextList,
  text,
  textList,
  timezoneSchema,
} from '../../common/primitives';
import { block, nested } from './factories';
import { restrictionSchema } from './records';

/**
 * Blocos singleton. `availability_preferences`, `career_preferences`, `usage_rules`,
 * `identity.pronouns` e `experiences[].exit_reason` sao PRIVADOS POR CONSTRUCAO: nao tem
 * `visibility` configuravel e nunca entram no contexto de geracao (ADR-0005, ADR-0014).
 */

const fieldVisibilitySchema = nested({
  full_name: visibilitySchema.nullish(),
  preferred_name: visibilitySchema.nullish(),
  pronunciation: visibilitySchema.nullish(),
  country_of_residence: visibilitySchema.nullish(),
  city: visibilitySchema.nullish(),
  region: visibilitySchema.nullish(),
  timezone: visibilitySchema.nullish(),
} satisfies Record<(typeof IDENTITY_VISIBILITY_FIELDS)[number], unknown>);

export const identitySchema = block({
  full_name: shortText.nullish(),
  preferred_name: shortText.nullish(),
  pronunciation: shortText.nullish(),
  pronouns: shortText.nullish(),
  country_of_residence: shortText.nullish(),
  city: shortText.nullish(),
  region: shortText.nullish(),
  countries_of_work_interest: shortTextList.nullish(),
  timezone: timezoneSchema.nullish(),
  interface_languages: z.array(localeSchema).max(LIMITS.shortList).nullish(),
  /** Visibilidade por campo de identidade (somente campos nao privados). */
  field_visibility: fieldVisibilitySchema.nullish(),
});

export const positioningSchema = block({
  current_profession: shortText.nullish(),
  current_job_title: shortText.nullish(),
  current_seniority: senioritySchema.nullish(),
  professional_headline: shortText.nullish(),
});

export const availabilityPreferencesSchema = block({
  preferred_work_modes: z.array(workModeSchema).max(3).nullish(),
  accepted_work_modes: z.array(workModeSchema).max(3).nullish(),
  target_regions_countries: shortTextList.nullish(),
  willing_to_relocate: triStateSchema.nullish(),
  travel_availability: triStateSchema.nullish(),
  travel_notes: text.nullish(),
  start_availability: shortText.nullish(),
  preferred_contract_types: z.array(employmentTypeSchema).max(12).nullish(),
  preferred_workload: shortText.nullish(),
  compatible_timezones_hours: shortText.nullish(),
  salary_expectation: nested({
    amount: nonNegativeNumber.nullish(),
    currency: currencySchema.nullish(),
    period: salaryPeriodSchema.nullish(),
    notes: text.nullish(),
  }).nullish(),
  desired_benefits: shortTextList.nullish(),
  work_environment_preferences: textList.nullish(),
  /** Nao registrar detalhes medicos ou sensiveis desnecessarios. */
  work_conditions: textList.nullish(),
  deal_breakers: textList.nullish(),
});

export const careerPreferencesSchema = block({
  priority_job_titles: shortTextList.nullish(),
  secondary_job_titles: shortTextList.nullish(),
  excluded_job_titles: shortTextList.nullish(),
  fields_of_interest: shortTextList.nullish(),
  preferred_industries: shortTextList.nullish(),
  excluded_industries: shortTextList.nullish(),
  target_seniority_levels: z.array(senioritySchema).max(10).nullish(),
  accepted_equivalent_titles: shortTextList.nullish(),
  misleading_titles_to_avoid: shortTextList.nullish(),
  preferred_responsibilities: textList.nullish(),
  responsibilities_to_avoid: textList.nullish(),
  professional_interests: shortTextList.nullish(),
  problems_to_solve: textList.nullish(),
  short_term_goals: text.nullish(),
  long_term_goals: text.nullish(),
  what_makes_a_job_interesting: text.nullish(),
  work_balance_preference: text.nullish(),
  interest_in_adjacent_fields: triStateSchema.nullish(),
  adjacent_fields_conditions: text.nullish(),
});

export const resumePreferencesSchema = block({
  default_language: localeSchema.nullish(),
  regional_variant: localeSchema.nullish(),
  tone: toneSchema.nullish(),
  preferred_length: preferredLengthSchema.nullish(),
  output_formats: z.array(outputFormatSchema).max(2).nullish(),
  visual_style: visualStyleSchema.nullish(),
  photo_preference: photoPreferenceSchema.nullish(),
  default_headline: shortText.nullish(),
  preferred_sections: z.array(resumeSectionSchema).max(20).nullish(),
  sections_to_omit: z.array(resumeSectionSchema).max(20).nullish(),
  /** Ids de `experiences[]` que podem ser resumidas. */
  older_experience_ids: idList.nullish(),
  /** Ids de experiencias ou projetos a destacar quando pertinentes. */
  highlight_record_ids: idList.nullish(),
  preferred_vocabulary: shortTextList.nullish(),
  expressions_to_avoid: shortTextList.nullish(),
  additional_style_notes: longText.nullish(),
});

export const additionalProfessionalContextSchema = block({
  industry_knowledge: textList.nullish(),
  standards_regulations: textList.nullish(),
  specialized_equipment: textList.nullish(),
  methods_processes_frameworks: textList.nullish(),
  international_experience: text.nullish(),
  distributed_team_experience: text.nullish(),
  stakeholder_experience: text.nullish(),
  other: text.nullish(),
});

export const usageRulesSchema = block({
  restrictions: z.array(restrictionSchema).max(LIMITS.records).nullish(),
});

/**
 * Datas de revisao. O consentimento de processamento NAO e lido deste bloco (ADR-0014):
 * `processing_consent` e `consent_notes` do 1.0.0 nao existem no 2.0.0.
 */
export const reviewSchema = block({
  profile_created_date: partialDateSchema.nullish(),
  last_reviewed_date: partialDateSchema.nullish(),
  reviewed_by: reviewedBySchema.nullish(),
  reviewed_sections: shortTextList.nullish(),
  items_to_update: textList.nullish(),
});
