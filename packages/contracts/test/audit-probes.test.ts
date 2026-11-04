import { describe, expect, it } from 'vitest';
import { doc, isValid, issuesOf } from './helpers';

/**
 * As 21 sondas da auditoria do contrato 1.0.0 (docs/domain-model.md secao 1.2) como testes de
 * regressao do contrato 2.0.0. Os payloads originais das sondas nao foram preservados no
 * repositorio: foram reconstruidos a partir da tabela da secao 1.2, ja traduzidos para os
 * campos equivalentes do 2.0.0. Invalidos sao REJEITADOS; perfil vazio e campos null ACEITOS.
 */

interface Probe {
  id: string;
  title: string;
  input: unknown;
  /** Trecho esperado no caminho da primeira falha (quando rejeitado). */
  path?: string;
}

const REJECTED: Probe[] = [
  {
    id: 'P02',
    title: 'chave desconhecida em profile (ex.: typo_experinces)',
    input: doc({ typo_experinces: [{ organization_name: 'X' }] }),
    path: 'profile',
  },
  {
    id: 'P03',
    title: 'employment_type "banana"',
    input: doc({ experiences: [{ organization_name: 'X', employment_type: 'banana' }] }),
    path: 'employment_type',
  },
  {
    id: 'P04',
    title: 'contexto de uso "banana" (acquisition_contexts do 1.0.0)',
    input: doc({
      skills: [{ id: 'S', name: 'x' }],
      skill_usages: [{ skill_id: 'S', usage_context: 'banana' }],
    }),
    path: 'usage_context',
  },
  {
    id: 'P05',
    title: 'nivel de idioma "super" (reading)',
    input: doc({ languages: [{ language: 'Ingles', reading: 'super' }] }),
    path: 'reading',
  },
  {
    id: 'P06',
    title: 'data livre "last summer" em start_date',
    input: doc({ experiences: [{ organization_name: 'X', start_date: 'last summer' }] }),
    path: 'start_date',
  },
  {
    id: 'P07',
    title: 'URL invalida "not a url"',
    input: doc({ projects: [{ name: 'P', public_url: 'not a url' }] }),
    path: 'public_url',
  },
  {
    id: 'P08',
    title: 'e-mail profissional invalido "x"',
    input: doc({ contact_points: [{ kind: 'email', value: 'x' }] }),
    path: 'value',
  },
  {
    id: 'P09',
    title: 'usage_context numerico (123) em vez de texto',
    input: doc({
      skills: [{ id: 'S', name: 'x' }],
      skill_usages: [{ skill_id: 'S', usage_context: 123 }],
    }),
    path: 'usage_context',
  },
  {
    id: 'P10',
    title: 'location opaca ({anything: true})',
    input: doc({ experiences: [{ organization_name: 'X', location: { anything: true } }] }),
    path: 'location',
  },
  {
    id: 'P11',
    title: 'ids duplicados em experiences[].id',
    input: doc({
      experiences: [
        { id: 'EXP-001', organization_name: 'A' },
        { id: 'EXP-001', organization_name: 'B' },
      ],
    }),
    path: 'experiences[1].id',
  },
  {
    id: 'P12',
    title: 'evidence_id apontando para evidencia inexistente',
    input: doc({ experiences: [{ organization_name: 'X', meta: { evidence_ids: ['EVD-404'] } }] }),
    path: 'evidence_ids[0]',
  },
  {
    id: 'P13',
    title: 'salary_expectation.amount negativo (-5)',
    input: doc({ availability_preferences: { salary_expectation: { amount: -5 } } }),
    path: 'amount',
  },
  {
    id: 'P14',
    title: 'schema_version 0.9.0 (versao desconhecida)',
    input: { schema_version: '0.9.0', profile: {} },
    path: 'schema_version',
  },
  {
    id: 'P15',
    title: 'chave desconhecida dentro de um registro (extra_field)',
    input: doc({ experiences: [{ organization_name: 'X', extra_field: 1 }] }),
    path: 'experiences[0]',
  },
  {
    id: 'P16',
    title: 'chave desconhecida em bloco (identity)',
    input: doc({ identity: { full_name: 'A', cpf: '000' } }),
    path: 'identity',
  },
  {
    id: 'P17',
    title: 'meta.status invalido',
    input: doc({ experiences: [{ organization_name: 'X', meta: { status: 'banana' } }] }),
    path: 'status',
  },
  {
    id: 'P18',
    title: 'visibility invalida ("secret") em contato',
    input: doc({
      contact_points: [{ kind: 'link', value: 'https://x.test', visibility: 'secret' }],
    }),
    path: 'visibility',
  },
  {
    id: 'P19',
    title: 'referencia de projeto para experiencia inexistente',
    input: doc({ projects: [{ name: 'P', related_experience_id: 'EXP-404' }] }),
    path: 'related_experience_id',
  },
  {
    id: 'P20',
    title: 'professional_experience sem experiencia (contexto sem fonte)',
    input: doc({
      skills: [{ id: 'S', name: 'x' }],
      skill_usages: [{ skill_id: 'S', usage_context: 'professional_experience' }],
    }),
    path: 'skill_usages[0]',
  },
  {
    id: 'P21',
    title: 'texto vazio ("") em vez de null (placeholder do 1.0.0)',
    input: doc({ identity: { full_name: '' } }),
    path: 'full_name',
  },
];

describe('21 sondas da auditoria 1.0.0 (regressao no contrato 2.0.0)', () => {
  it.each(REJECTED)('$id rejeita: $title', ({ input, path }) => {
    const issues = issuesOf(input);
    expect(issues.length, 'deveria ser rejeitado').toBeGreaterThan(0);
    if (path)
      expect(
        issues.some((issue) => issue.path.includes(path)),
        JSON.stringify(issues),
      ).toBe(true);
  });

  it('P01 aceita perfil vazio ({schema_version, profile: {}})', () => {
    expect(isValid(doc({}))).toBe(true);
  });

  it('P22+ aceita start_date, completion_date e issue_date null (contradicao do 1.0.0 resolvida)', () => {
    expect(
      isValid(
        doc({
          experiences: [{ organization_name: 'X', start_date: null, end_date: null }],
          courses: [{ name: 'C', start_date: null, completion_date: null }],
          education: [{ institution: 'E', completion_date: null, expected_completion_date: null }],
          certifications: [{ name: 'Cert', issue_date: null, expiration_date: null }],
        }),
      ),
    ).toBe(true);
  });

  it('contagem: 20 sondas de rejeicao + 1 de perfil vazio = 21 sondas', () => {
    expect(REJECTED.length + 1).toBe(21);
  });
});
