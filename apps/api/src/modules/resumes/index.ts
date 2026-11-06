import { tailorResumeWithAi } from '@chameleon/ai';
import {
  EMPTY_REVIEW,
  analysisReviewSchema,
  createResumeRequestSchema,
  exportResumeQuerySchema,
  RESUME_EXPORT_CONTENT_TYPES,
  newResumeVersionRequestSchema,
  renameResumeRequestSchema,
  resumeContentSchema,
  updateResumeVersionRequestSchema,
  type CreateResumeResponse,
  type DeleteResumeResponse,
  type ListResumesResponse,
  type ProfileDocument,
  type ResumeContent,
  type ResumeIssue,
  type ResumeResponse,
  type ResumeSummary,
  type ResumeVersionDetail,
  type ResumeVersionResponse,
  type ResumeVersionSummary,
} from '@chameleon/contracts';
import {
  canonicalJson,
  generateResume,
  hashProfileDocument,
  reconcileOrigins,
  sha256Hex,
  validateResume,
} from '@chameleon/domain';
import { ExportUnavailableError, exportFileName, renderResume } from '@chameleon/documents';
import type { Request } from 'express';
import type { ApiModule } from '../../app';
import { requireAuthContext, type AuthContext } from '../../auth/context';
import { HttpError } from '../../http/errors';
import { analyzeOrReuse } from '../jobs/analysis-core';
import { notFound, parseDto, uuidParam } from '../profiles/errors';
import { requireProfileConsent } from '../profiles/gate';
import { bindProfileStore, type OwnerProfileStore } from '../profiles/scope';

/**
 * Resumes per saved job (P3): `/api/jobs/:jobId/resumes` and `/api/resumes/**`. Generation is deterministic and
 * local (see `generateResume`): every line is copied from a confirmed fact and carries its id. All routes need the
 * profile consent (they read the profile) and the owner-scoped client; a foreign id answers 404 like a missing one.
 * An approved version is immutable (also in the database); editing means a NEW draft version.
 */

