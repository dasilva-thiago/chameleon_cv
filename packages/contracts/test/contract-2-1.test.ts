import { describe, expect, it } from 'vitest';
import {
  isCanonicalPhone,
  normalizePhone,
  PREVIOUS_PROFILE_SCHEMA_VERSIONS,
  PROFILE_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
} from '../src/index';
import { doc, isValid, issuesOf } from './helpers';

/** Mudancas aditivas do contrato 2.1.0 (ADR-0004, emenda da S0.2b). */
describe('versao 2.1.0', () => {
  it('2.1.0 e a corrente, 2.0.0 e anterior aceita pelo importador e 1.0.0 segue legada', () => {
    expect(PROFILE_SCHEMA_VERSION).toBe('2.1.0');
    expect(PREVIOUS_PROFILE_SCHEMA_VERSIONS).toEqual(['2.0.0']);
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual(['1.0.0', '2.0.0', '2.1.0']);
  });

  it('o contrato Zod valida somente a versao corrente (2.0.0 passa pela migracao do importador)', () => {
    expect(isValid({ schema_version: '2.1.0', profile: {} })).toBe(true);
    expect(isValid({ schema_version: '2.0.0', profile: {} })).toBe(false);
  });
});

describe('telefone: formas comuns (BR, US, PT) e forma canonica', () => {
  const accepted: [string, string][] = [
    ['(12) 91234-5678', '12912345678'],
    ['+55 12 91234-5678', '+5512912345678'],
    ['12 91234-5678', '12912345678'],
    ['12.91234.5678', '12912345678'],
    ['+55 (12) 91234-5678', '+5512912345678'],
    ['(+55) 12 91234-5678', '+5512912345678'],
    ['(11) 3456-7890', '1134567890'],
    ['+1 (415) 555-2671', '+14155552671'],
    ['(415) 555-2671', '4155552671'],
    ['415.555.2671', '4155552671'],
    ['+351 912 345 678', '+351912345678'],
    ['00351 912 345 678', '+351912345678'],
    ['912 345 678', '912345678'],
    ['+5512912345678', '+5512912345678'],
    ['1234567', '1234567'],
    ['+123456789012345', '+123456789012345'],
  ];

  it.each(accepted)(
    'normaliza %s para %s; o contrato aceita a entrada e a forma canonica',
    (input, canonical) => {
      expect(normalizePhone(input)).toEqual({ ok: true, value: canonical });
      expect(isCanonicalPhone(canonical)).toBe(true);
      for (const value of [input, canonical]) {
        expect(isValid(doc({ contact_points: [{ kind: 'phone', value }] })), value).toBe(true);
      }
    },
  );

  it('normalizar e idempotente', () => {
    for (const [input] of accepted) {
      const once = normalizePhone(input);
      if (!once.ok) throw new Error('esperado ok');
      expect(normalizePhone(once.value)).toEqual(once);
    }
  });

  const rejected = [
    'ligue-me',
    '(12) 9123-ABCD',
    '12345',
    '123456',
    '+1234567890123456',
    '1234567890123456',
    '12 91234-5678 ramal 12',
    '12 91234-5678 x12',
    '55+12912345678',
    '++5512912345678',
    '(12 91234-5678',
    '12) 91234-5678',
    '((12)) 91234-5678',
    '()-.',
  ];

  it.each(rejected)('rejeita %j sem ecoar o valor na mensagem', (value) => {
    const result = normalizePhone(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain(value);
    const issues = issuesOf(doc({ contact_points: [{ kind: 'phone', value }] }));
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain(value);
  });

  it('vazio ou so espacos nunca e telefone', () => {
    expect(normalizePhone('').ok).toBe(false);
    expect(normalizePhone('   ').ok).toBe(false);
  });
});

describe('idiomas: self_described_level (aditivo)', () => {
  it('aceita nivel descritivo sozinho, junto com CEFR e com native', () => {
    expect(
      isValid(doc({ languages: [{ language: 'Inglês', self_described_level: 'avançado' }] })),
    ).toBe(true);
    expect(
      isValid(
        doc({
          languages: [{ language: 'Inglês', overall_level: 'B2', self_described_level: 'fluente' }],
        }),
      ),
    ).toBe(true);
    expect(isValid(doc({ languages: [{ language: 'Português', overall_level: 'native' }] }))).toBe(
      true,
    );
    expect(isValid(doc({ languages: [{ language: 'Francês', self_described_level: null }] }))).toBe(
      true,
    );
  });

  it('o nivel descritivo nao e promovido a CEFR: overall_level continua restrito ao enum', () => {
    expect(isValid(doc({ languages: [{ language: 'Inglês', overall_level: 'avançado' }] }))).toBe(
      false,
    );
    expect(isValid(doc({ languages: [{ language: 'Inglês', overall_level: 'advanced' }] }))).toBe(
      false,
    );
  });

  it('rejeita texto vazio, longo demais e tipo errado', () => {
    for (const value of ['', 'x'.repeat(201), 3]) {
      expect(
        isValid(doc({ languages: [{ language: 'Inglês', self_described_level: value }] })),
      ).toBe(false);
    }
  });
});

describe('meta.field_states aninhado', () => {
  const experience = (extra: Record<string, unknown>) =>
    doc({ experiences: [{ id: 'EXP-1', organization_name: 'Org', ...extra }] });

  it('aceita declined em business.portfolio_url vazio', () => {
    expect(
      isValid(
        experience({
          business: { activity: 'Consultoria' },
          meta: { field_states: { 'business.portfolio_url': 'declined' } },
        }),
      ),
    ).toBe(true);
  });

  it('aceita needs_confirmation em metric.value preenchido (item de experiencia)', () => {
    expect(
      isValid(
        experience({
          items: [
            {
              id: 'ITM-1',
              kind: 'achievement',
              text: 'Reduzi o retrabalho',
              metric: { name: 'Retrabalho', value: '-30%' },
              meta: { field_states: { 'metric.value': 'needs_confirmation' } },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('rejeita declined em caminho aninhado que tem valor (conflito)', () => {
    const issues = issuesOf(
      experience({
        business: { portfolio_url: 'https://exemplo.test/portfolio' },
        meta: { field_states: { 'business.portfolio_url': 'declined' } },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('profile.experiences[0].meta.field_states.business.portfolio_url');
    expect(issues[0]?.message).toMatch(/conflito/);
  });

  it('rejeita caminhos que nao existem no tipo de registro', () => {
    // metric.value existe em experience_item, nao em experience
    for (const key of [
      'business.nao_existe',
      'metric.value',
      'location.city.x',
      'nao_existe.value',
    ]) {
      const issues = issuesOf(experience({ meta: { field_states: { [key]: 'declined' } } }));
      expect(issues.length, key).toBeGreaterThan(0);
    }
  });

  it('rejeita chaves malformadas (maiuscula, ponto duplo, quatro niveis, colchetes)', () => {
    for (const key of [
      'Business.portfolio_url',
      'business..portfolio_url',
      'a.b.c.d',
      'items[0].text',
      'business.',
    ]) {
      expect(isValid(experience({ meta: { field_states: { [key]: 'declined' } } })), key).toBe(
        false,
      );
    }
  });

  it('continua valendo para campos de primeiro nivel e para blocos', () => {
    expect(
      isValid(experience({ meta: { field_states: { end_date: 'needs_confirmation' } } })),
    ).toBe(true);
    expect(
      isValid(
        doc({
          availability_preferences: {
            salary_expectation: { currency: 'BRL' },
            field_states: { 'salary_expectation.amount': 'declined' },
          },
        }),
      ),
    ).toBe(true);
    expect(
      isValid(
        doc({
          availability_preferences: { field_states: { 'salary_expectation.nada': 'declined' } },
        }),
      ),
    ).toBe(false);
  });

  it('e coerente com pending.target.field: o mesmo caminho aninhado vale nos dois', () => {
    const ok = doc({
      experiences: [
        {
          id: 'EXP-1',
          organization_name: 'Org',
          business: { activity: 'X' },
          meta: { field_states: { 'business.portfolio_url': 'declined' } },
        },
      ],
      pending_items: [
        { subject: 'Portfolio', target: { record_id: 'EXP-1', field: 'business.portfolio_url' } },
      ],
    });
    expect(isValid(ok)).toBe(true);
  });
});
