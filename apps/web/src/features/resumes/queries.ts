import type { ResumeExportFormat, ResumeVersionResponse } from '@chameleon/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resumesApi } from '../../lib/api';
import { saveBlob } from '../../lib/download';

export const RESUMES_KEY = ['resumes'] as const;
const jobKey = (jobId: string) => [...RESUMES_KEY, 'job', jobId] as const;
const resumeKey = (resumeId: string) => [...RESUMES_KEY, 'resume', resumeId] as const;
const versionKey = (resumeId: string, versionId: string) =>
  [...RESUMES_KEY, 'version', resumeId, versionId] as const;

export function useJobResumes(jobId: string) {
  return useQuery({
    queryKey: jobKey(jobId),
    queryFn: ({ signal }) => resumesApi.listForJob(jobId, signal),
  });
}

export function useResume(resumeId: string | undefined) {
  return useQuery({
    queryKey: resumeKey(resumeId ?? ''),
    queryFn: ({ signal }) => resumesApi.get(resumeId ?? '', signal),
    enabled: resumeId !== undefined,
  });
}

export function useResumeVersion(resumeId: string | undefined, versionId: string | undefined) {
  return useQuery({
    queryKey: versionKey(resumeId ?? '', versionId ?? ''),
    queryFn: ({ signal }) => resumesApi.getVersion(resumeId ?? '', versionId ?? '', signal),
    enabled: resumeId !== undefined && versionId !== undefined,
  });
}

/** O servidor e a fonte da verdade: toda escrita invalida listas e detalhes dos curriculos. */
const invalidateAll = (client: QueryClient) => client.invalidateQueries({ queryKey: RESUMES_KEY });

/** Guarda a versao devolvida no cache (evita um refetch que poderia sobrepor o que esta na tela). */
function storeVersion(client: QueryClient, response: ResumeVersionResponse): void {
  const { version } = response;
  client.setQueryData(versionKey(version.resumeId, version.id), response);
  void client.invalidateQueries({ queryKey: [...RESUMES_KEY, 'job'] });
  void client.invalidateQueries({ queryKey: [...RESUMES_KEY, 'resume'] });
}

export function useCreateResume() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { jobId: string }) => resumesApi.create(vars.jobId),
    onSuccess: () => invalidateAll(client),
  });
}

export function useRenameResume() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { resumeId: string; name: string }) =>
      resumesApi.rename(vars.resumeId, vars.name),
    onSuccess: () => invalidateAll(client),
  });
}

export function useDeleteResume() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (resumeId: string) => resumesApi.remove(resumeId),
    onSuccess: () => invalidateAll(client),
  });
}

export function useNewVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { resumeId: string; fromVersionId: string }) =>
      resumesApi.newVersion(vars.resumeId, vars.fromVersionId),
    onSuccess: (response) => {
      storeVersion(client, response);
    },
  });
}

export function useSaveVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { resumeId: string; versionId: string; content: unknown }) =>
      resumesApi.saveVersion(vars.resumeId, vars.versionId, vars.content),
    onSuccess: (response) => {
      storeVersion(client, response);
    },
  });
}

export function useApproveVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { resumeId: string; versionId: string }) =>
      resumesApi.approveVersion(vars.resumeId, vars.versionId),
    onSuccess: (response) => {
      storeVersion(client, response);
    },
    // Os problemas mostrados podem estar defasados (o perfil pode ter mudado): recarrega.
    onError: (_error, vars) => {
      void client.invalidateQueries({ queryKey: versionKey(vars.resumeId, vars.versionId) });
    },
  });
}

export function useExportVersion() {
  return useMutation({
    mutationFn: async (vars: {
      resumeId: string;
      versionId: string;
      format: ResumeExportFormat;
    }) => {
      const file = await resumesApi.exportVersion(vars.resumeId, vars.versionId, vars.format);
      saveBlob(file.blob, file.filename ?? `curriculo.${vars.format}`);
      return vars.format;
    },
  });
}
