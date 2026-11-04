import {
  LEGACY_SCHEMA_VERSION,
  PREVIOUS_PROFILE_SCHEMA_VERSIONS,
  PROFILE_SCHEMA_VERSION,
  type PreviousProfileSchemaVersion,
} from '@chameleon/contracts';

export type VersionDetection =
  | { kind: 'current'; version: typeof PROFILE_SCHEMA_VERSION }
  | { kind: 'legacy'; version: typeof LEGACY_SCHEMA_VERSION }
  /** 2.x anterior a corrente (ex.: 2.0.0): migracao trivial e aditiva ate a versao corrente. */
  | { kind: 'previous'; version: PreviousProfileSchemaVersion }
  | { kind: 'future'; version: string; message: string }
  | { kind: 'unsupported'; version: string; message: string }
  | { kind: 'missing'; version: null; message: string }
  | { kind: 'invalid'; version: null; message: string };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Detecta a versao do contrato de um documento ja lido. Nunca "adivinha" a versao: ausente,
 * futura ou desconhecida geram erro claro (ADR-0004).
 */
export function detectSchemaVersion(data: unknown): VersionDetection {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      kind: 'invalid',
      version: null,
      message: 'A raiz do documento deve ser um mapa/objeto.',
    };
  }
  const raw = (data as Record<string, unknown>).schema_version;
  if (raw === undefined || raw === null) {
    return {
      kind: 'missing',
      version: null,
      message: `schema_version ausente: informe "${PROFILE_SCHEMA_VERSION}" (ou "${LEGACY_SCHEMA_VERSION}" para arquivos legados).`,
    };
  }
  if (typeof raw !== 'string') {
    return {
      kind: 'invalid',
      version: null,
      message: `schema_version deve ser um texto (ex.: "${PROFILE_SCHEMA_VERSION}").`,
    };
  }
  if (raw === PROFILE_SCHEMA_VERSION) return { kind: 'current', version: PROFILE_SCHEMA_VERSION };
  if (raw === LEGACY_SCHEMA_VERSION) return { kind: 'legacy', version: LEGACY_SCHEMA_VERSION };
  const previous = PREVIOUS_PROFILE_SCHEMA_VERSIONS.find((version) => version === raw);
  if (previous) return { kind: 'previous', version: previous };
  const match = SEMVER.exec(raw);
  if (match) {
    const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const [curMajor, curMinor, curPatch] = PROFILE_SCHEMA_VERSION.split('.').map(Number) as [
      number,
      number,
      number,
    ];
    const isFuture =
      major > curMajor ||
      (major === curMajor && (minor > curMinor || (minor === curMinor && patch > curPatch)));
    if (isFuture) {
      return {
        kind: 'future',
        version: raw,
        message: `schema_version ${raw} e mais novo que o suportado (${PROFILE_SCHEMA_VERSION}); atualize o aplicativo.`,
      };
    }
  }
  return {
    kind: 'unsupported',
    version: raw,
    message: `schema_version ${raw} nao e suportado (suportadas: ${[LEGACY_SCHEMA_VERSION, ...PREVIOUS_PROFILE_SCHEMA_VERSIONS, PROFILE_SCHEMA_VERSION].join(', ')}).`,
  };
}
