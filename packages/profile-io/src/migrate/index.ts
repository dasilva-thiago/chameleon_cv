import {
  LEGACY_SCHEMA_VERSION,
  legacyProfileV1Schema,
  PROFILE_SCHEMA_VERSION,
  formatIssuePath,
  type PreviousProfileSchemaVersion,
} from '@chameleon/contracts';
import type { ReportBuilder } from '../report';
import { migrateV1ToV2 } from './v1-to-v2';

export { migrateV1ToV2 } from './v1-to-v2';

export type MigrateResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: { path: string; code: string; message: string }[] };

/**
 * Cadeia de migracoes puras ate a versao corrente (ADR-0004). Cada passo devolve o documento
 * seguinte e registra `steps`/`warnings` no relatorio. Hoje: 1.0.0 -> 2.0.0.
 */
export const MIGRATION_CHAIN = [
  { from: LEGACY_SCHEMA_VERSION, to: PROFILE_SCHEMA_VERSION, id: 'v1_0_0_to_v2_1_0' },
  { from: '2.0.0', to: PROFILE_SCHEMA_VERSION, id: 'v2_0_0_to_v2_1_0' },
] as const;

/**
 * Passo 2.x -> corrente. O 2.1.0 so ACRESCENTA (telefone aceita mais formas de entrada,
 * `languages[].self_described_level`, `field_states` aninhado): todo documento 2.0.0 valido segue
 * valido, entao a migracao so troca `schema_version` e registra um aviso informativo.
 */
export function migratePreviousToCurrent(
  data: unknown,
  from: PreviousProfileSchemaVersion,
  report: ReportBuilder,
): MigrateResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      errors: [
        {
          path: '',
          code: 'PREVIOUS_INVALID',
          message: 'A raiz do documento deve ser um mapa/objeto.',
        },
      ],
    };
  }
  report.step(
    `v${from.replaceAll('.', '_')}_to_v${PROFILE_SCHEMA_VERSION.replaceAll('.', '_')}`,
    from,
    PROFILE_SCHEMA_VERSION,
    `Migracao aditiva ${from} -> ${PROFILE_SCHEMA_VERSION}: apenas schema_version muda.`,
    1,
  );
  report.info(
    'SCHEMA_VERSION_UPGRADED',
    'schema_version',
    `Documento ${from} atualizado para ${PROFILE_SCHEMA_VERSION} (mudancas aditivas; nenhum dado foi alterado alem da versao).`,
  );
  return {
    ok: true,
    data: { ...(data as Record<string, unknown>), schema_version: PROFILE_SCHEMA_VERSION },
  };
}

export function migrateLegacyToCurrent(data: unknown, report: ReportBuilder): MigrateResult {
  const parsed = legacyProfileV1Schema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: formatIssuePath(issue.path),
        code: 'LEGACY_INVALID',
        message: `Documento 1.0.0 invalido: ${issue.message}`,
      })),
    };
  }
  return { ok: true, data: migrateV1ToV2(parsed.data, report) };
}
