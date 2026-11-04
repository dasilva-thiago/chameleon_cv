import {
  canonicalizeProfileDocument,
  cloneJson,
  listRecords,
  normalizePhone,
  parseProfileDocument,
  remapIds,
  type ProfileDocument,
} from '@chameleon/contracts';
import { ProfileStoreError } from '../profile-store/errors';
import { isJsonObject, type Json } from './codec';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuidShape = (value: string): boolean => UUID_SHAPE.test(value);

export interface PreparedDocument {
  /** Documento canonico (sem nulos), valido, com TODO registro com UUID minusculo. */
  document: ProfileDocument;
  /** Quantos registros nao tinham id e receberam um novo. */
  generatedIds: number;
  /** Quantos telefones foram gravados na forma canonica. */
  phonesNormalized: number;
}

/**
 * Prepara o documento para virar linhas: valida (contrato corrente), canonicaliza (nulos
 * saem), exige UUID em todo id, gera ids ausentes e grava telefones na forma canonica (2.1.0).
 * Pura (o gerador de ids e injetado).
 */
export function prepareDocument(input: unknown, generateId: () => string): PreparedDocument {
  const validated = parseProfileDocument(input);
  const canonical = canonicalizeProfileDocument(validated);

  const remapped = remapIds(canonical, (id) => {
    if (!isUuidShape(id)) {
      throw new ProfileStoreError(
        'NON_UUID_ID',
        'Todo id de registro precisa ser UUID para ser persistido: importe o arquivo (que mapeia ids locais) antes de salvar.',
      );
    }
    return id.toLowerCase();
  });

  const document = cloneJson(remapped);
  let generatedIds = 0;
  for (const entry of listRecords(document)) {
    if (entry.id === null) {
      entry.value.id = generateId();
      generatedIds += 1;
    }
  }

  let phonesNormalized = 0;
  const contacts = document.profile.contact_points;
  if (Array.isArray(contacts)) {
    for (const contact of contacts as Json[]) {
      if (!isJsonObject(contact) || contact.kind !== 'phone' || typeof contact.value !== 'string') {
        continue;
      }
      const normalized = normalizePhone(contact.value);
      if (normalized.ok && normalized.value !== contact.value) {
        contact.value = normalized.value;
        phonesNormalized += 1;
      }
    }
  }
  return { document, generatedIds, phonesNormalized };
}
