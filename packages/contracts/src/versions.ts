import { LEGACY_SCHEMA_VERSION } from './legacy';
import { PROFILE_SCHEMA_VERSION } from './profile';

/**
 * Versoes 2.x anteriores a corrente que o importador aceita (migracao trivial, aditiva).
 * O contrato Zod valida SOMENTE a versao corrente; estas passam por `migrateV2MinorToCurrent`.
 */
export const PREVIOUS_PROFILE_SCHEMA_VERSIONS = ['2.0.0'] as const;
export type PreviousProfileSchemaVersion = (typeof PREVIOUS_PROFILE_SCHEMA_VERSIONS)[number];

/** Versoes do documento de perfil que o importador sabe ler (corrente, anteriores 2.x e legada). */
export const SUPPORTED_SCHEMA_VERSIONS = [
  LEGACY_SCHEMA_VERSION,
  ...PREVIOUS_PROFILE_SCHEMA_VERSIONS,
  PROFILE_SCHEMA_VERSION,
] as const;
export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

export function isSupportedSchemaVersion(value: unknown): value is SupportedSchemaVersion {
  return (
    typeof value === 'string' && (SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(value)
  );
}
