import {
  canonicalizeProfileDocument,
  listRecords,
  PROFILE_SCHEMA_VERSION,
  type ProfileDocument,
  type RecordKind,
} from '@chameleon/contracts';
import { canonicalJson } from './canonical-json';
import { sha256Hex } from './sha256';

/**
 * Snapshot imutavel do perfil (ADR-0006, itens 4 e 5; domain-model §3.3).
 *
 * O hash e o SHA-256 do JSON canonico (RFC 8785) da FORMA CANONICA do documento
 * (`canonicalizeProfileDocument`: sem chaves nulas, ordem do schema, `[]` mantido). Portanto:
 * - `null`, ausencia e ordem das chaves nao alteram o hash;
 * - `[]` ("nenhum item fornecido") e a ausencia da colecao produzem hashes DIFERENTES (semantica
 *   distinta, ADR-0005);
 * - o hash e estavel entre processos, maquinas e reordenacao de JSONB no banco.
 */

export interface ProfileSnapshot {
  /** Versao do contrato do documento (a corrente ao criar o snapshot). */
  schemaVersion: string;
  /** SHA-256 hexadecimal (64) do JSON canonico do documento canonico. */
  contentHash: string;
  /** Documento canonico completo (com ids e `meta`). */
  document: ProfileDocument;
}

/** JSON canonico (RFC 8785) da forma canonica do documento: a entrada do hash. */
export function canonicalProfileJson(document: ProfileDocument): string {
  return canonicalJson(canonicalizeProfileDocument(document));
}

/** SHA-256 do JSON canonico do documento. */
export function hashProfileDocument(document: ProfileDocument): string {
  return sha256Hex(canonicalProfileJson(document));
}

export function buildProfileSnapshot(document: ProfileDocument): ProfileSnapshot {
  const canonical = canonicalizeProfileDocument(document);
  return {
    schemaVersion: canonical.schema_version ?? PROFILE_SCHEMA_VERSION,
    contentHash: sha256Hex(canonicalJson(canonical)),
    document: canonical,
  };
}

/** `true` quando o hash declarado confere com o conteudo do documento. */
export function verifyProfileSnapshot(snapshot: ProfileSnapshot): boolean {
  return hashProfileDocument(snapshot.document) === snapshot.contentHash;
}

export interface SnapshotRecordRef {
  kind: RecordKind;
  /** Caminho no documento (ex.: `profile.experiences[0].items[1]`). */
  path: string;
}

/**
 * Indice `id -> {kind, path}` dos registros do snapshot. Geracoes citam `sourceFactIds` que devem
 * pertencer ao snapshot (nunca a linhas vivas); registros sem id nao entram no indice.
 */
export function indexSnapshotRecords(document: ProfileDocument): Map<string, SnapshotRecordRef> {
  const index = new Map<string, SnapshotRecordRef>();
  for (const entry of listRecords(document)) {
    if (entry.id === null || index.has(entry.id)) continue;
    const path = entry.path.reduce<string>(
      (acc, segment) =>
        typeof segment === 'number' ? `${acc}[${segment}]` : acc ? `${acc}.${segment}` : segment,
      '',
    );
    index.set(entry.id, { kind: entry.kind, path });
  }
  return index;
}

/** Os ids citados existem no snapshot? Devolve os ids ausentes (lista vazia = todos presentes). */
export function missingSnapshotIds(document: ProfileDocument, ids: readonly string[]): string[] {
  const index = indexSnapshotRecords(document);
  return ids.filter((id) => !index.has(id));
}
