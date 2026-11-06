import {
  DEFAULT_RESUME_EXPORT_TEMPLATE,
  createResumeRequestSchema,
  createResumeResponseSchema,
  deleteResumeResponseSchema,
  listResumesResponseSchema,
  newResumeVersionRequestSchema,
  renameResumeRequestSchema,
  resumeExportFormatSchema,
  resumeExportTemplateSchema,
  resumeResponseSchema,
  resumeVersionResponseSchema,
  updateResumeVersionRequestSchema,
  type CreateResumeRequest,
  type CreateResumeResponse,
  type DeleteResumeResponse,
  type ListResumesResponse,
  type ResumeExportFormat,
  type ResumeExportTemplate,
  type ResumeResponse,
  type ResumeVersionResponse,
} from '@chameleon/contracts';
import { createApiClient, type ApiClient, type DownloadedFile } from './client';
import { validated } from './validated';

/** Gerar o PDF abre um navegador no servidor e, com banco remoto, a consulta do conteudo tambem demora. */
const EXPORT_TIMEOUT_MS = 120_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids vao no caminho: so aceitamos UUID para nao montar URL com texto arbitrario. */
function idPath(id: string): string {
  if (!UUID.test(id)) throw new Error('invalid-resume-id');
  return encodeURIComponent(id.toLowerCase());
}

export interface ResumesApi {
  listForJob(jobId: string, signal?: AbortSignal): Promise<ListResumesResponse>;
  create(jobId: string, input?: CreateResumeRequest): Promise<CreateResumeResponse>;
  get(resumeId: string, signal?: AbortSignal): Promise<ResumeResponse>;
  rename(resumeId: string, name: string): Promise<ResumeResponse>;
  remove(resumeId: string): Promise<DeleteResumeResponse>;
  getVersion(
    resumeId: string,
    versionId: string,
    signal?: AbortSignal,
  ): Promise<ResumeVersionResponse>;
  saveVersion(
    resumeId: string,
    versionId: string,
    content: unknown,
  ): Promise<ResumeVersionResponse>;
  approveVersion(resumeId: string, versionId: string): Promise<ResumeVersionResponse>;
  newVersion(resumeId: string, fromVersionId: string): Promise<ResumeVersionResponse>;
  exportVersion(
    resumeId: string,
    versionId: string,
    format: ResumeExportFormat,
    template?: ResumeExportTemplate,
  ): Promise<DownloadedFile>;
}

export function createResumesApi(client: ApiClient): ResumesApi {
  const versionPath = (resumeId: string, versionId: string): string =>
    `/api/resumes/${idPath(resumeId)}/versions/${idPath(versionId)}`;

  return {
    listForJob: (jobId, signal) =>
      client.get(`/api/jobs/${idPath(jobId)}/resumes`, {
        schema: listResumesResponseSchema,
        signal,
      }),
    create(jobId, input = {}) {
      const body = validated(createResumeRequestSchema, input);
      return client.post(`/api/jobs/${idPath(jobId)}/resumes`, {
        body,
        schema: createResumeResponseSchema,
        timeoutMs: EXPORT_TIMEOUT_MS,
      });
    },
    get: (resumeId, signal) =>
      client.get(`/api/resumes/${idPath(resumeId)}`, { schema: resumeResponseSchema, signal }),
    rename(resumeId, name) {
      const body = validated(renameResumeRequestSchema, { name });
      return client.patch(`/api/resumes/${idPath(resumeId)}`, {
        body,
        schema: resumeResponseSchema,
      });
    },
    remove: (resumeId) =>
      client.delete(`/api/resumes/${idPath(resumeId)}`, { schema: deleteResumeResponseSchema }),
    getVersion: (resumeId, versionId, signal) =>
      client.get(versionPath(resumeId, versionId), {
        schema: resumeVersionResponseSchema,
        signal,
      }),
    saveVersion(resumeId, versionId, content) {
      const body = validated(updateResumeVersionRequestSchema, { content });
      return client.put(versionPath(resumeId, versionId), {
        body,
        schema: resumeVersionResponseSchema,
      });
    },
    approveVersion: (resumeId, versionId) =>
      client.post(`${versionPath(resumeId, versionId)}/approve`, {
        schema: resumeVersionResponseSchema,
      }),
    newVersion(resumeId, fromVersionId) {
      const body = validated(newResumeVersionRequestSchema, { fromVersionId });
      return client.post(`/api/resumes/${idPath(resumeId)}/versions`, {
        body,
        schema: resumeVersionResponseSchema,
      });
    },
    exportVersion(resumeId, versionId, format, template = DEFAULT_RESUME_EXPORT_TEMPLATE) {
      const checked = validated(resumeExportFormatSchema, format);
      const layout = validated(resumeExportTemplateSchema, template);
      return client.download(
        `${versionPath(resumeId, versionId)}/export?format=${checked}&template=${layout}`,
        { timeoutMs: EXPORT_TIMEOUT_MS },
      );
    },
  };
}

export const resumesApi: ResumesApi = createResumesApi(createApiClient());
