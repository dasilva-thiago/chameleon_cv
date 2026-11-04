/**
 * Contrato 2.1.0 x fixtures sinteticas (S0.2b): migracao aditiva 2.0.0 -> 2.1.0, `archived` na importacao
 * e ausencia de canarios de campos privados em preview, relatorio e erros.
 */
import { PROFILE_SCHEMA_VERSION } from '@chameleon/contracts';
import { importProfile } from '@chameleon/profile-io';
import { describe, expect, it } from 'vitest';
import {
  EDGE_PROFILES,
  PROFILES,
  listProfileCanaries,
  listV2ProfileIds,
  loadEdgeProfileYaml,
  loadProfileYaml,
} from '../src/index';
import { privacyReason } from './privacy';
import { isRec, walk } from './support';

const V2_IDS = listV2ProfileIds();
const PREVIOUS = PROFILES.filter((p) => p.format === 'v2' && p.schemaVersion === '2.0.0');

describe('versoes 2.x das fixtures', () => {
  it('ha pelo menos 2 fixtures em 2.0.0 (prova da migracao) e as demais em 2.1.0', () => {
    expect(PREVIOUS.length).toBeGreaterThanOrEqual(2);
    for (const info of PROFILES.filter((p) => p.format === 'v2' && p.schemaVersion !== '2.0.0')) {
      expect(info.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    }
  });

  it.each(PREVIOUS.map((p) => [p.id] as const))(
    '%s (2.0.0) importa sem erros, vira 2.1.0 e registra o aviso informativo SCHEMA_VERSION_UPGRADED',
    (id) => {
      const result = importProfile(loadProfileYaml(id));
      expect(result.report.errors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.report.source_schema_version).toBe('2.0.0');
      expect(result.report.target_schema_version).toBe(PROFILE_SCHEMA_VERSION);
      expect(result.document?.schema_version).toBe(PROFILE_SCHEMA_VERSION);
      const upgraded = result.report.warnings.filter((w) => w.code === 'SCHEMA_VERSION_UPGRADED');
      expect(upgraded).toHaveLength(1);
      expect(upgraded[0]?.severity).toBe('info');
      expect(result.report.steps.map((s) => s.id)).toContain('v2_0_0_to_v2_1_0');
    },
  );

  it.each(V2_IDS.map((id) => [id] as const))(
    '%s: so fixtures em 2.0.0 geram SCHEMA_VERSION_UPGRADED',
    (id) => {
      const result = importProfile(loadProfileYaml(id));
      const upgraded = result.report.warnings.some((w) => w.code === 'SCHEMA_VERSION_UPGRADED');
      expect(upgraded).toBe(PREVIOUS.some((p) => p.id === id));
    },
  );
});

describe('canarios de campos privados nao aparecem em preview, relatorio nem mensagens', () => {
  // `unmapped` guarda por desenho o valor descartado (nada se perde em silencio); nao e exibido ao usuario final
  // e as fixtures v2 validas nao descartam nada. O restante do relatorio e a pre-visualizacao nao podem citar valores.
  const safeSurface = (result: ReturnType<typeof importProfile>): string =>
    JSON.stringify({
      preview: result.preview,
      warnings: result.report.warnings,
      errors: result.report.errors,
      steps: result.report.steps,
      source_schema_version: result.report.source_schema_version,
    });

  it.each(V2_IDS.map((id) => [id] as const))('%s', (id) => {
    const canaries = listProfileCanaries(id);
    const result = importProfile(loadProfileYaml(id));
    expect(result.ok).toBe(true);
    const surface = safeSurface(result);
    for (const canary of canaries) expect(surface, canary).not.toContain(canary);
    // com perfil existente (diff do merge) o mesmo vale
    const merged = importProfile(loadProfileYaml(id), {
      existing: result.document,
      existingIdMap: result.report.id_map,
    });
    const mergedSurface = safeSurface(merged);
    for (const canary of canaries) expect(mergedSurface, canary).not.toContain(canary);
  });

  it('private-heavy: o rotulo do preview e tipo + posicao e nao contem nome de empregador privado', () => {
    const result = importProfile(loadProfileYaml('private-heavy'));
    const preview = result.preview!;
    for (const record of preview.records) {
      expect(record.label).toMatch(/^[a-z_]+( #[0-9]+)?$/);
    }
    expect(JSON.stringify(preview)).not.toContain('Consultoria Provisória');
  });

  it('private-heavy: o item archived sai archived com resume_use never e continua classificado como privado', () => {
    const result = importProfile(loadProfileYaml('private-heavy'));
    const document = result.document!;
    let found = false;
    walk(document, ({ value }) => {
      if (isRec(value) && typeof value.text === 'string' && value.text.includes('archived_item')) {
        found = true;
        expect(value.meta).toMatchObject({ status: 'archived', resume_use: 'never' });
      }
    });
    expect(found).toBe(true);
    // sem canario fora de campo privado no documento importado
    walk(document, ({ value, path }) => {
      if (typeof value === 'string' && value.includes('CANARY-')) {
        expect(privacyReason(document, path), path.join('.')).not.toBeNull();
      }
    });
  });

  it('erros de validacao de bordas nao ecoam valores nem canarios', () => {
    for (const edge of EDGE_PROFILES) {
      const result = importProfile(loadEdgeProfileYaml(edge.id));
      const text = JSON.stringify(result.report.errors);
      expect(text, edge.id).not.toContain('CANARY-');
    }
  });
});
