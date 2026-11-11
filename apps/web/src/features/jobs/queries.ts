import type { CreateJobRequest, ListJobsQuery, PatchJobRequest } from '@chameleon/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { jobsApi } from '../../lib/api';

export const JOBS_KEY = ['jobs'] as const;

export function useJobs(query: ListJobsQuery) {
  return useQuery({
    queryKey: [...JOBS_KEY, 'list', query.status ?? 'active', query.q ?? ''],
    queryFn: ({ signal }) => jobsApi.list(query, signal),
    // Changing the filter or the search keeps the previous list on screen until the new one arrives (no flash).
    placeholderData: keepPreviousData,
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: [...JOBS_KEY, 'detail', id ?? ''],
    queryFn: ({ signal }) => jobsApi.get(id ?? '', signal),
    enabled: id !== undefined,
  });
}

/** Toda escrita invalida listas e detalhes: o servidor e a fonte da verdade. */
function useJobMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export const useCreateJob = () =>
  useJobMutation((input: CreateJobRequest) => jobsApi.create(input));

export const usePatchJob = () =>
  useJobMutation((vars: { id: string; input: PatchJobRequest }) =>
    jobsApi.patch(vars.id, vars.input),
  );

export const useDeleteJob = () => useJobMutation((id: string) => jobsApi.remove(id));

export function useAnalysis(jobId: string) {
  return useQuery({
    queryKey: [...JOBS_KEY, 'analysis', jobId],
    queryFn: ({ signal }) => jobsApi.getAnalysis(jobId, signal),
  });
}

export const useRunAnalysis = () =>
  useJobMutation((vars: { id: string; force?: boolean }) =>
    jobsApi.runAnalysis(vars.id, vars.force ?? false),
  );

/**
 * Prefetch a job's detail and evaluation when its link is hovered or focused, so opening it shows no loading screen.
 * Data already in the cache (fresh for the default stale time) is not fetched again.
 */
export function usePrefetchJob(): (id: string) => void {
  const client = useQueryClient();
  return (id: string) => {
    void client.prefetchQuery({
      queryKey: [...JOBS_KEY, 'detail', id],
      queryFn: ({ signal }) => jobsApi.get(id, signal),
    });
    void client.prefetchQuery({
      queryKey: [...JOBS_KEY, 'analysis', id],
      queryFn: ({ signal }) => jobsApi.getAnalysis(id, signal),
    });
  };
}
