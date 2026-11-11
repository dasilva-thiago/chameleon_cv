import type { AnalysisResult, JobExtraction } from '@chameleon/contracts';
import { finalizeAnalysis, verifyExtraction, type TailoredPlan } from '@chameleon/domain';
import {
  EVALUATION_PROMPT_VERSION,
  EXTRACTION_PROMPT_VERSION,
  buildEvaluationMessages,
  buildExtractionMessages,
  parseEvaluation,
  parseExtraction,
} from './evaluate';
import type { AiRouter, Attempt } from './router';
import { buildTailorMessages, parseTailoredPlan } from './tailor';
import type { TokenUsage } from './types';

export const PACKAGE_NAME = '@chameleon/ai' as const;

export {
  EVALUATION_PROMPT_VERSION,
  EXTRACTION_PROMPT_VERSION,
  MAX_JOB_CHARS,
  buildEvaluationMessages,
  buildExtractionMessages,
  languageName,
  parseEvaluation,
  parseExtraction,
} from './evaluate';
export { TAILOR_PROMPT_VERSION, buildTailorMessages, parseTailoredPlan } from './tailor';
export { parseJsonLoose } from './json';
export { redactContacts } from './redact';
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

/** Version of the whole evaluation (both prompts): part of the evaluation cache key. */
export const EVALUATION_ENGINE_VERSION = `${EXTRACTION_PROMPT_VERSION}+${EVALUATION_PROMPT_VERSION}`;

/** Which provider and model answered, what it cost, and what the other providers did (no content). */
export interface AiRunInfo {
  provider: string;
  model: string;
  usage: TokenUsage;
  attempts: readonly Attempt[];
}

const runInfo = (run: {
  provider: string;
  model: string;
  usage: TokenUsage;
  attempts: readonly Attempt[];
}): AiRunInfo => ({
  provider: run.provider,
  model: run.model,
  usage: run.usage,
  attempts: run.attempts,
});

export interface EvaluateJobInput {
  jobText: string;
  cvMarkdown: string;
  profileMarkdown: string;
  language: string;
  /** A previous extraction of the same posting text (same prompt version): skips the first call. */
  previousExtraction?: JobExtraction | null;
}

/**
 * Evaluates a job like career-ops `oferta`: (1) reads the posting alone, (2) judges it against the base, then the
 * program applies its rules (`finalizeAnalysis`). Throws `AiUnavailableError` when no provider answers validly.
 */
export async function evaluateJob(
  router: AiRouter,
  input: EvaluateJobInput,
  signal?: AbortSignal,
): Promise<{ result: AnalysisResult; runs: AiRunInfo[] }> {
  const runs: AiRunInfo[] = [];
  let extraction = input.previousExtraction ?? null;
  if (extraction?.promptVersion !== EXTRACTION_PROMPT_VERSION) {
    const run = await router.run(
      {
        messages: buildExtractionMessages(input.jobText, input.language),
        maxTokens: 4000,
        temperature: 0.1,
        parse: parseExtraction,
      },
      signal,
    );
    extraction = run.value;
    runs.push(runInfo(run));
  }
  const checked = verifyExtraction(extraction, input.jobText);

  const run = await router.run(
    {
      messages: buildEvaluationMessages({
        jobText: input.jobText,
        extraction: checked.extraction,
        cvMarkdown: input.cvMarkdown,
        profileMarkdown: input.profileMarkdown,
        language: input.language,
      }),
      maxTokens: 6000,
      temperature: 0.2,
      parse: parseEvaluation,
    },
    signal,
  );
  runs.push(runInfo(run));
  const result = finalizeAnalysis({
    extraction: checked.extraction,
    draft: run.value,
    jobText: input.jobText,
    baseText: `${input.cvMarkdown}\n${input.profileMarkdown}`,
    ai: { provider: run.provider, model: run.model, promptVersion: EVALUATION_ENGINE_VERSION },
    warnings: checked.warnings,
  });
  return { result, runs };
}

export interface TailorResumeInput {
  analysis: AnalysisResult;
  jobTitle: string | null;
  cvMarkdown: string;
  profileMarkdown: string;
  language: string;
}

/** One call: the tailoring plan (career-ops `pdf` steps 7-15). The program builds and checks the resume from it. */
export async function tailorResume(
  router: AiRouter,
  input: TailorResumeInput,
  signal?: AbortSignal,
): Promise<{ plan: TailoredPlan; run: AiRunInfo }> {
  const run = await router.run(
    {
      messages: buildTailorMessages(input),
      maxTokens: 5000,
      temperature: 0.3,
      parse: parseTailoredPlan,
    },
    signal,
  );
  return { plan: run.value, run: runInfo(run) };
}
