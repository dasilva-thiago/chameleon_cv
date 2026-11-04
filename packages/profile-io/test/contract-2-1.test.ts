/**
 * Contrato 2.1.0 no importador (S0.2b): migracao 2.0.0 -> 2.1.0, telefone, idiomas, `archived`,
 * reimportacao sem ids, pendencias sem duplicatas e preview sem valores privados.
 */
import { listRecords, PROFILE_SCHEMA_VERSION } from '@chameleon/contracts';
import { describe, expect, it } from 'vitest';
import { importProfile, loadProfile, serializeProfile } from '../src/index';
import { v2CompleteYaml } from './fixtures';

const yamlOf = (body: string, version: string = PROFILE_SCHEMA_VERSION): string =>
  `schema_version: "${version}"\nprofile:\n${body}`;

const codes = (result: { report: { warnings: { code: string }[] } }): string[] =>
  result.report.warnings.map((w) => w.code);

describe('2.0.0 -> 2.1.0 (migracao aditiva)', () => {
  const body = `  identity:\n    full_name: Ana Teste\n  languages:\n    - { language: Inglês, overall_level: B2 }\n`;

  it('aceita 2.0.0, troca a versao e avisa (info) sem alterar nenhum dado', () => {
    const old = loadProfile(yamlOf(body, '2.0.0'));
    const current = loadProfile(yamlOf(body));
    expect(old.report.errors).toEqual([]);
    expect(old.ok).toBe(true);
    expect(old.report.source_schema_version).toBe('2.0.0');
    expect(old.report.target_schema_version).toBe('2.1.0');
    expect(old.document?.schema_version).toBe('2.1.0');
    expect(old.document).toEqual(current.document);
    const upgraded = old.report.warnings.filter((w) => w.code === 'SCHEMA_VERSION_UPGRADED');
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]).toMatchObject({ severity: 'info', path: 'schema_version' });
    expect(old.report.steps.map((s) => s.id)).toContain('v2_0_0_to_v2_1_0');
    expect(codes(current)).not.toContain('SCHEMA_VERSION_UPGRADED');
  });

  it('um 2.0.0 invalido continua sendo rejeitado (a migracao nao conserta dados)', () => {
    const result = loadProfile(
      yamlOf('  experiences:\n    - { organization_name: X, employment_type: banana }\n', '2.0.0'),
    );
    expect(result.ok).toBe(false);
    expect(result.report.errors.length).toBeGreaterThan(0);
  });

  it('versoes futuras e desconhecidas continuam erro claro', () => {
    expect(loadProfile(yamlOf(body, '2.2.0')).report.errors[0]?.code).toBe('VERSION_FUTURE');
    expect(loadProfile(yamlOf(body, '2.0.1')).report.errors[0]?.code).toBe('VERSION_UNSUPPORTED');
  });
});

describe('telefone no importador', () => {
  const phoneDoc = (value: string) =>
    yamlOf(`  contact_points:\n    - { id: C1, kind: phone, value: ${JSON.stringify(value)} }\n`);
  const valueOf = (value: string) =>
    loadProfile(phoneDoc(value)).document?.profile.contact_points?.[0]?.value;

  it.each([
    ['(12) 91234-5678', '12912345678'],
    ['+55 12 91234-5678', '+5512912345678'],
    ['12 91234-5678', '12912345678'],
    ['12.91234.5678', '12912345678'],
    ['(415) 555-2671', '4155552671'],
    ['+1 (415) 555-2671', '+14155552671'],
    ['+351 912 345 678', '+351912345678'],
    ['00351 912 345 678', '+351912345678'],
  ])('normaliza %s para %s', (input, canonical) => {
    expect(valueOf(input)).toBe(canonical);
  });

  it('avisa a normalizacao (contagem, sem o valor) e nao avisa quando ja esta canonico', () => {
    const changed = loadProfile(phoneDoc('(12) 91234-5678'));
    const warning = changed.report.warnings.find((w) => w.code === 'PHONE_NORMALIZED');
    expect(warning?.severity).toBe('info');
    expect(warning?.message).not.toContain('91234');
    expect(codes(loadProfile(phoneDoc('+5512912345678')))).not.toContain('PHONE_NORMALIZED');
  });

  it('o resultado e idempotente e estavel no round-trip', () => {
    const first = loadProfile(phoneDoc('+55 (12) 91234-5678')).document!;
    const again = loadProfile(serializeProfile(first)).document!;
    expect(again).toEqual(first);
  });

  it.each(['ligue-me', '(12) 9123-ABCD', '12345', '+1234567890123456', '12) 91234-5678'])(
    'rejeita %j com mensagem que nao ecoa o valor',
    (value) => {
      const result = loadProfile(phoneDoc(value));
      expect(result.ok).toBe(false);
      expect(result.report.errors.some((e) => e.path.endsWith('.value'))).toBe(true);
      expect(JSON.stringify(result.report.errors)).not.toContain(value);
    },
  );

  it('telefone de outro tipo de contato nao e tocado (e-mail e link)', () => {
    const result = loadProfile(
      yamlOf(
        `  contact_points:\n    - { id: C1, kind: email, value: ana@example.test }\n    - { id: C2, kind: link, subtype: website, value: "https://example.test/1234567" }\n`,
      ),
    );
    expect(result.ok).toBe(true);
    expect(codes(result)).not.toContain('PHONE_NORMALIZED');
  });

  it('o fixture completo do contrato (telefone com parenteses) importa normalizado', () => {
    const result = loadProfile(v2CompleteYaml());
    expect(result.ok).toBe(true);
    const phone = result.document?.profile.contact_points?.find((c) => c.kind === 'phone');
    expect(phone?.value).toBe('81900000000');
  });
});

