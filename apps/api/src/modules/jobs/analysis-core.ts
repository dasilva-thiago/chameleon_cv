import {
  EMPTY_REVIEW,
  analysisResultSchema,
  type AnalysisResult,
  type ProfileDocument,
} from '@chameleon/contracts';
import { MATCHER_VERSION, analyzeJob } from '@chameleon/domain';
import type { Request } from 'express';
import type { AuthContext } from '../../auth/context';

export interface AnalysisJob {
  id: string;
  status: string;
  description: string;
  descriptionHash: string;
}

export interface AnalysisRowCore {
  id: string;
  jobId: string;
  descriptionHash: string;
  profileHash: string;
  result: unknown;
  review: unknown;
  reviewedAt: Date | null;
  createdAt: Date;
}

/**
 * Cache key = (job, text hash, profile hash, engine version). Same key -> the stored analysis is returned
 * untouched (`reused`); otherwise it is computed locally, stored, and a `saved` job becomes `analyzed`.
 * `force` recomputes the row of the same key in place (the review is kept). Shared by the analysis routes and by
 * resume generation, which always works from an analysis of the current inputs.
 */
export async function analyzeOrReuse(
  auth: AuthContext,
  req: Request,
  job: AnalysisJob,
  document: ProfileDocument,
  profileHash: string,
  force: boolean,
): Promise<{ row: AnalysisRowCore; reused: boolean; created: boolean; result: AnalysisResult }> {
  const key = {
    jobId: job.id,
    descriptionHash: job.descriptionHash,
    profileHash,
    engineVersion: MATCHER_VERSION,
  };
  const existing = await auth.db.jobAnalysis.findFirst({ where: key });
  if (existing && !force) {
    return {
      row: existing,
      reused: true,
      created: false,
      result: analysisResultSchema.parse(existing.result),
    };
  }

  const result: AnalysisResult = analysisResultSchema.parse(analyzeJob(job.description, document));
  const row = existing
    ? await auth.db.jobAnalysis.update({ where: { id: existing.id }, data: { result } })
    : await auth.db.jobAnalysis.create({
        data: {
          ownerId: auth.ownerId,
          ...key,
          engine: result.engine,
          result,
          review: EMPTY_REVIEW,
        },
      });
  if (job.status === 'saved') {
    await auth.db.jobPosting.update({ where: { id: job.id }, data: { status: 'analyzed' } });
  }
  await auth.db.auditEvent.create({
    data: {
      ownerId: auth.ownerId,
      action: 'job.analyze',
      entityType: 'JobAnalysis',
      entityId: row.id,
      correlationId: req.correlationId,
      metadata: {
        engineVersion: MATCHER_VERSION,
        requirements: result.summary.requirements,
        forced: force,
      },
    },
  });
  return { row, reused: false, created: existing === null, result };
}
