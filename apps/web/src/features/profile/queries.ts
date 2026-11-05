import type {
  ApplyImportRequest,
  CreateRecordRequest,
  ImportPreviewRequest,
  PatchRecordMetaRequest,
  ProfileSection,
} from '@chameleon/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileApi } from '../../lib/api';

export const PROFILE_KEY = ['profile'] as const;
export const STATE_KEY = ['profile', 'state'] as const;
export type PendingFilter = 'open' | 'resolved' | 'dismissed' | 'all';

export function useProfileState() {
  return useQuery({
    queryKey: STATE_KEY,
    queryFn: ({ signal }) => profileApi.getState(signal),
    staleTime: 30_000,
  });
}

export function usePendingList(status: PendingFilter) {
  return useQuery({
    queryKey: ['profile', 'pending', status],
    queryFn: ({ signal }) => profileApi.listPending(status, signal),
  });
}

export function useEvidenceList() {
  return useQuery({
    queryKey: ['profile', 'evidence'],
    queryFn: ({ signal }) => profileApi.listEvidence(signal),
  });
}

/** Toda escrita invalida o cache do perfil: o servidor e a fonte da verdade (sem copia otimista). */
function useProfileMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: PROFILE_KEY });
    },
  });
}

export const useCreateRecord = () =>
  useProfileMutation((input: CreateRecordRequest) => profileApi.createRecord(input));

export const useReplaceRecord = () =>
  useProfileMutation((vars: { id: string; record: Record<string, unknown> }) =>
    profileApi.replaceRecord(vars.id, vars.record),
  );

export const usePatchMeta = () =>
  useProfileMutation((vars: { id: string; patch: PatchRecordMetaRequest }) =>
    profileApi.patchMeta(vars.id, vars.patch),
  );

export const useArchiveRecord = () =>
  useProfileMutation((id: string) => profileApi.archiveRecord(id));

export const useDeleteRecord = () =>
  useProfileMutation((id: string) => profileApi.deleteRecord(id));

export const useConfirmRecords = () =>
  useProfileMutation((ids: string[]) => profileApi.confirmRecords(ids));

export const useSaveSection = () =>
  useProfileMutation((vars: { section: ProfileSection; value: unknown }) =>
    profileApi.saveSection(vars.section, vars.value),
  );

export const usePatchPending = () =>
  useProfileMutation((vars: { id: string; status: 'open' | 'resolved' | 'dismissed' }) =>
    profileApi.patchPending(vars.id, vars.status),
  );

export const useLinkEvidence = () =>
  useProfileMutation((vars: { evidenceId: string; recordId: string }) =>
    profileApi.linkEvidence(vars.evidenceId, vars.recordId),
  );

export const useUnlinkEvidence = () =>
  useProfileMutation((vars: { evidenceId: string; recordId: string }) =>
    profileApi.unlinkEvidence(vars.evidenceId, vars.recordId),
  );

export const usePreviewImport = () =>
  useMutation({ mutationFn: (input: ImportPreviewRequest) => profileApi.previewImport(input) });

export const useApplyImport = () =>
  useProfileMutation((vars: { importId: string; input: ApplyImportRequest }) =>
    profileApi.applyImport(vars.importId, vars.input),
  );

export const useDiscardImport = () =>
  useMutation({ mutationFn: (importId: string) => profileApi.discardImport(importId) });