interface VersionRow {
  id: string;
  resumeId: string;
  versionNumber: number;
  status: 'draft' | 'approved';
  language: string;
  content: unknown;
  contentHash: string;
  issueErrors: number;
  issueWarnings: number;
  profileRevisionId: string | null;
  analysisId: string | null;
  sourceVersionId: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ResumeRow {
  id: string;
  jobId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const hashContent = (content: ResumeContent): string => sha256Hex(canonicalJson(content));

const counts = (issues: readonly ResumeIssue[]): { errors: number; warnings: number } => ({
  errors: issues.filter((issue) => issue.severity === 'error').length,
  warnings: issues.filter((issue) => issue.severity === 'warning').length,
});

export function versionSummaryDto(row: VersionRow): ResumeVersionSummary {
  return {
    id: row.id,
    resumeId: row.resumeId,
    versionNumber: row.versionNumber,
    status: row.status,
    language: row.language,
    sourceVersionId: row.sourceVersionId,
    contentHash: row.contentHash,
    issueCounts: { errors: row.issueErrors, warnings: row.issueWarnings },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    approvedAt: row.approvedAt === null ? null : row.approvedAt.toISOString(),
  };
}

export function resumeDto(resume: ResumeRow, versions: readonly VersionRow[]): ResumeSummary {
  return {
    id: resume.id,
    jobId: resume.jobId,
    name: resume.name,
    createdAt: resume.createdAt.toISOString(),
    updatedAt: resume.updatedAt.toISOString(),
    versions: [...versions]
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map(versionSummaryDto),
  };
}

export function parseContent(row: VersionRow): ResumeContent {
  const parsed = resumeContentSchema.safeParse(row.content);
  if (!parsed.success) {
    // A stored document that no longer matches the contract is an integrity problem, not a client error.
    throw new Error(`ResumeVersion ${row.id}: stored content does not match the contract`);
  }
  return parsed.data;
}

/** One export at a time: PDF printing starts a browser, which is heavy for a personal tool and needs no parallelism. */
let exportChain: Promise<unknown> = Promise.resolve();
function exclusiveExport<T>(task: () => Promise<T>): Promise<T> {
  const next = exportChain.then(task, task);
  exportChain = next.catch(() => undefined);
  return next;
}

export const createResumesModule = (): ApiModule => (context) => {
  const { routes, profileStore, ai } = context;

  const store = (auth: AuthContext): OwnerProfileStore =>
    bindProfileStore(profileStore, auth.ownerId);

  const currentDocument = async (auth: AuthContext): Promise<ProfileDocument | null> =>
    (await store(auth).loadProfileDocument())?.document ?? null;

  /** Drafts are checked against the profile as it is NOW; approved versions against the frozen revision. */
  async function validationDocument(
    auth: AuthContext,
    row: VersionRow,
    current: ProfileDocument | null,
  ): Promise<ProfileDocument | null> {
    if ((row.status === 'approved' || current === null) && row.profileRevisionId !== null) {
      const revision = await store(auth).getRevision(row.profileRevisionId);
      if (revision) return revision.snapshot;
    }
    return current;
  }

  async function detailDto(
    auth: AuthContext,
    row: VersionRow,
    current: ProfileDocument | null,
  ): Promise<ResumeVersionDetail> {
    const content = parseContent(row);
    const document = await validationDocument(auth, row, current);
    const issues = document === null ? [] : validateResume(content, document);
    return {
      ...versionSummaryDto(row),
      issueCounts: document === null ? versionSummaryDto(row).issueCounts : counts(issues),
      content,
      issues,
      profileRevisionId: row.profileRevisionId,
      analysisId: row.analysisId,
    };
  }

  async function loadResume(auth: AuthContext, idParam: unknown): Promise<ResumeRow> {
    const resume = await auth.db.resume.findFirst({ where: { id: uuidParam(idParam) } });
    if (!resume) throw notFound();
    return resume;
  }

  async function loadVersion(
    auth: AuthContext,
    resumeId: string,
    versionParam: unknown,
  ): Promise<VersionRow> {
    const version = await auth.db.resumeVersion.findFirst({
      where: { id: uuidParam(versionParam), resumeId },
    });
    if (!version) throw notFound();
    return version;
  }

  const versionsOf = (auth: AuthContext, resumeId: string): Promise<VersionRow[]> =>
    auth.db.resumeVersion.findMany({ where: { resumeId } });

  const audit = (
    auth: AuthContext,
    req: Request,
    action: string,
    entityId: string,
    metadata: Record<string, string | number | boolean> = {},
  ): Promise<unknown> =>
    auth.db.auditEvent.create({
      data: {
        ownerId: auth.ownerId,
        action,
        entityType: 'Resume',
        entityId,
        correlationId: req.correlationId,
        metadata,
      },
    });

  const issueDetails = (issues: readonly ResumeIssue[]) =>
    issues
      .filter((issue) => issue.severity === 'error')
      .slice(0, 20)
      .map((issue) => ({ path: issue.path, message: issue.message }));

  // --- create / list per job -----------------------------------------------------------------

  routes.post(
    '/jobs/:jobId/resumes',
    {
      auth: 'session',
      description:
        'Generate a resume (version 1, draft) for a job from the confirmed profile facts and the job analysis.',
    },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const job = await auth.db.jobPosting.findFirst({
        where: { id: uuidParam(req.params.jobId) },
      });
      if (!job) throw notFound();
      const body = parseDto(createResumeRequestSchema, req.body);
      const document = await currentDocument(auth);
      if (document === null) {
        throw new HttpError(
          409,
          'PROFILE_REQUIRED',
          'Cadastre ou importe o perfil profissional antes de gerar um curriculo.',
        );
      }
      const analysis = await analyzeOrReuse(
        auth,
        req,
        job,
        document,
        hashProfileDocument(document),
        false,
        ai,
      );
      const parsedReview = analysisReviewSchema.safeParse(analysis.row.review);
      const review = parsedReview.success ? parsedReview.data : EMPTY_REVIEW;

      // Freeze the profile this resume is built from (immutable revision; reused when nothing changed).
      const { revision } = await store(auth).createRevision({ reason: 'pre_generation' });
      let generated = generateResume(document, { analysis: analysis.result, review });

      // AI tailoring (headline, summary, key skills, choice and order of items). Whatever the AI cannot support is
      // dropped by the program; if no provider answers, the deterministic resume above is used, with no error.
      const access = await ai.access(auth);
      let aiNotes: string[] = [];
      let aiMeta: Record<string, string | number | boolean> = {
        aiUsed: false,
        aiReason: access.reason,
      };
      if (access.router) {
        try {
          const out = await tailorResumeWithAi(access.router, {
            content: generated.content,
            document,
            analysis: analysis.result,
            jobTitle: job.title ?? null,
          });
          if (
            validateResume(out.applied.content, document).some(
              (issue) => issue.severity === 'error',
            )
          ) {
            aiNotes = [
              'A versão escrita pela IA foi descartada por ter itens sem fonte: este currículo usa o texto original dos seus registros.',
            ];
            aiMeta = { aiUsed: false, aiReason: 'rejected' };
          } else {
            generated = { content: out.applied.content, notes: generated.notes };
            aiNotes = [
              `Redigido com IA (${out.run.provider}, ${out.run.model}): revise o texto antes de aprovar.`,
              ...out.applied.notes,
            ];
            aiMeta = {
              aiUsed: true,
              aiProvider: out.run.provider,
              aiModel: out.run.model,
              aiTokens: out.run.usage.totalTokens,
              aiApplied: Object.entries(out.applied.applied)
                .filter(([, used]) => used)
                .map(([part]) => part)
                .join(','),
              aiAttempts: out.run.attempts
                .map((attempt) => `${attempt.provider}:${attempt.outcome}`)
                .join(','),
            };
          }
        } catch {
          aiNotes = [
            'A IA não respondeu agora: este currículo usa o texto original dos seus registros.',
          ];
          aiMeta = { aiUsed: false, aiReason: 'unavailable' };
        }
      }
      const issues = validateResume(generated.content, document);
      const name =
        body.name ??
        [job.title ?? 'Vaga', job.company]
          .filter((part) => part !== null)
          .join(' — ')
          .slice(0, 120);

      const resume = await auth.db.resume.create({
        data: { ownerId: auth.ownerId, jobId: job.id, name },
      });
      let version: VersionRow;
      try {
        version = await auth.db.resumeVersion.create({
          data: {
            ownerId: auth.ownerId,
            resumeId: resume.id,
            versionNumber: 1,
            language: generated.content.language,
            content: generated.content,
            contentHash: hashContent(generated.content),
            issueErrors: counts(issues).errors,
            issueWarnings: counts(issues).warnings,
            profileRevisionId: revision.id,
            analysisId: analysis.row.id,
          },
        });
      } catch (error) {
        await auth.db.resume.deleteMany({ where: { id: resume.id } });
        throw error;
      }
      await audit(auth, req, 'resume.create', resume.id, {
        versionNumber: 1,
        sections: generated.content.sections.length,
        ...aiMeta,
      });
      const response: CreateResumeResponse = {
        resume: resumeDto(resume, [version]),
        version: await detailDto(auth, version, document),
        notes: [...aiNotes, ...generated.notes].slice(0, 20),
      };
      res.status(201).json(response);
    },
  );

  routes.get(
    '/jobs/:jobId/resumes',
    { auth: 'session', description: 'Resumes of a job with their versions (no content).' },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const job = await auth.db.jobPosting.findFirst({
        where: { id: uuidParam(req.params.jobId) },
      });
      if (!job) throw notFound();
      const resumes = await auth.db.resume.findMany({
        where: { jobId: job.id },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      });
      const versions = await auth.db.resumeVersion.findMany({
        where: { resumeId: { in: resumes.map((resume) => resume.id) } },
      });
      const response: ListResumesResponse = {
        resumes: resumes.map((resume) =>
          resumeDto(
            resume,
            versions.filter((version) => version.resumeId === resume.id),
          ),
        ),
      };
      res.json(response);
    },
  );

