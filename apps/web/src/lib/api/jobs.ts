import {
  analysisStateResponseSchema,
  createJobRequestSchema,
  deleteJobResponseSchema,
  jobResponseSchema,
  listJobsResponseSchema,
  patchAnalysisReviewRequestSchema,
  patchJobRequestSchema,
  runAnalysisRequestSchema,
  runAnalysisResponseSchema,
  type AnalysisReview,
  type AnalysisStateResponse,
  type CreateJobRequest,
  type DeleteJobResponse,
  type JobResponse,
  type ListJobsQuery,
  type ListJobsResponse,
  type PatchJobRequest,
  type RunAnalysisResponse,
} from '@chameleon/contracts';
import { createApiClient, type ApiClient } from './client';
import { validated } from './validated';

const BASE = '/api/jobs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idPath(id: string): string {
  if (!UUID.test(id)) throw new Error('invalid-job-id');
  return encodeURIComponent(id.toLowerCase());
}

export interface JobsApi {
  list(query: ListJobsQuery, signal?: AbortSignal): Promise<ListJobsResponse>;
  get(id: string, signal?: AbortSignal): Promise<JobResponse>;
  create(input: CreateJobRequest): Promise<JobResponse>;
  patch(id: string, input: PatchJobRequest): Promise<JobResponse>;
  remove(id: string): Promise<DeleteJobResponse>;
  getAnalysis(id: string, signal?: AbortSignal): Promise<AnalysisStateResponse>;
  runAnalysis(id: string, force?: boolean): Promise<RunAnalysisResponse>;
  saveReview(id: string, review: AnalysisReview): Promise<AnalysisStateResponse>;
}

export function createJobsApi(client: ApiClient): JobsApi {
  return {
    list(query, signal) {
      const params = new URLSearchParams();
      if (query.status !== undefined) params.set('status', query.status);
      if (query.q !== undefined && query.q !== '') params.set('q', query.q);
      if (typeof query.limit === 'number') params.set('limit', String(query.limit));
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return client.get(`${BASE}${suffix}`, { schema: listJobsResponseSchema, signal });
    },
    get: (id, signal) => client.get(`${BASE}/${idPath(id)}`, { schema: jobResponseSchema, signal }),
    create(input) {
      const body = validated(createJobRequestSchema, input);
      return client.post(BASE, { body, schema: jobResponseSchema });
    },
    patch(id, input) {
      const body = validated(patchJobRequestSchema, input);
      return client.patch(`${BASE}/${idPath(id)}`, { body, schema: jobResponseSchema });
    },
    remove: (id) => client.delete(`${BASE}/${idPath(id)}`, { schema: deleteJobResponseSchema }),
    getAnalysis: (id, signal) =>
      client.get(`${BASE}/${idPath(id)}/analysis`, { schema: analysisStateResponseSchema, signal }),
    runAnalysis(id, force = false) {
      const body = validated(runAnalysisRequestSchema, { force });
      return client.post(`${BASE}/${idPath(id)}/analysis`, {
        body,
        schema: runAnalysisResponseSchema,
      });
    },
    saveReview(id, review) {
      const body = validated(patchAnalysisReviewRequestSchema, { review });
      return client.patch(`${BASE}/${idPath(id)}/analysis/review`, {
        body,
        schema: analysisStateResponseSchema,
      });
    },
  };
}

export const jobsApi: JobsApi = createJobsApi(createApiClient());
