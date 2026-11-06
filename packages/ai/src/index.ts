import type { AnalysisResult, ProfileDocument, ResumeContent } from '@chameleon/contracts';
import {
  ANALYSIS_PROMPT_VERSION,
  buildAiAnalysis,
  buildAnalysisMessages,
  parseAnalysisOutput,
} from './analysis';
import { buildFactCatalog } from './catalog';
import {
  RESUME_PROMPT_VERSION,
  applyResumePlan,
  buildResumeMessages,
  parseResumePlan,
  type AppliedResumePlan,
} from './resume';
import type { AiRouter, Attempt } from './router';
import type { TokenUsage } from './types';

export const PACKAGE_NAME = '@chameleon/ai' as const;

export { ANALYSIS_PROMPT_VERSION, buildAiAnalysis, buildAnalysisMessages, parseAnalysisOutput };
export { RESUME_PROMPT_VERSION, applyResumePlan, buildResumeMessages, parseResumePlan };
export type { AppliedResumePlan };
export { buildFactCatalog, type CatalogEntry, type FactCatalog } from './catalog';
export { parseJsonLoose } from './json';
export { classifyFailure, createOpenAiCompatibleProvider } from './openai-compatible';
export {
  DEFAULT_PROVIDER_ORDER,
  KNOWN_PROVIDERS,
  resolveProviderSpecs,
  resolveProviders,
  type KnownProvider,
} from './providers';
export {
  AiUnavailableError,
  createAiRouter,
  memoryBudgetStore,
  type AiLimits,
  type AiRouter,
  type AiRouterOptions,
  type Attempt,
  type AttemptOutcome,
  type BudgetStore,
  type RunInput,
  type RunResult,
} from './router';
export {
  AiProviderError,
  type AiCompletion,
  type AiErrorKind,
  type AiProvider,
  type ChatMessage,
  type CompletionRequest,
  type FetchLike,
  type ProviderSpec,
  type TokenUsage,
} from './types';

/** Which provider and model answered, what it cost, and what the other providers did (no content). */
export interface AiRunInfo {
  provider: string;
  model: string;
  usage: TokenUsage;
  attempts: readonly Attempt[];
}

/**
 * One call: extract the requirements and link them to the profile facts. Throws `AiUnavailableError` when no
 * provider answers with a valid result; the caller then keeps the local, deterministic analysis.
 */
export async function analyzeJobWithAi(
  router: AiRouter,
  input: { jobText: string; document: ProfileDocument },
  signal?: AbortSignal,
): Promise<{ result: AnalysisResult; run: AiRunInfo }> {
  const catalog = buildFactCatalog(input.document);
  const run = await router.run(
    {
      messages: buildAnalysisMessages(input.jobText, catalog),
      maxTokens: 6000,
      parse: parseAnalysisOutput,
    },
    signal,
  );
  const result = buildAiAnalysis({
    jobText: input.jobText,
    document: input.document,
    output: run.value,
    catalog,
    provider: run.provider,
    model: run.model,
  });
  return {
    result,
    run: { provider: run.provider, model: run.model, usage: run.usage, attempts: run.attempts },
  };
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * One call: headline, summary, key skills and the choice and order of experience and project items, applied on
 * top of the deterministic resume. What the AI gets wrong or cannot support is dropped by `applyResumePlan`.
 */
export async function tailorResumeWithAi(
  router: AiRouter,
  input: {
    content: ResumeContent;
    document: ProfileDocument;
    analysis: AnalysisResult;
    jobTitle: string | null;
  },
  signal?: AbortSignal,
): Promise<{ applied: AppliedResumePlan; run: AiRunInfo }> {
  const catalog = buildFactCatalog(input.document);
  const prefs = record(record(input.document.profile).resume_preferences);
  const career = record(record(input.document.profile).career_preferences);
  const avoid = strings(prefs.expressions_to_avoid);
  const notes =
    typeof prefs.additional_style_notes === 'string' ? prefs.additional_style_notes : null;
  const run = await router.run(
    {
      messages: buildResumeMessages({
        catalog,
        analysis: input.analysis,
        jobTitle: input.jobTitle,
        language: input.content.language,
        style: {
          tone: typeof prefs.tone === 'string' ? prefs.tone : null,
          avoid,
          notes,
          seniority: strings(career.target_seniority_levels),
        },
      }),
      maxTokens: 3000,
      parse: parseResumePlan,
    },
    signal,
  );
  const applied = applyResumePlan({
    content: input.content,
    plan: run.value,
    catalog,
    document: input.document,
    avoid,
  });
  return {
    applied,
    run: { provider: run.provider, model: run.model, usage: run.usage, attempts: run.attempts },
  };
}