  // --- one resume ------------------------------------------------------------------------------

  routes.get(
    '/resumes/:resumeId',
    { auth: 'session', description: 'One resume with its versions (no content).' },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const resume = await loadResume(auth, req.params.resumeId);
      const response: ResumeResponse = {
        resume: resumeDto(resume, await versionsOf(auth, resume.id)),
      };
      res.json(response);
    },
  );

  routes.patch(
    '/resumes/:resumeId',
    { auth: 'session', description: 'Rename a resume.' },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const existing = await loadResume(auth, req.params.resumeId);
      const body = parseDto(renameResumeRequestSchema, req.body);
      const resume = await auth.db.resume.update({
        where: { id: existing.id },
        data: { name: body.name },
      });
      await audit(auth, req, 'resume.rename', resume.id);
      const response: ResumeResponse = {
        resume: resumeDto(resume, await versionsOf(auth, resume.id)),
      };
      res.json(response);
    },
  );

  routes.delete(
    '/resumes/:resumeId',
    { auth: 'session', description: 'Delete a resume and all of its versions.' },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const resume = await loadResume(auth, req.params.resumeId);
      await auth.db.resume.deleteMany({ where: { id: resume.id } });
      await audit(auth, req, 'resume.delete', resume.id);
      const response: DeleteResumeResponse = { deleted: true, id: resume.id };
      res.json(response);
    },
  );

  // --- versions --------------------------------------------------------------------------------

  routes.get(
    '/resumes/:resumeId/versions/:versionId',
    {
      auth: 'session',
      description:
        'One version with its content and the factuality issues (drafts: against the current profile).',
    },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const resume = await loadResume(auth, req.params.resumeId);
      const version = await loadVersion(auth, resume.id, req.params.versionId);
      const response: ResumeVersionResponse = {
        version: await detailDto(auth, version, await currentDocument(auth)),
      };
      res.json(response);
    },
  );

  routes.put(
    '/resumes/:resumeId/versions/:versionId',
    {
      auth: 'session',
      description:
        'Replace the content of a DRAFT version. Edited text can no longer claim to be generated; approved versions are refused.',
    },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const resume = await loadResume(auth, req.params.resumeId);
      const row = await loadVersion(auth, resume.id, req.params.versionId);
      if (row.status === 'approved') {
        throw new HttpError(409, 'VERSION_APPROVED', 'A versao aprovada nao pode ser alterada.');
      }
      const body = parseDto(updateResumeVersionRequestSchema, req.body);
      const content = reconcileOrigins(parseContent(row), body.content);
      const current = await currentDocument(auth);
      const document = await validationDocument(auth, row, current);
      const issues = document === null ? [] : validateResume(content, document);
      const saved = await auth.db.resumeVersion.update({
        where: { id: row.id },
        data: {
          content,
          contentHash: hashContent(content),
          language: content.language,
          issueErrors: counts(issues).errors,
          issueWarnings: counts(issues).warnings,
        },
      });
      await auth.db.resume.update({ where: { id: resume.id }, data: { updatedAt: new Date() } });
      await audit(auth, req, 'resume.version.update', saved.id, {
        errors: counts(issues).errors,
        warnings: counts(issues).warnings,
      });
      const response: ResumeVersionResponse = { version: await detailDto(auth, saved, current) };
      res.json(response);
    },
  );

  routes.post(
    '/resumes/:resumeId/versions/:versionId/approve',
    {
      auth: 'session',
      description:
        'Approve a draft: every item must have confirmed, resume-allowed sources in the current profile. Warnings do not block.',
    },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const resume = await loadResume(auth, req.params.resumeId);
      const row = await loadVersion(auth, resume.id, req.params.versionId);
      if (row.status === 'approved') {
        throw new HttpError(409, 'VERSION_APPROVED', 'Esta versao ja esta aprovada.');
      }
      const current = await currentDocument(auth);
      if (current === null) {
        throw new HttpError(
          409,
          'PROFILE_REQUIRED',
          'O perfil profissional e necessario para validar o curriculo.',
        );
      }
      const content = parseContent(row);
      const issues = validateResume(content, current);
      if (issues.some((issue) => issue.severity === 'error')) {
        throw new HttpError(409, 'RESUME_INVALID', 'O curriculo tem itens sem fonte confirmada.', {
          details: issueDetails(issues),
        });
      }
      // Pin the profile this approval was checked against (reused when unchanged).
      const { revision } = await store(auth).createRevision({ reason: 'pre_generation' });
      const approved = await auth.db.resumeVersion.update({
        where: { id: row.id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          profileRevisionId: revision.id,
          issueErrors: 0,
          issueWarnings: counts(issues).warnings,
        },
      });
      await auth.db.resume.update({ where: { id: resume.id }, data: { updatedAt: new Date() } });
      await audit(auth, req, 'resume.version.approve', approved.id, {
        versionNumber: approved.versionNumber,
        warnings: counts(issues).warnings,
      });
      const response: ResumeVersionResponse = { version: await detailDto(auth, approved, current) };
      res.json(response);
    },
  );

  routes.get(
    '/resumes/:resumeId/versions/:versionId/export',
    {
      auth: 'session',
      description:
        'Download an APPROVED version as PDF, DOCX or HTML (template modern or classic), rendered from its stored content (409 VERSION_NOT_APPROVED otherwise).',
    },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const resume = await loadResume(auth, req.params.resumeId);
      const row = await loadVersion(auth, resume.id, req.params.versionId);
      const query = parseDto(exportResumeQuerySchema, req.query);
      if (row.status !== 'approved') {
        throw new HttpError(409, 'VERSION_NOT_APPROVED', 'Aprove a versao antes de exportar.');
      }
      const content = parseContent(row);
      if (hashContent(content) !== row.contentHash) {
        // The file must reflect exactly what was approved: refuse (logged as 500) rather than export drifted data.
        throw new Error(
          `ResumeVersion ${row.id}: content hash does not match the approved content`,
        );
      }
      const job = await auth.db.jobPosting.findFirst({ where: { id: resume.jobId } });
      let bytes: Uint8Array;
      try {
        bytes = await exclusiveExport(() =>
          renderResume(content, query.format, { template: query.template }),
        );
      } catch (error) {
        if (error instanceof ExportUnavailableError) {
          throw new HttpError(
            503,
            'EXPORT_UNAVAILABLE',
            'Nao foi possivel gerar o arquivo agora. Verifique se ha um navegador (Chromium, Chrome ou Edge) disponivel para o PDF.',
          );
        }
        throw error;
      }
      await audit(auth, req, 'resume.export', row.id, {
        format: query.format,
        template: query.template,
        versionNumber: row.versionNumber,
        contentHash: row.contentHash,
        bytes: bytes.length,
      });
      const fileName = exportFileName(
        {
          name: content.header.name,
          title: job?.title ?? null,
          company: job?.company ?? null,
          date: new Date(),
        },
        query.format,
      );
      res.status(200);
      res.setHeader('Content-Type', RESUME_EXPORT_CONTENT_TYPES[query.format]);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(Buffer.from(bytes));
    },
  );

  routes.post(
    '/resumes/:resumeId/versions',
    {
      auth: 'session',
      description:
        'New draft version copied from an existing one (edit an approved version, or recover an old one).',
    },
    requireProfileConsent,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const resume = await loadResume(auth, req.params.resumeId);
      const body = parseDto(newResumeVersionRequestSchema, req.body);
      const source = await loadVersion(auth, resume.id, body.fromVersionId);
      const content = parseContent(source);
      const latest = await auth.db.resumeVersion.aggregate({
        where: { resumeId: resume.id },
        _max: { versionNumber: true },
      });
      const current = await currentDocument(auth);
      const document = await validationDocument(auth, { ...source, status: 'draft' }, current);
      const issues = document === null ? [] : validateResume(content, document);
      const created = await auth.db.resumeVersion.create({
        data: {
          ownerId: auth.ownerId,
          resumeId: resume.id,
          versionNumber: (latest._max.versionNumber ?? 0) + 1,
          language: content.language,
          content,
          contentHash: source.contentHash,
          issueErrors: counts(issues).errors,
          issueWarnings: counts(issues).warnings,
          profileRevisionId: source.profileRevisionId,
          analysisId: source.analysisId,
          sourceVersionId: source.id,
        },
      });
      await auth.db.resume.update({ where: { id: resume.id }, data: { updatedAt: new Date() } });
      await audit(auth, req, 'resume.version.create', created.id, {
        versionNumber: created.versionNumber,
        fromVersionNumber: source.versionNumber,
      });
      const response: ResumeVersionResponse = { version: await detailDto(auth, created, current) };
      res.status(201).json(response);
    },
  );
};
