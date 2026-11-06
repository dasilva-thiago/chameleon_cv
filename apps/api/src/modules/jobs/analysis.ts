import {
  EMPTY_REVIEW,
  analysisResultSchema,
  analysisReviewSchema,
  patchAnalysisReviewRequestSchema,
  runAnalysisRequestSchema,
  type AnalysisReview,
  type AnalysisStateResponse,
  type JobAnalysis,
  type RunAnalysisResponse,
} from '@chameleon/contracts';
import { hashProfileDocument } from '@chameleon/domain';
import type { Request } from 'express';
import type { ApiModuleContext } from '../../app';
import { requireAuthContext, type AuthContext } from '../../auth/context';
import { HttpError } from '../../http/errors';
import { notFound, parseDto, uuidParam } from '../profiles/errors';
import { requireProfileConsent } from '../profiles/gate';
import { analyzeOrReuse } from './analysis-core';
import { bindProfileStore } from '../profiles/scope';

interface AnalysisRow {
  id: string;
  jobId: string;
  descriptionHash: string;
  profileHash: string;
  result: unknown;
  review: unknown;
  reviewedAt: Date | null;
  createdAt: Date;
}

function analysisDto(row: AnalysisRow): JobAnalysis {
  const result = analysisResultSchema.safeParse(row.result);
  const review = analysisReviewSchema.safeParse(row.review);
  if (!result.success) {
    // A stored result that no longer matches the contract is an integrity problem, not a client error.
    throw new Error(`JobAnalysis ${row.id}: stored result does not match the contract`);
  }
  return {
    id: row.id,
    jobId: row.jobId,
    result: result.data,
    review: review.success ? review.data : EMPTY_REVIEW,
    reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    descriptionHash: row.descriptionHash,
    profileHash: row.profileHash,
  };
}

/**
 * `/api/jobs/:jobId/analysis**` (P2). The analysis is deterministic and local: nothing leaves the server. It reads
 * the profile, so every route also requires the `profile_processing` consent. The cache key is
 * (job, text hash, profile hash, engine version): same input -> the stored analysis is returned untouched.
 */
export function registerAnalysisRoutes(context: ApiModuleContext): void {
  const { routes, profileStore, ai } = context;

  async function load(req: Request) {
    const auth = requireAuthContext(req);
    const jobId = uuidParam(req.params.jobId);
    const job = await auth.db.jobPosting.findFirst({ where: { id: jobId } });
    if (!job) throw notFound();
    const loaded = await bindProfileStore(profileStore, auth.ownerId).loadProfileDocument();
    const document = loaded?.document ?? null;
    const profileHash = document === null ? null : hashProfileDocument(document);
    return { auth, job, document, profileHash };
  }

  const stateOf = (
    row: AnalysisRow | null,
    job: { descriptionHash: string },
    profileHash: string | null,
  ): AnalysisStateResponse => {
    if (row === null) return { analysis: null, stale: false, staleBecause: [] };
    const staleBecause: ('job_text' | 'profile')[] = [];
    if (row.descriptionHash !== job.descriptionHash) staleBecause.push('job_text');
    if (row.profileHash !== profileHash) staleBecause.push('profile');
    return { analysis: analysisDto(row), stale: staleBecause.length > 0, staleBecause };
  };

  const latest = (auth: AuthContext, jobId: string): Promise<AnalysisRow | null> =>
    auth.db.jobAnalysis.findFirst({
      where: { jobId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

  const audit = (
    auth: AuthContext,
    req: Request,
    action: string,
    entityId: string,
    metadata: Record<string, string | number | boolean>,
  ): Promise<unknown> =>
    auth.db.auditEvent.create({
      data: {
        ownerId: auth.ownerId,
        action,
        entityType: 'JobAnalysis',
        entityId,
        correlationId: req.correlationId,
        metadata,
      },
    });

  routes.get(
    '/jobs/:jobId/analysis',
    {
      auth: 'session',
      description:
        'Latest analysis of a job, with a flag telling whether the job text or the profile changed since.',
    },
    requireProfileConsent,
    async (req, res) => {
      const { auth, job, profileHash } = await load(req);
      res.json(stateOf(await latest(auth, job.id), job, profileHash));
    },
  );

  routes.post(
    '/jobs/:jobId/analysis',
    {
      auth: 'session',
      description:
        'Analyze a job against the profile (deterministic, local). Reuses the stored analysis when nothing changed.',
    },
    requireProfileConsent,
    async (req, res) => {
      const { auth, job, document, profileHash } = await load(req);
      const body = parseDto(runAnalysisRequestSchema, req.body);
      if (document === null || profileHash === null) {
        throw new HttpError(
          409,
          'PROFILE_REQUIRED',
          'Cadastre ou importe o perfil profissional antes de analisar uma vaga.',
        );
      }
      const { row, reused, created } = await analyzeOrReuse(
        auth,
        req,
        job,
        document,
        profileHash,
        body.force,
        ai,
      );
      if (reused) {
        const response: RunAnalysisResponse = { ...stateOf(row, job, profileHash), reused: true };
        res.json(response);
        return;
      }
      const response: RunAnalysisResponse = { ...stateOf(row, job, profileHash), reused: false };
      res.status(created ? 201 : 200).json(response);
    },
  );

  routes.patch(
    '/jobs/:jobId/analysis/review',
    {
      auth: 'session',
      description:
        'Save the owner review of the adaptation plan (records to exclude/pin, notes per requirement).',
    },
    requireProfileConsent,
    async (req, res) => {
      const { auth, job, profileHash } = await load(req);
      const { review } = parseDto(patchAnalysisReviewRequestSchema, req.body);
      const row = await latest(auth, job.id);
      if (!row) throw notFound();
      const result = analysisResultSchema.parse(row.result);
      const requirementIds = new Set(result.requirements.map((r) => r.id));
      const unknownNotes = Object.keys(review.notes).filter((id) => !requirementIds.has(id));
      const excluded = new Set(review.excludedRecordIds.map((id) => id.toLowerCase()));
      const overlap = review.pinnedRecordIds.some((id) => excluded.has(id.toLowerCase()));
      if (unknownNotes.length > 0 || overlap) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Revisao invalida.', {
          details: [
            ...(unknownNotes.length > 0
              ? [{ path: 'review.notes', message: 'Anotacao para um requisito que nao existe.' }]
              : []),
            ...(overlap
              ? [
                  {
                    path: 'review.pinnedRecordIds',
                    message: 'Um item nao pode estar fixado e excluido.',
                  },
                ]
              : []),
          ],
        });
      }
      const normalized: AnalysisReview = {
        excludedRecordIds: [...excluded],
        pinnedRecordIds: [...new Set(review.pinnedRecordIds.map((id) => id.toLowerCase()))],
        notes: review.notes,
      };
      const saved = await auth.db.jobAnalysis.update({
        where: { id: row.id },
        data: { review: normalized, reviewedAt: new Date() },
      });
      await audit(auth, req, 'job.analysis.review', row.id, {
        excluded: normalized.excludedRecordIds.length,
        pinned: normalized.pinnedRecordIds.length,
        notes: Object.keys(normalized.notes).length,
      });
      res.json(stateOf(saved, job, profileHash));
    },
  );
}