describe('migracao 1.0.0: nivel de idioma descritivo (sem inventar CEFR)', () => {
  const legacy = (levels: (string | null)[]) =>
    loadProfile({
      schema_version: '1.0.0',
      profile: {
        languages: levels.map((level, index) => ({
          language: `Idioma ${index + 1}`,
          ...(level === null ? {} : { overall_level: level }),
        })),
      },
    });

  it.each([
    ['advanced', 'advanced'],
    ['avançado', 'avançado'],
    ['Intermediate', 'Intermediate'],
    ['nível médio', 'nível médio'],
    ['fluente', 'fluente'],
  ])('%s vira self_described_level preservando o texto e sem overall_level', (input, kept) => {
    const result = legacy([input]);
    expect(result.report.errors).toEqual([]);
    const language = result.document?.profile.languages?.[0];
    expect(language?.self_described_level).toBe(kept);
    expect(language?.overall_level).toBeUndefined();
    expect(language?.meta?.private_notes ?? '').not.toContain(input);
    expect(codes(result)).toContain('LANGUAGE_LEVEL_SELF_DESCRIBED');
  });

  it('valores CEFR e native continuam sendo overall_level (e nao geram self_described_level)', () => {
    const result = legacy(['B2', 'native', 'nativo', 'c1']);
    const languages = result.document?.profile.languages ?? [];
    expect(languages.map((l) => l.overall_level)).toEqual(['B2', 'native', 'native', 'C1']);
    expect(languages.every((l) => l.self_described_level === undefined)).toBe(true);
  });

  it('sem nivel: nada e inventado', () => {
    const language = legacy([null]).document?.profile.languages?.[0];
    expect(language?.overall_level).toBeUndefined();
    expect(language?.self_described_level).toBeUndefined();
  });

  it('texto longo demais e truncado com o original em unmapped', () => {
    const result = legacy(['x'.repeat(250)]);
    expect(result.document?.profile.languages?.[0]?.self_described_level).toHaveLength(200);
    expect(result.report.unmapped.some((u) => u.value === 'x'.repeat(250))).toBe(true);
  });
});

