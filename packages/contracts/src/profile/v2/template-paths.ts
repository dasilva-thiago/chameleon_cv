import { profileDocumentSchema } from './document';
import { listSchemaPaths } from './paths';

/**
 * Caminhos de campo do contrato e regras do template Markdown (ADR-0003, ADR-0013).
 *
 * O template `templates/profile/MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.md` anota cada campo com
 * `<!-- path: profile.experiences[].official_title -->`. Teste bidirecional:
 *  1. todo caminho anotado existe no contrato;
 *  2. todo campo preenchivel do contrato esta anotado OU casa com uma regra abaixo.
 */

/** Todos os caminhos folha do contrato (ex.: `profile.experiences[].official_title`). */
export function listContractPaths(): string[] {
  return listSchemaPaths(profileDocumentSchema).leaves.map((leaf) => leaf.path);
}

export interface MdExemptionRule {
  /** O caminho termina com este sufixo. */
  suffix: string;
  reason: string;
}

/**
 * Campos que o formulario Markdown NAO anota, por serem tecnicos ou definidos pelo sistema.
 * Qualquer outro campo do contrato precisa de anotacao no MD.
 */
export const MD_EXEMPT_PATH_RULES: readonly MdExemptionRule[] = [
  {
    suffix: '.meta.status',
    reason: 'Definido pelo importador: todo fato importado entra como needs_review (ADR-0005).',
  },
  {
    suffix: '.meta.declared_status',
    reason: 'Preenchido pelo importador com o status declarado no arquivo de origem.',
  },
  {
    suffix: '.meta.source',
    reason: 'Preenchido pelo importador/sistema (profile_import, form_entry, ...).',
  },
  {
    suffix: '.meta.source_detail',
    reason: 'Detalhe de origem preenchido por importadores e pela IA de extracao, nao por pessoas.',
  },
  {
    suffix: '.meta.source_excerpt',
    reason:
      'Trecho de origem preenchido por importadores de curriculo/IA (resume_import, ai_extraction).',
  },
  {
    suffix: '.meta.field_states',
    reason:
      'No MD os estados explicitos sao escritos como marcadores no lugar do valor: (nao se aplica), (prefiro nao informar), (ainda nao avaliei), (confirmar depois).',
  },
  {
    suffix: '.field_states',
    reason: 'Idem: marcadores textuais no lugar do valor (ver .meta.field_states).',
  },
];

export function isMdExemptPath(path: string): boolean {
  return MD_EXEMPT_PATH_RULES.some((rule) => path.endsWith(rule.suffix));
}

/** Extrai os caminhos anotados (`<!-- path: ... -->`) de um template Markdown. */
export function extractMdAnnotatedPaths(markdown: string): string[] {
  const out: string[] = [];
  const regex = /<!--\s*path:\s*([^\s>]+?)\s*-->/g;
  for (const match of markdown.matchAll(regex)) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}
