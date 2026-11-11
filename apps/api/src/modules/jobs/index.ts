import { createHash } from 'node:crypto';
import {
  ACTIVE_JOB_STATUSES,
  JOB_LIMITS,
  JOB_STATUSES,
  createJobRequestSchema,
  listJobsQuerySchema,
  patchJobRequestSchema,
  type DeleteJobResponse,
  type JobDetail,
  type JobEvaluationSummary,
  type JobResponse,
  type JobStatus,
  type JobSummary,
  type ListJobsResponse,
} from '@chameleon/contracts';
import type { ApiModule } from '../../app';
import { requireAuthContext } from '../../auth/context';
import { notFound, parseDto, uuidParam } from '../../http/params';
import { loadProfileBase } from '../profile';
import { registerAnalysisRoutes } from './analysis';
import { parseStoredResult } from './analysis-core';

/**
 * Saved job postings (P1): `/api/jobs/**`. Every route is `auth: 'session'` (the registry adds the guard) and
 * works only through `req.auth.db`, the owner-scoped client, so another owner's id is indistinguishable from a
 * missing one (404). Job text is untrusted data: stored verbatim, never interpreted, never logged. Audit events
 * carry only ids and the NAMES of the changed fields.
 */

interface JobRow {
  id: string;
  title: string | null;
  company: string | null;
  url: string | null;
  location: string | null;
  workMode: JobSummary['workMode'];
  postedOn: Date | null;
  status: JobStatus;
  description: string;
  descriptionHash: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Prisma passes `contains` to LIKE/ILIKE without escaping: neutralize the wildcards the user typed. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const dateOnly = (value: Date | null): string | null =>
  value === null ? null : value.toISOString().slice(0, 10);

const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);

function excerptOf(description: string): string {
  const flat = description.replace(/\s+/g, ' ').trim();
  return flat.length <= JOB_LIMITS.excerpt ? flat : `${flat.slice(0, JOB_LIMITS.excerpt - 1)}…`;
}