describe('migracao 1.0.0: pendencias sem duplicatas', () => {
  it('competencias fundidas com o mesmo motivo geram UMA pendencia por uso', () => {
    const skill = (id: string, name: string) => ({
      id,
      name,
      category: 'tool',
      acquisition_contexts: ['employment'],
      related_experience_ids: [],
      related_project_ids: [],
      related_education_ids: [],
    });
    const result = loadProfile({
      schema_version: '1.0.0',
      profile: {
        skills: [skill('SKL-001', 'Excel'), skill('SKL-002', 'excel'), skill('SKL-003', 'EXCEL')],
      },
    });
    expect(result.report.errors).toEqual([]);
    expect(result.document?.profile.skills).toHaveLength(1);
    const pendings = result.document?.profile.pending_items ?? [];
    const keys = pendings.map((p) => [p.target?.record_id, p.subject, p.reason_detail].join('|'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(pendings).toHaveLength(1);
  });
});

describe('archived na importacao (ADR-0005, emenda 2.1.0)', () => {
  const statements = (meta: string) =>
    yamlOf(
      `  statements:\n    - { id: S1, kind: short_summary, text: Resumo de teste., meta: ${meta} }\n`,
    );
  const metaOf = (meta: string) =>
    importProfile(statements(meta)).document?.profile.statements?.[0]?.meta;

  it('archived permanece archived e recebe resume_use never, mesmo se o arquivo diz allowed', () => {
    expect(metaOf('{ status: archived, resume_use: allowed, visibility: public }')).toMatchObject({
      status: 'archived',
      resume_use: 'never',
      visibility: 'public',
    });
    expect(metaOf('{ status: archived }')).toMatchObject({
      status: 'archived',
      resume_use: 'never',
      visibility: 'public',
      source: 'profile_import',
    });
    expect(metaOf('{ status: archived, visibility: private }')).toMatchObject({
      status: 'archived',
      resume_use: 'never',
      visibility: 'private',
    });
  });

  it('archived nao gera declared_status nem STATUS_SET_NEEDS_REVIEW para ele; avisa ARCHIVED_STATUS_KEPT', () => {
    const result = importProfile(statements('{ status: archived }'));
    expect(result.document?.profile.statements?.[0]?.meta?.declared_status).toBeUndefined();
    expect(codes(result)).toContain('ARCHIVED_STATUS_KEPT');
    expect(codes(result)).not.toContain('STATUS_SET_NEEDS_REVIEW');
    expect(result.preview?.totals.needs_review).toBe(0);
  });

  it('conflicting e confirmed continuam virando needs_review com declared_status preservado', () => {
    expect(metaOf('{ status: conflicting }')).toMatchObject({
      status: 'needs_review',
      declared_status: 'conflicting',
    });
    expect(metaOf('{ status: confirmed }')).toMatchObject({
      status: 'needs_review',
      declared_status: 'confirmed',
    });
    expect(metaOf('{ status: needs_review }')).toMatchObject({ status: 'needs_review' });
  });

  it('sem meta: needs_review (default) e nada de archived', () => {
    const result = importProfile(
      yamlOf('  statements:\n    - { id: S1, kind: short_summary, text: Resumo de teste. }\n'),
    );
    expect(result.document?.profile.statements?.[0]?.meta?.status).toBe('needs_review');
    expect(codes(result)).not.toContain('ARCHIVED_STATUS_KEPT');
  });

  it('a reimportacao do documento exportado e idempotente para itens archived', () => {
    const first = importProfile(statements('{ status: archived }'));
    const again = importProfile(serializeProfile(first.document!), { existing: first.document });
    expect(again.document).toEqual(first.document);
    expect(again.preview?.totals).toMatchObject({ create: 0, update: 0 });
  });
});

describe('IDS_MISSING_REIMPORT_RISK', () => {
  const noIds = yamlOf(
    '  skills:\n    - { name: Excel }\n    - { name: SQL }\n  experiences:\n    - { organization_name: Org X }\n',
  );
  const existing = importProfile(noIds).document;

  it('avisa (warning) quando ha perfil existente e registros sem id, com a contagem por tipo', () => {
    const again = importProfile(noIds, { existing });
    const warnings = again.report.warnings.filter((w) => w.code === 'IDS_MISSING_REIMPORT_RISK');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe('warning');
    expect(warnings[0]?.message).toContain('skill: 2');
    expect(warnings[0]?.message).toContain('experience: 1');
    expect(warnings[0]?.message).toMatch(/duplicar/);
    expect(again.preview?.warnings_by_code.IDS_MISSING_REIMPORT_RISK).toBe(1);
    // o comportamento nao muda: ids novos, ou seja, tudo e "create"
    expect(again.preview?.totals.create).toBe(3);
  });

  it('nao avisa sem perfil existente', () => {
    expect(codes(importProfile(noIds))).not.toContain('IDS_MISSING_REIMPORT_RISK');
    expect(codes(importProfile(noIds, { existing: null }))).not.toContain(
      'IDS_MISSING_REIMPORT_RISK',
    );
  });

  it('nao avisa quando todos os registros tem id', () => {
    const withIds = yamlOf('  skills:\n    - { id: SKL-1, name: Excel }\n');
    const first = importProfile(withIds);
    const again = importProfile(withIds, {
      existing: first.document,
      existingIdMap: first.report.id_map,
    });
    expect(codes(again)).not.toContain('IDS_MISSING_REIMPORT_RISK');
  });

  it('nao avisa para arquivo 1.0.0 (a migracao atribui ids locais)', () => {
    const legacy = {
      schema_version: '1.0.0',
      profile: { skills: [{ name: 'Excel', category: 'tool' }] },
    };
    const first = importProfile(legacy);
    const again = importProfile(legacy, { existing: first.document });
    expect(codes(again)).not.toContain('IDS_MISSING_REIMPORT_RISK');
  });
});

describe('preview sem valores privados', () => {
  const doc = yamlOf(`  experiences:
    - id: EXP-1
      organization_name: Empresa Secreta SEGREDO-ORG
      exit_reason: Motivo reservado SEGREDO-SAIDA
      official_title: Cargo Reservado SEGREDO-CARGO
      meta:
        visibility: private
        private_notes: Nota reservada SEGREDO-NOTA
      items:
        - { id: ITM-1, kind: responsibility, text: Texto reservado SEGREDO-ITEM }
  skills:
    - { id: SKL-1, name: Habilidade Reservada SEGREDO-SKILL }
  languages:
    - { id: LNG-1, language: Idioma Reservado SEGREDO-IDIOMA }
  pending_items:
    - { id: PND-1, subject: Assunto reservado SEGREDO-PEND }
`);

  it('o rotulo e tipo + posicao; nenhum segredo aparece no preview, avisos, erros ou passos', () => {
    const first = importProfile(doc);
    const again = importProfile(doc, {
      existing: first.document,
      existingIdMap: first.report.id_map,
    });
    for (const result of [first, again]) {
      expect(result.ok).toBe(true);
      const surface = JSON.stringify({
        preview: result.preview,
        warnings: result.report.warnings,
        errors: result.report.errors,
        steps: result.report.steps,
      });
      expect(surface).not.toContain('SEGREDO');
      for (const record of result.preview?.records ?? []) {
        expect(record.label).toBe(
          `${record.kind} #${Number(/\[(\d+)\]$/.exec(record.path)?.[1]) + 1}`,
        );
      }
    }
    expect(first.preview?.records.map((r) => r.label)).toEqual([
      'experience #1',
      'experience_item #1',
      'skill #1',
      'language #1',
      'pending_item #1',
    ]);
  });

  it('erros de validacao nao ecoam valores privados de campos invalidos', () => {
    const result = importProfile(
      yamlOf(
        '  experiences:\n    - { id: E1, organization_name: Org SEGREDO-ORG, start_date: SEGREDO-DATA }\n    - { id: E2, employment_type: SEGREDO-ENUM, organization_name: Y }\n',
      ),
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.report.errors)).not.toContain('SEGREDO');
  });
});

describe('field_states aninhado no pipeline', () => {
  it('declined em portfolio e needs_confirmation em metrica atravessam o importador e o round-trip', () => {
    const text = yamlOf(`  experiences:
    - id: EXP-1
      organization_name: Org
      business: { activity: Consultoria }
      meta: { field_states: { business.portfolio_url: declined } }
      items:
        - id: ITM-1
          kind: achievement
          text: Reduzi o retrabalho
          metric: { name: Retrabalho, value: "-30%" }
          meta: { field_states: { metric.value: needs_confirmation } }
`);
    const result = importProfile(text);
    expect(result.report.errors).toEqual([]);
    const experience = result.document?.profile.experiences?.[0];
    expect(experience?.meta?.field_states).toEqual({ 'business.portfolio_url': 'declined' });
    expect(experience?.items?.[0]?.meta?.field_states).toEqual({
      'metric.value': 'needs_confirmation',
    });
    const reloaded = loadProfile(serializeProfile(result.document!));
    expect(reloaded.document).toEqual(result.document);
    expect(listRecords(result.document).length).toBe(2);
  });

  it('caminho aninhado inexistente e erro, sem ecoar valores', () => {
    const result = loadProfile(
      yamlOf(
        '  experiences:\n    - { id: E1, organization_name: Org, meta: { field_states: { business.inexistente: declined } } }\n',
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.report.errors[0]?.path).toContain('field_states');
  });
});
