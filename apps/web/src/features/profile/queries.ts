import type { SaveProfileBaseRequest } from '@chameleon/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileApi } from '../../lib/api';

export const PROFILE_KEY = ['profile'] as const;

export function useProfileBase() {
  return useQuery({
    queryKey: [...PROFILE_KEY, 'base'],
    queryFn: ({ signal }) => profileApi.get(signal),
  });
}

export function useProfileRevisions(enabled: boolean) {
  return useQuery({
    queryKey: [...PROFILE_KEY, 'revisions'],
    queryFn: ({ signal }) => profileApi.listRevisions(signal),
    enabled,
  });
}

/** Salvar ou restaurar muda a base: as avaliacoes das vagas passam a aparecer como desatualizadas. */
function useProfileMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: PROFILE_KEY });
      await client.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export const useSaveProfileBase = () =>
  useProfileMutation((input: SaveProfileBaseRequest) => profileApi.save(input));

export const useRestoreRevision = () =>
  useProfileMutation((id: string) => profileApi.restoreRevision(id));
