import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiApi } from '../../lib/api';

export const AI_KEY = ['ai'] as const;

export function useAiStatus() {
  return useQuery({
    queryKey: AI_KEY,
    queryFn: ({ signal }) => aiApi.getStatus(signal),
  });
}

export function useSetAiConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (granted: boolean) => aiApi.setConsent(granted),
    onSuccess: (status) => {
      client.setQueryData(AI_KEY, status);
    },
  });
}
