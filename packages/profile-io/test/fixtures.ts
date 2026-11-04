import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

export const readRepoFile = (relative: string): string =>
  readFileSync(resolve(root, relative), 'utf8');

export const LEGACY_DIR = 'packages/contracts/fixtures/legacy/v1.0.0';
export const V2_FIXTURES_DIR = 'packages/contracts/fixtures/v2';

export const legacyTemplateYaml = () => readRepoFile(`${LEGACY_DIR}/template.v1.0.0.yaml`);
export const legacyFilledYaml = () => readRepoFile(`${LEGACY_DIR}/filled-synthetic.v1.0.0.yaml`);
export const v2TemplateYaml = () =>
  readRepoFile('templates/profile/MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.yaml');
export const v2CompleteYaml = () => readRepoFile(`${V2_FIXTURES_DIR}/complete-synthetic.v2.yaml`);
export const v2PartialYaml = () => readRepoFile(`${V2_FIXTURES_DIR}/partial-minimal.v2.yaml`);

/** Gerador deterministico de ids para testes (nao e UUID: serve a comparacoes). */
export function sequentialIds(prefix = '0190a2c1-7b3e-7f00-8000-'): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}${String(counter).padStart(12, '0')}`;
  };
}
