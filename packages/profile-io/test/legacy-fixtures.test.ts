import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { legacyProfileV1Schema } from '@chameleon/contracts';
import { LEGACY_DIR, legacyFilledYaml, legacyTemplateYaml, readRepoFile } from './fixtures';

const yaml = (text: string): unknown => parse(text, { schema: 'core', version: '1.2' });

describe('fixtures legadas 1.0.0', () => {
  it('as copias sao semanticamente identicas aos originais da raiz (que ficam intocados)', () => {
    expect(yaml(legacyTemplateYaml())).toEqual(
      yaml(readRepoFile('MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.yaml')),
    );
    expect(JSON.parse(readRepoFile(`${LEGACY_DIR}/profile-schema.v1.0.0.json`))).toEqual(
      JSON.parse(readRepoFile('PERFIL_PROFISSIONAL_SCHEMA.json')),
    );
    // o formulario Markdown 1.0.0 tambem foi copiado (conteudo reformatado pelo prettier, mesmo titulo e versao)
    const md = readRepoFile(`${LEGACY_DIR}/template.v1.0.0.md`);
    expect(md).toContain('# Modelo universal de perfil profissional');
    expect(md).toContain('1.0.0');
    expect(md).toContain('Não informado');
  });

  it('o YAML 1.0.0 (template e preenchido sintetico) e valido no Zod legado', () => {
    expect(legacyProfileV1Schema.safeParse(yaml(legacyTemplateYaml())).success).toBe(true);
    expect(legacyProfileV1Schema.safeParse(yaml(legacyFilledYaml())).success).toBe(true);
  });
});
