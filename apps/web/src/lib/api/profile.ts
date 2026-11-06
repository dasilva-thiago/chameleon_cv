import {
  applyImportRequestSchema,
  applyImportResponseSchema,
  confirmRecordsRequestSchema,
  confirmRecordsResponseSchema,
  createRecordRequestSchema,
  deleteRecordResponseSchema,
  discardImportResponseSchema,
  evidenceLinksResponseSchema,
  evidenceListResponseSchema,
  importPreviewRequestSchema,
  importPreviewResponseSchema,
  linkEvidenceRequestSchema,
  patchPendingRequestSchema,
  patchRecordMetaRequestSchema,
  pendingListResponseSchema,
  profileRecordResponseSchema,
  profileRecordWriteResponseSchema,
  profileStateResponseSchema,
  profileWriteResponseSchema,
  replaceRecordRequestSchema,
  saveSectionRequestSchema,
  type ApplyImportRequest,
  type ApplyImportResponse,
  type ConfirmRecordsResponse,
  type CreateRecordRequest,
  type DeleteRecordResponse,
  type DiscardImportResponse,
  type EvidenceLinksResponse,
  type EvidenceListResponse,
  type ExportQuery,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  type PatchRecordMetaRequest,
  type PendingListResponse,
  type ProfileRecordResponse,
  type ProfileRecordWriteResponse,
  type ProfileSection,
  type ProfileStateResponse,
  type ProfileWriteResponse,
} from '@chameleon/contracts';
import { createApiClient, type ApiClient, type DownloadedFile } from './client';
import { validated } from './validated';

const BASE = '/api/profile';

/** Aplicar uma importacao grande faz centenas de consultas na transacao; com banco remoto passa de 30 s. */
export const APPLY_IMPORT_TIMEOUT_MS = 180_000;

/** Ids de registro vao no caminho: so aceitamos UUID para nao montar URL com texto arbitrario. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idPath(id: string): string {
  if (!UUID.test(id)) throw new Error('invalid-record-id');
  return encodeURIComponent(id.toLowerCase());
}

export interface ProfileApi {
  getState(signal?: AbortSignal): Promise<ProfileStateResponse>;
  saveSection(section: ProfileSection, value: unknown): Promise<ProfileWriteResponse>;
  createRecord(input: CreateRecordRequest): Promise<ProfileRecordWriteResponse>;
  replaceRecord(id: string, record: Record<string, unknown>): Promise<ProfileRecordWriteResponse>;
  patchMeta(id: string, patch: PatchRecordMetaRequest): Promise<ProfileRecordWriteResponse>;
  archiveRecord(id: string): Promise<ProfileRecordWriteResponse>;
  deleteRecord(id: string): Promise<DeleteRecordResponse>;
  confirmRecords(recordIds: string[]): Promise<ConfirmRecordsResponse>;
  listEvidence(signal?: AbortSignal): Promise<EvidenceListResponse>;
  linkEvidence(evidenceId: string, recordId: string): Promise<EvidenceLinksResponse>;
  unlinkEvidence(evidenceId: string, recordId: string): Promise<EvidenceLinksResponse>;
  listPending(
    status: 'open' | 'resolved' | 'dismissed' | 'all',
    signal?: AbortSignal,
  ): Promise<PendingListResponse>;
  patchPending(
    id: string,
    status: 'open' | 'resolved' | 'dismissed',
  ): Promise<ProfileRecordResponse>;
  previewImport(input: ImportPreviewRequest): Promise<ImportPreviewResponse>;
  applyImport(importId: string, input: ApplyImportRequest): Promise<ApplyImportResponse>;
  discardImport(importId: string): Promise<DiscardImportResponse>;
  exportProfile(format: NonNullable<ExportQuery['format']>): Promise<DownloadedFile>;
}

export function createProfileApi(client: ApiClient): ProfileApi {
  return {
    getState: (signal) => client.get(BASE, { schema: profileStateResponseSchema, signal }),
    saveSection(section, value) {
      const body = validated(saveSectionRequestSchema, { value, onMissing: 'keep' });
      return client.put(`${BASE}/sections/${section}`, {
        body,
        schema: profileWriteResponseSchema,
      });
    },
    createRecord(input) {
      const body = validated(createRecordRequestSchema, input);
      return client.post(`${BASE}/records`, { body, schema: profileRecordWriteResponseSchema });
    },
    replaceRecord(id, record) {
      const body = validated(replaceRecordRequestSchema, { record });
      return client.put(`${BASE}/records/${idPath(id)}`, {
        body,
        schema: profileRecordWriteResponseSchema,
      });
    },
    patchMeta(id, patch) {
      const body = validated(patchRecordMetaRequestSchema, patch);
      return client.patch(`${BASE}/records/${idPath(id)}/meta`, {
        body,
        schema: profileRecordWriteResponseSchema,
      });
    },
    archiveRecord: (id) =>
      client.post(`${BASE}/records/${idPath(id)}/archive`, {
        schema: profileRecordWriteResponseSchema,
      }),
    deleteRecord: (id) =>
      client.delete(`${BASE}/records/${idPath(id)}`, { schema: deleteRecordResponseSchema }),
    confirmRecords(recordIds) {
      const body = validated(confirmRecordsRequestSchema, { recordIds });
      return client.post(`${BASE}/confirmations`, {
        body,
        schema: confirmRecordsResponseSchema,
      });
    },
    listEvidence: (signal) =>
      client.get(`${BASE}/evidence`, { schema: evidenceListResponseSchema, signal }),
    linkEvidence(evidenceId, recordId) {
      const body = validated(linkEvidenceRequestSchema, { recordId });
      return client.post(`${BASE}/evidence/${idPath(evidenceId)}/links`, {
        body,
        schema: evidenceLinksResponseSchema,
      });
    },
    unlinkEvidence: (evidenceId, recordId) =>
      client.delete(`${BASE}/evidence/${idPath(evidenceId)}/links/${idPath(recordId)}`, {
        schema: evidenceLinksResponseSchema,
      }),
    listPending: (status, signal) =>
      client.get(`${BASE}/pending?status=${status}`, {
        schema: pendingListResponseSchema,
        signal,
      }),
    patchPending(id, status) {
      const body = validated(patchPendingRequestSchema, { status });
      return client.patch(`${BASE}/pending/${idPath(id)}`, {
        body,
        schema: profileRecordResponseSchema,
      });
    },
    previewImport(input) {
      const body = validated(importPreviewRequestSchema, input);
      return client.post(`${BASE}/imports/preview`, {
        body,
        schema: importPreviewResponseSchema,
      });
    },
    applyImport(importId, input) {
      const body = validated(applyImportRequestSchema, input);
      return client.post(`${BASE}/imports/${idPath(importId)}/apply`, {
        body,
        schema: applyImportResponseSchema,
        timeoutMs: APPLY_IMPORT_TIMEOUT_MS,
      });
    },
    discardImport: (importId) =>
      client.post(`${BASE}/imports/${idPath(importId)}/discard`, {
        schema: discardImportResponseSchema,
      }),
    exportProfile: (format) => client.download(`${BASE}/export?format=${format}`),
  };
}

export const profileApi: ProfileApi = createProfileApi(createApiClient());
