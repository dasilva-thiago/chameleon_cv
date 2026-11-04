import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractMdAnnotatedPaths,
  isMdExemptPath,
  listContractPaths,
  MD_EXEMPT_PATH_RULES,
} from '../src/index';

const mdPath = resolve(
  __dirname,
  '../../../templates/profile/MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.md',
);
const markdown = readFileSync(mdPath, 'utf8');
const annotated = new Set(extractMdAnnotatedPaths(markdown));
const contract = new Set(listContractPaths());

describe('template Markdown v2 anotado (ADR-0003 / ADR-0013)', () => {
  it('todo caminho anotado existe no contrato', () => {
    const unknown = [...annotated].filter((path) => !contract.has(path));
    expect(unknown).toEqual([]);
  });

  it('todo campo preenchivel do contrato esta anotado ou isento por regra documentada', () => {
    const missing = [...contract].filter((path) => !annotated.has(path) && !isMdExemptPath(path));
    expect(missing).toEqual([]);
  });

  it('as isencoes sao explicitas, justificadas e nao escondem campos de conteudo', () => {
    expect(MD_EXEMPT_PATH_RULES.length).toBeGreaterThan(0);
    for (const rule of MD_EXEMPT_PATH_RULES) {
      expect(rule.suffix.startsWith('.')).toBe(true);
      expect(rule.reason.length).toBeGreaterThan(20);
    }
    const exempt = [...contract].filter(isMdExemptPath);
    // so campos tecnicos de meta/field_states ficam fora do formulario
    expect(exempt.every((path) => /\.(meta\.[a-z_]+|field_states)$/.test(path))).toBe(true);
    const exemptMeta = new Set(
      exempt.filter((p) => p.includes('.meta.')).map((p) => p.split('.meta.')[1]),
    );
    expect([...exemptMeta].sort()).toEqual([
      'declared_status',
      'field_states',
      'source',
      'source_detail',
      'source_excerpt',
      'status',
    ]);
  });

  it('campos de governanca que pessoas controlam estao anotados em todo registro citavel', () => {
    const factCollections = [
      'statements',
      'competency_examples',
      'experiences',
      'experiences[].items',
      'projects',
      'projects[].items',
      'education',
      'courses',
      'skills',
      'skill_usages',
      'languages',
      'certifications',
      'awards',
      'publications',
      'volunteering',
    ];
    for (const collection of factCollections) {
      for (const field of ['resume_use', 'visibility', 'evidence_ids', 'private_notes']) {
        expect(
          annotated.has(`profile.${collection}[].meta.${field}`.replace('items[][]', 'items[]')),
          `${collection} ${field}`,
        ).toBe(true);
      }
    }
  });

  it('cobre os 20 itens do Adendo secao 4 (cada item tem ao menos um campo anotado)', () => {
    const items: [number, string, string[]][] = [
      [
        1,
        'identificacao e contatos',
        ['profile.identity.full_name', 'profile.contact_points[].value'],
      ],
      [
        2,
        'posicionamento, resumo e narrativa',
        [
          'profile.positioning.current_profession',
          'profile.statements[].text',
          'profile.career_preferences.short_term_goals',
        ],
      ],
      [
        3,
        'cargos, areas, setores e senioridade de interesse',
        [
          'profile.career_preferences.priority_job_titles',
          'profile.career_preferences.fields_of_interest',
          'profile.career_preferences.preferred_industries',
          'profile.career_preferences.target_seniority_levels',
        ],
      ],
      [
        4,
        'experiencias',
        [
          'profile.experiences[].official_title',
          'profile.experiences[].organization_group',
          'profile.experiences[].items[].text',
        ],
      ],
      [
        5,
        'projetos',
        [
          'profile.projects[].name',
          'profile.projects[].category',
          'profile.projects[].items[].kind',
          'profile.projects[].related_experience_id',
        ],
      ],
      [
        6,
        'formacao',
        [
          'profile.education[].institution',
          'profile.education[].degree_type',
          'profile.education[].status',
        ],
      ],
      [7, 'cursos', ['profile.courses[].name', 'profile.courses[].completion_date']],
      [8, 'competencias', ['profile.skills[].name', 'profile.skills[].category']],
      [
        9,
        'contexto de uso das competencias',
        ['profile.skill_usages[].usage_context', 'profile.skill_usages[].experience_id'],
      ],
      [
        10,
        'idiomas por habilidade',
        [
          'profile.languages[].reading',
          'profile.languages[].writing',
          'profile.languages[].listening',
          'profile.languages[].speaking',
        ],
      ],
      [
        11,
        'certificacoes e licencas',
        ['profile.certifications[].name', 'profile.certifications[].category'],
      ],
      [12, 'premios', ['profile.awards[].name']],
      [
        13,
        'publicacoes e palestras',
        ['profile.publications[].title', 'profile.publications[].type'],
      ],
      [
        14,
        'voluntariado e lideranca',
        ['profile.volunteering[].organization', 'profile.volunteering[].participation_type'],
      ],
      [
        15,
        'autonomo, freelance e empreendedorismo',
        ['profile.experiences[].employment_type', 'profile.experiences[].business.activity'],
      ],
      [
        16,
        'disponibilidade e preferencias de trabalho',
        [
          'profile.availability_preferences.preferred_work_modes',
          'profile.availability_preferences.salary_expectation.amount',
        ],
      ],
      [
        17,
        'preferencias de carreira e de apresentacao',
        [
          'profile.career_preferences.interest_in_adjacent_fields',
          'profile.resume_preferences.tone',
        ],
      ],
      [
        18,
        'evidencias e referencias',
        [
          'profile.evidence[].type',
          'profile.evidence[].supports',
          'profile.experiences[].reference_contact_permission',
        ],
      ],
      [
        19,
        'pendentes, incertos e conflitantes',
        [
          'profile.pending_items[].subject',
          'profile.pending_items[].reason',
          'profile.pending_items[].target.record_id',
        ],
      ],
      [
        20,
        'privacidade e regras de uso',
        ['profile.usage_rules.restrictions[].rule', 'profile.experiences[].meta.visibility'],
      ],
    ];
    expect(items).toHaveLength(20);
    for (const [number, title, paths] of items) {
      for (const path of paths)
        expect(annotated.has(path), `item ${number} (${title}): ${path}`).toBe(true);
    }
  });

  it('corrige as divergencias da auditoria: sem sentinela "Nao informado" como valor e com respostas de 3 opcoes sem perda', () => {
    // a regra 1.1.7 do 1.0.0 mandava escrever "Nao informado"; agora so aparece como proibicao
    const mentions = markdown.match(/Não informado/g) ?? [];
    expect(mentions.length).toBeGreaterThan(0);
    expect(markdown).toMatch(/\*\*Não escreva “Não informado”\*\*/);
    expect(markdown).not.toMatch(/use `?Não informado`?/);
    for (const path of [
      'profile.projects[].public_access',
      'profile.evidence[].recruiter_sharing',
    ]) {
      expect(annotated.has(path)).toBe(true);
    }
    expect(markdown).toMatch(
      /`public` \(sim\), `partial` \(parcialmente\) ou `not_public` \(não\)/,
    );
    expect(markdown).toMatch(
      /`allowed` \(sim\), `restricted` \(com restrição\) ou `not_allowed` \(não\)/,
    );
    // campos do MD 1.0.0 sem chave no YAML/Schema agora existem
    for (const path of [
      'profile.experiences[].manager_or_team',
      'profile.experiences[].workload',
      'profile.career_preferences.what_makes_a_job_interesting',
      'profile.career_preferences.work_balance_preference',
      'profile.career_preferences.adjacent_fields_conditions',
      'profile.career_preferences.responsibilities_to_avoid',
      'profile.languages[].certification.issuer',
      'profile.languages[].certification.valid_until',
      'profile.courses[].start_date',
    ]) {
      expect(annotated.has(path), path).toBe(true);
    }
  });

  it('nao ha caminho anotado duplicado de forma conflitante com campo inexistente e o arquivo usa LF/UTF-8', () => {
    expect(markdown.includes('\r')).toBe(false);
    expect(markdown.startsWith('# Modelo universal de perfil profissional')).toBe(true);
  });
});