export function summaryDto(row: JobRow): JobSummary {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    url: row.url,
    location: row.location,
    workMode: row.workMode,
    postedOn: dateOnly(row.postedOn),
    status: row.status,
    excerpt: excerptOf(row.description),
    descriptionLength: row.description.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Latest evaluation of each listed job, reduced to what a list shows (score, recommendation, evidence rail).
 * One query for the page; an evaluation stored in an old format counts as "not evaluated".
 */
async function evaluationsFor(
  auth: ReturnType<typeof requireAuthContext>,
  jobs: readonly { id: string; descriptionHash: string }[],
): Promise<Map<string, JobEvaluationSummary>> {
  const out = new Map<string, JobEvaluationSummary>();
  if (jobs.length === 0) return out;
  const [rows, base] = await Promise.all([
    auth.db.jobAnalysis.findMany({
      where: { jobId: { in: jobs.map((job) => job.id) } },
      orderBy: [{ jobId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['jobId'],
      select: {
        jobId: true,
        result: true,
        descriptionHash: true,
        profileHash: true,
        createdAt: true,
      },
    }),
    loadProfileBase(auth),
  ]);
  const hashOf = new Map(jobs.map((job) => [job.id, job.descriptionHash]));
  for (const row of rows) {
    const result = parseStoredResult(row.result);
    if (result === null) continue;
    const rail = { strong: 0, partial: 0, missing: 0, na: 0 };
    for (const match of result.matches) rail[match.match] += 1;
    out.set(row.jobId, {
      score: result.score,
      recommendation: result.verdict.recommendation,
      dealbreaker: result.dealbreakers.length > 0,
      rail,
      stale:
        row.descriptionHash !== hashOf.get(row.jobId) ||
        row.profileHash !== (base?.contentHash ?? null),
      evaluatedAt: row.createdAt.toISOString(),
    });
  }
  return out;
}

export function detailDto(row: JobRow): JobDetail {
  return {
    ...summaryDto(row),
    description: row.description,
    descriptionHash: row.descriptionHash,
    notes: row.notes,
  };
}

export const createJobsModule = (): ApiModule => (context) => {
  const { routes } = context;

  const audit = async (
    req: Parameters<typeof requireAuthContext>[0],
    action: string,
    entityId: string,
    metadata: Record<string, string[] | string> = {},
  ): Promise<void> => {
    const auth = requireAuthContext(req);
    await auth.db.auditEvent.create({
      data: {
        ownerId: auth.ownerId,
        action,
        entityType: 'JobPosting',
        entityId,
        correlationId: req.correlationId,
        metadata,
      },
    });
  };

  routes.get(
    '/jobs',
    { auth: 'session', description: 'List saved job postings (filter by status, search text).' },
    async (req, res) => {
      const auth = requireAuthContext(req);
      const { db } = auth;
      const query = parseDto(listJobsQuerySchema, req.query);
      const statusFilter =
        query.status === 'all'
          ? undefined
          : query.status === 'active'
            ? { in: [...ACTIVE_JOB_STATUSES] }
            : query.status;
      const search = query.q === undefined ? undefined : escapeLike(query.q);
      const rows = await db.jobPosting.findMany({
        where: {
          ...(statusFilter !== undefined ? { status: statusFilter } : {}),
          ...(search !== undefined
            ? {
                OR: [
                  { title: { contains: search, mode: 'insensitive' } },
                  { company: { contains: search, mode: 'insensitive' } },
                  { location: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      const grouped = await db.jobPosting.groupBy({ by: ['status'], _count: { _all: true } });
      const byStatus = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<
        JobStatus,
        number
      >;
      for (const group of grouped) byStatus[group.status] = group._count._all;
      const evaluations = await evaluationsFor(auth, rows);
      const response: ListJobsResponse = {
        jobs: rows.map((row) => ({
          ...summaryDto(row),
          evaluation: evaluations.get(row.id) ?? null,
        })),
        counts: {
          total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
          active: ACTIVE_JOB_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
          byStatus,
        },
      };
      res.json(response);
    },
  );

  routes.post(
    '/jobs',
    {
      auth: 'session',
      description: 'Save a job posting (only the pasted description is required).',
    },
    async (req, res) => {
      const { db, ownerId } = requireAuthContext(req);
      const body = parseDto(createJobRequestSchema, req.body);
      const row = await db.jobPosting.create({
        data: {
          ownerId,
          description: body.description,
          descriptionHash: sha256(body.description),
          title: body.title ?? null,
          company: body.company ?? null,
          url: body.url ?? null,
          location: body.location ?? null,
          workMode: body.workMode ?? null,
          postedOn: toDate(body.postedOn) ?? null,
          notes: body.notes ?? null,
          status: body.status ?? 'saved',
        },
      });
      await audit(req, 'job.create', row.id);
      const response: JobResponse = { job: detailDto(row) };
      res.status(201).json(response);
    },
  );

  routes.get(
    '/jobs/:jobId',
    { auth: 'session', description: 'One saved job posting with its original text.' },
    async (req, res) => {
      const { db } = requireAuthContext(req);
      const row = await db.jobPosting.findFirst({ where: { id: uuidParam(req.params.jobId) } });
      if (!row) throw notFound();
      const response: JobResponse = { job: detailDto(row) };
      res.json(response);
    },
  );

  routes.patch(
    '/jobs/:jobId',
    {
      auth: 'session',
      description: 'Edit fields, change the status (archive) or replace the text of a saved job.',
    },
    async (req, res) => {
      const { db } = requireAuthContext(req);
      const id = uuidParam(req.params.jobId);
      const body = parseDto(patchJobRequestSchema, req.body);
      const existing = await db.jobPosting.findFirst({ where: { id } });
      if (!existing) throw notFound();
      const textChanged =
        body.description !== undefined && body.description !== existing.description;
      const data = {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.company !== undefined ? { company: body.company } : {}),
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.workMode !== undefined ? { workMode: body.workMode } : {}),
        ...(body.postedOn !== undefined ? { postedOn: toDate(body.postedOn) } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(textChanged && body.description !== undefined
          ? { description: body.description, descriptionHash: sha256(body.description) }
          : {}),
      };
      const row = await db.jobPosting.update({ where: { id }, data });
      await audit(req, 'job.update', row.id, { fields: Object.keys(data).sort() });
      const response: JobResponse = { job: detailDto(row) };
      res.json(response);
    },
  );

  routes.delete(
    '/jobs/:jobId',
    { auth: 'session', description: 'Permanently delete a saved job posting.' },
    async (req, res) => {
      const { db } = requireAuthContext(req);
      const id = uuidParam(req.params.jobId);
      const removed = await db.jobPosting.deleteMany({ where: { id } });
      if (removed.count === 0) throw notFound();
      await audit(req, 'job.delete', id);
      const response: DeleteJobResponse = { deleted: true, id };
      res.json(response);
    },
  );

  registerAnalysisRoutes(context);
};
