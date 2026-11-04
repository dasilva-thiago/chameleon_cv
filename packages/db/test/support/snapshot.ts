import { createHash } from 'node:crypto';
import {
  canonicalizeProfileDocument,
  PROFILE_SCHEMA_VERSION,
  type ProfileDocument,
} from '@chameleon/contracts';
import type { SnapshotBuilder } from '../../src/profile-store';

/**
 * Construtor de snapshot dos TESTES do db. `packages/db` nao pode importar `@chameleon/domain`
 * (tests/architecture/deps-lib.ts), entao aqui ha uma implementacao independente do mesmo
 * algoritmo (JSON canonico RFC 8785 + SHA-256 via node:crypto). A API usa `buildProfileSnapshot`
 * de `@chameleon/domain`; ambos devem produzir o mesmo hash (vetores em domain/test/snapshot.test.ts).
 */
function jcs(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${jcs(record[key])}`)
    .join(',')}}`;
}

export const testSnapshot: SnapshotBuilder = (document: ProfileDocument) => {
  const canonical = canonicalizeProfileDocument(document);
  return {
    schemaVersion: canonical.schema_version ?? PROFILE_SCHEMA_VERSION,
    contentHash: createHash('sha256').update(jcs(canonical), 'utf8').digest('hex'),
    document: canonical,
  };
};
