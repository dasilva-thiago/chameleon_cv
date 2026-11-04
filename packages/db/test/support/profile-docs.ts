import { randomUUID } from 'node:crypto';
import {
  canonicalizeProfileDocument,
  cloneJson,
  listRecords,
  normalizePhone,
  parseProfileDocument,
  PROFILE_SCHEMA_VERSION,
  remapIds,
  type ProfileDocument,
} from '@chameleon/contracts';
import { listV2ProfileIds, loadProfile, type ProfileId } from '@chameleon/test-fixtures';

/**
 * Documentos de teste a partir das fixtures sinteticas v2. Faz o que o importador faz com ids (ids
 * locais -> UUID, ids ausentes -> UUID) SEM depender do profile-io (fora da matriz de dependencias
 * do db). NAO aplica defaults de governanca: as fixtures chegam com o `meta` que declaram, o que
 * exercita `meta` parcial/ausente no banco.
 */
export function fixtureDocument(id: ProfileId): ProfileDocument {
  const raw = loadProfile(id);
  // 2.0.0 -> 2.1.0 e aditivo: so a versao muda (o importador faz o mesmo).
  const upgraded = { ...raw, schema_version: PROFILE_SCHEMA_VERSION };
  return freshIds(parseProfileDocument(upgraded));
}

/** Ids novos (UUID v4) para todos os registros e referencias; ids ausentes tambem recebem um. */
export function freshIds(document: ProfileDocument): ProfileDocument {
  const map = new Map<string, string>();
  const remapped = remapIds(canonicalizeProfileDocument(document), (id) => {
    let next = map.get(id);
    if (!next) {
      next = randomUUID();
      map.set(id, next);
    }
    return next;
  });
  const copy = cloneJson(remapped);
  for (const entry of listRecords(copy)) {
    if (entry.id === null) entry.value.id = randomUUID();
  }
  return copy;
}

/** O que o banco devolve: igual ao canonico, com telefones na forma canonica (2.1.0). */
export function expectedAfterStore(document: ProfileDocument): ProfileDocument {
  const copy = cloneJson(canonicalizeProfileDocument(document));
  for (const contact of copy.profile.contact_points ?? []) {
    if (contact.kind !== 'phone') continue;
    const normalized = normalizePhone(contact.value);
    if (normalized.ok) contact.value = normalized.value;
  }
  return copy;
}

export const V2_FIXTURE_IDS = listV2ProfileIds();
