import type { SaveProfileBaseRequest } from '@chameleon/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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

/**
 * How the program reads the text being edited, refreshed a moment after typing stops (the request is cheap: no AI,
 * nothing stored). The previous reading stays on screen while the next one loads.
 */
export function useBaseReading(cvMarkdown: string, profileMarkdown: string, delayMs = 600) {
  const [input, setInput] = useState({ cvMarkdown, profileMarkdown });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInput({ cvMarkdown, profileMarkdown });
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [cvMarkdown, profileMarkdown, delayMs]);
  return useQuery({
    queryKey: [...PROFILE_KEY, 'reading', input.cvMarkdown, input.profileMarkdown],
    queryFn: ({ signal }) => profileApi.read(input, signal),
    enabled: input.cvMarkdown.trim() !== '' || input.profileMarkdown.trim() !== '',
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: Infinity,
  });
}
