import {
  runAnalysisRequestSchema,
  type AnalysisStateResponse,
  type JobAnalysis,
  type RunAnalysisResponse,
} from '@chameleon/contracts';
import type { Request } from 'express';
import type { ApiModuleContext } from '../../app';
import { requireAuthContext } from '../../auth/context';
import { requireProfileConsent } from '../../consent';
import { notFound, parseDto, uuidParam } from '../../http/params';
import { loadProfileBase } from '../profile';
import {
  evaluateOrReuse,
  parseStoredResult,
  profileRequiredError,
  type AnalysisRowCore,
} from './analysis-core';

/**
 * `/api/jobs/:jobId/analysis` — the career-ops evaluation of a saved job against the professional base (score,
 * verdict, requirements, gaps, keywords, salary). Needs the session and the profile consent (it reads the base);
 * the AI routes also need the AI consent (see `ai.access`).
 */
export function registerAnalysisRoutes(context: {
  routes: ApiModuleContext['routes'];
  ai: ApiModuleContext['ai'];
}): void {
  const { routes, ai } = context;

  async function load(req: Request) {
    const auth = requireAuthContext(req);
    const job = await auth.db.jobPosting.findFirst({ where: { id: uuidParam(req.params.jobId) } });
    if (!job) throw notFound();
    const base = await loadProfileBase(auth);
    return { auth, job, base };
  }

  const dto = (row: AnalysisRowCore): JobAnalysis | null => {
    const result = parseStoredResult(row.result);
    if (result === null) return null; // an evaluation in an old format is shown as "not evaluated yet"
    return {
      id: row.id,
      jobId: row.jobId,
      result,
      createdAt: row.createdAt.toISOString(),
      descriptionHash: row.descriptionHash,
      profileHash: row.profileHash,
    };
  };

  const stateOf = (
    row: AnalysisRowCore | null,
    job: { descriptionHash: string },
    profileHash: string | null,
  ): AnalysisStateResponse => {
    const analysis = row === null ? null : dto(row);
    if (analysis === null) return { analysis: null, stale: false, staleBecause: [] };
    const staleBecause: ('job_text' | 'profile')[] = [];
    if (analysis.descriptionHash !== job.descriptionHash) staleBecause.push('job_text');
    if (analysis.profileHash !== profileHash) staleBecause.push('profile');
    return { analysis, stale: staleBecause.length > 0, staleBecause };
  };

  routes.get(
    '/jobs/:jobId/analysis',
    {
      auth: 'session',
      description:
        'Latest evaluation of a job, with a flag telling whether the job text or the base changed since.',
    },
    requireProfileConsent,
    async (req, res) => {
      const { auth, job, base } = await load(req);
      const row = await auth.db.jobAnalysis.findFirst({
        where: { jobId: job.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      res.json(stateOf(row, job, base?.contentHash ?? null));
    },
  );

  routes.post(
    '/jobs/:jobId/analysis',
    {
      auth: 'session',
      description:
        'Evaluate a job against the professional base with AI (career-ops flow). Reuses the stored evaluation when nothing changed.',
    },
    requireProfileConsent,
    async (req, res) => {
      const { auth, job, base } = await load(req);
      const body = parseDto(runAnalysisRequestSchema, req.body);
      if (base === null) throw profileRequiredError();
      const { row, reused, created } = await evaluateOrReuse(auth, req, job, base, body.force, ai);
      const response: RunAnalysisResponse = { ...stateOf(row, job, base.contentHash), reused };
      res.status(created ? 201 : 200).json(response);
    },
  );
}
