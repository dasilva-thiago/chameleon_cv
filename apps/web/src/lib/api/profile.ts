import {
  listProfileRevisionsResponseSchema,
  profileBaseResponseSchema,
  profileRevisionResponseSchema,
  saveProfileBaseRequestSchema,
  saveProfileBaseResponseSchema,
  type ListProfileRevisionsResponse,
  type ProfileBaseResponse,
  type ProfileRevisionResponse,
  type SaveProfileBaseRequest,
  type SaveProfileBaseResponse,
} from '@chameleon/contracts';
import { createApiClient, type ApiClient } from './client';
import { validated } from './validated';

const BASE = '/api/profile';

/** Ids de revisao vao no caminho: so aceitamos UUID para nao montar URL com texto arbitrario. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idPath(id: string): string {
  if (!UUID.test(id)) throw new Error('invalid-revision-id');
  return encodeURIComponent(id.toLowerCase());
}

/** A base profissional (CV + perfil e regras em Markdown) e o historico de revisoes. */
export interface ProfileApi {
  get(signal?: AbortSignal): Promise<ProfileBaseResponse>;
  save(input: SaveProfileBaseRequest): Promise<SaveProfileBaseResponse>;
  listRevisions(signal?: AbortSignal): Promise<ListProfileRevisionsResponse>;
  getRevision(id: string, signal?: AbortSignal): Promise<ProfileRevisionResponse>;
  restoreRevision(id: string): Promise<SaveProfileBaseResponse>;
}

export function createProfileApi(client: ApiClient): ProfileApi {
  return {
    get: (signal) => client.get(BASE, { schema: profileBaseResponseSchema, signal }),
    save(input) {
      const body = validated(saveProfileBaseRequestSchema, input);
      return client.put(BASE, { body, schema: saveProfileBaseResponseSchema });
    },
    listRevisions: (signal) =>
      client.get(`${BASE}/revisions`, { schema: listProfileRevisionsResponseSchema, signal }),
    getRevision: (id, signal) =>
      client.get(`${BASE}/revisions/${idPath(id)}`, {
        schema: profileRevisionResponseSchema,
        signal,
      }),
    restoreRevision: (id) =>
      client.post(`${BASE}/revisions/${idPath(id)}/restore`, {
        schema: saveProfileBaseResponseSchema,
      }),
  };
}

export const profileApi: ProfileApi = createProfileApi(createApiClient());
