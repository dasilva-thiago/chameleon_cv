import {
  aiStatusResponseSchema,
  setAiConsentRequestSchema,
  type AiStatusResponse,
} from '@chameleon/contracts';
import { createApiClient, type ApiClient } from './client';
import { validated } from './validated';

const BASE = '/api/ai';

export interface AiApi {
  getStatus(signal?: AbortSignal): Promise<AiStatusResponse>;
  setConsent(granted: boolean): Promise<AiStatusResponse>;
}

export function createAiApi(client: ApiClient): AiApi {
  return {
    getStatus: (signal) => client.get(BASE, { schema: aiStatusResponseSchema, signal }),
    setConsent(granted) {
      const body = validated(setAiConsentRequestSchema, { granted });
      return client.put(`${BASE}/consent`, { body, schema: aiStatusResponseSchema });
    },
  };
}

export const aiApi: AiApi = createAiApi(createApiClient());
