import { describe, expect, it } from 'vitest';
import { listRecords, type ProfileDocument } from '@chameleon/contracts';
import { isUuid, isUuidV7 } from '@chameleon/domain';
import { importProfile, serializeProfile } from '../src/index';
import {
  legacyFilledYaml,
  sequentialIds,
  v2CompleteYaml,
  v2PartialYaml,
  v2TemplateYaml,
} from './fixtures';

const metaOf = (doc: ProfileDocument) =>
  listRecords(doc)
    .filter((r) => r.value.meta !== undefined)
    .map((r) => ({ kind: r.kind, id: r.id, meta: r.value.meta as Record<string, unknown> }));

describe('importProfile: template v2 (YAML)', () => {
  const result = importProfile(v2TemplateYaml());

  it('e valido e importa com ZERO registros', () => {
    expect(result.ok).toBe(true);
    expect(result.report.errors).toEqual([]);
    expect(result.preview?.totals).toEqual({
      records: 0,
      create: 0,
      update: 0,
      unchanged: 0,
      discarded: 0,
      needs_review: 0,
    });
    expect(result.preview?.collections).toEqual({});
    expect(result.preview?.singletons).toEqual({});
    expect(result.report.id_map).toEqual({});
    expect(listRecords(result.document)).toEqual([]);
  });

  it('nao cria nenhum fato, status, visibilidade ou texto: nada que pareca fato', () => {
    const text = JSON.stringify(result.document);
    for (const banned of [
      'confirmed',
      'needs_review',
      'public',
      'private',
      'allowed',
      'professional',
    ]) {
      expect(text, banned).not.toContain(`"${banned}"`);
    }
    expect(result.report.warnings.filter((w) => w.code === 'EMPTY_RECORD_DROPPED')).toEqual([]);
  });
});

describe('importProfile: perfil v2 completo', () => {
  const ids = sequentialIds();
  const result = importProfile(v2CompleteYaml(), { generateId: ids });
  const doc = result.document!;

  it('importa sem erros e produz preview com contagens por colecao', () => {
    expect(result.ok).toBe(true);
    expect(result.report.errors).toEqual([]);
    expect(result.report.source_schema_version).toBe('2.1.0');
    const preview = result.preview!;
    expect(preview.totals.records).toBe(listRecords(doc).length);
    expect(preview.totals.create).toBe(preview.totals.records);
    expect(preview.collections.experiences).toMatchObject({ incoming: 3, create: 3 });
    expect(preview.collections['experiences.items']).toMatchObject({ incoming: 4 });
    expect(preview.collections.skill_usages).toMatchObject({ incoming: 6 });
    expect(Object.keys(preview.singletons)).toEqual(
      expect.arrayContaining([
        'identity',
        'positioning',
        'availability_preferences',
        'career_preferences',
        'resume_preferences',
        'usage_rules',
        'review',
      ]),
    );
    expect(preview.records.find((r) => r.id === doc.profile.experiences?.[0]?.id)?.label).toBe(
      'experience #1',
    );
  });

  it('todo fato sai needs_review; o status declarado e preservado em declared_status', () => {
    const facts = metaOf(doc);
    expect(facts.length).toBeGreaterThan(20);
    expect(facts.every((f) => f.meta.status === 'needs_review')).toBe(true);
    const statuses = (kind: string) =>
      facts.filter((f) => f.kind === kind).map((f) => f.meta.declared_status ?? null);
    expect(statuses('experience')).toEqual(
      ['confirmed', 'confirmed', null].map((v, i) => (i === 2 ? null : v)),
    );
    // EXP-003 declarava needs_review: nao ha declared_status (nada a preservar)
    expect(doc.profile.experiences?.[2]?.meta?.declared_status).toBeUndefined();
    expect(result.report.warnings.some((w) => w.code === 'DECLARED_STATUS_PRESERVED')).toBe(true);
    expect(result.preview?.totals.needs_review).toBe(facts.length);
  });

  it('defaults: valores explicitos do arquivo vencem; career_narrative privada; fatos privados nunca "allowed"', () => {
    const statements = doc.profile.statements ?? [];
    expect(statements[0]?.meta).toMatchObject({
      visibility: 'public',
      resume_use: 'allowed',
      source: 'user_declared',
    });
    expect(statements[1]?.meta).toMatchObject({
      visibility: 'private',
      resume_use: 'never',
      source: 'form_entry',
    });
    for (const fact of metaOf(doc)) {
      expect(['public', 'private', 'conditional']).toContain(fact.meta.visibility);
      expect(['allowed', 'requires_approval', 'never']).toContain(fact.meta.resume_use);
      expect(fact.meta.source).toBeTruthy();
      if (fact.meta.visibility === 'private' && !('resume_use' in {})) {
        expect(fact.meta.resume_use).not.toBe('allowed');
      }
    }
    // nao ha default para contatos nem blocos privados por construcao
    expect(doc.profile.contact_points?.[0]).not.toHaveProperty('meta');
    expect(doc.profile.availability_preferences).not.toHaveProperty('meta');
  });

  it('ids locais viram UUID, o mapa local -> uuid e devolvido e TODAS as referencias foram reescritas', () => {
    const map = result.report.id_map;
    expect(Object.keys(map)).toEqual(
      expect.arrayContaining(['EXP-001', 'PRJ-001', 'SKL-001', 'EVD-001', 'ITM-002', 'RST-001']),
    );
    expect(Object.values(map).every(isUuid)).toBe(true);
    expect(listRecords(doc).every((r) => r.id !== null && isUuid(r.id))).toBe(true);
    const experience = doc.profile.experiences?.[0];
    expect(experience?.id).toBe(map['EXP-001']);
    expect(doc.profile.projects?.[0]?.related_experience_id).toBe(map['EXP-001']);
    expect(doc.profile.skill_usages?.[0]).toMatchObject({
      skill_id: map['SKL-001'],
      experience_id: map['EXP-001'],
    });
    expect(experience?.meta?.evidence_ids).toEqual([map['EVD-002']]);
    expect(doc.profile.evidence?.[0]?.supports).toEqual([map['ITM-002']]);
    expect(doc.profile.pending_items?.[0]?.target).toEqual({
      record_id: map['EXP-003'],
      field: 'end_date',
    });
    expect(doc.profile.usage_rules?.restrictions?.[0]?.target).toEqual({
      record_id: map['EXP-001'],
      field: 'organization_name',
    });
    expect(doc.profile.resume_preferences?.highlight_record_ids).toEqual([
      map['EXP-001'],
      map['PRJ-001'],
    ]);
    expect(result.report.steps.map((s) => s.id)).toEqual([
      'parse',
      'normalize',
      'validate',
      'apply_import_defaults',
      'assign_ids',
    ]);
  });

  it('registros sem id (sem meta) tambem recebem UUID', () => {
    const partial = importProfile(v2PartialYaml());
    expect(partial.ok).toBe(true);
    const all = listRecords(partial.document);
    expect(all).toHaveLength(3);
    expect(all.every((r) => r.id && isUuidV7(r.id))).toBe(true);
    expect(partial.report.id_map).toEqual({}); // nenhum id local para mapear
    expect(partial.report.warnings.some((w) => w.code === 'ID_GENERATED')).toBe(true);
  });

  it('o documento final e valido, estavel e nao compartilha estado com a entrada', () => {
    const again = importProfile(serializeProfile(doc));
    expect(again.ok).toBe(true);
    expect(again.document).toEqual(doc);
  });
});

describe('importProfile: reimportacao idempotente e preview com diff', () => {
  it('export -> import e idempotente (mesmo documento, mesmo YAML) e 0 registros novos', () => {
    const first = importProfile(v2CompleteYaml(), { generateId: sequentialIds() });
    const exported = serializeProfile(first.document!);
    const second = importProfile(exported, { existing: first.document });
    expect(second.document).toEqual(first.document);
    expect(second.preview?.totals).toMatchObject({
      create: 0,
      update: 0,
      unchanged: first.preview?.totals.records,
    });
    expect(second.preview?.untouched_existing).toBe(0);
    expect(serializeProfile(second.document!)).toBe(exported);
    const third = importProfile(serializeProfile(second.document!));
    expect(third.document).toEqual(first.document);
  });

  it('reimportar um arquivo com ids locais usando o mapa anterior preserva os ids (sem duplicar)', () => {
    const first = importProfile(v2CompleteYaml());
    const second = importProfile(v2CompleteYaml(), {
      existing: first.document,
      existingIdMap: first.report.id_map,
    });
    expect(second.report.id_map).toEqual(first.report.id_map);
    expect(second.preview?.totals.create).toBe(0);
    expect(second.preview?.totals.update).toBe(0);
    // sem o mapa, ids novos: tudo seria criado
    const withoutMap = importProfile(v2CompleteYaml(), { existing: first.document });
    expect(withoutMap.preview?.totals.create).toBe(withoutMap.preview?.totals.records);
    expect(withoutMap.preview?.untouched_existing).toBe(first.preview?.totals.records);
  });

  it('preview detecta criar/alterar/manter e ids existentes nao mencionados', () => {
    const first = importProfile(v2CompleteYaml(), { generateId: sequentialIds() });
    const existing = first.document!;
    const edited = JSON.parse(JSON.stringify(existing)) as ProfileDocument;
    edited.profile.experiences![0]!.department = 'Cardiologia';
    edited.profile.skills!.push({
      id: '0190a2c1-7b3e-7f00-8000-0000000fffff',
      name: 'Habilidade nova',
    });
    edited.profile.awards = [];
    const preview = importProfile(serializeProfile(edited), { existing }).preview!;
    const update = preview.records.filter((r) => r.action === 'update');
    expect(update).toHaveLength(1);
    expect(update[0]).toMatchObject({ kind: 'experience', changed_fields: ['department'] });
    // rotulo seguro: tipo + posicao, nunca o conteudo do registro
    const created = preview.records.filter((r) => r.action === 'create');
    expect(created.map((r) => r.kind)).toEqual(['skill']);
    expect(created[0]?.label).toMatch(/^skill #[0-9]+$/);
    expect(JSON.stringify(preview)).not.toContain('Habilidade nova');
    expect(preview.totals.create).toBe(1);
    expect(preview.untouched_existing).toBe(1); // o premio removido do arquivo permanece (merge)
  });

  it('mudar so o status/declared_status nao conta como alteracao (reimportacao nao "suja" o perfil)', () => {
    const first = importProfile(v2CompleteYaml(), { generateId: sequentialIds() });
    const confirmed = JSON.parse(JSON.stringify(first.document)) as ProfileDocument;
    confirmed.profile.experiences![0]!.meta!.status = 'confirmed';
    const preview = importProfile(serializeProfile(confirmed), {
      existing: first.document,
    }).preview!;
    expect(preview.totals.update).toBe(0);
  });
});

describe('importProfile: entradas, modos e erros', () => {
  it('aceita texto JSON e objetos', () => {
    const json = '{"schema_version":"2.0.0","profile":{"identity":{"full_name":"Ana"}}}';
    const fromJson = importProfile(json);
    const fromObject = importProfile(JSON.parse(json) as Record<string, unknown>);
    expect(fromJson.ok && fromObject.ok).toBe(true);
    expect(fromJson.report.source_format).toBe('json');
    expect(fromObject.report.source_format).toBe('object');
    expect(fromJson.document).toEqual(fromObject.document);
    expect(fromJson.preview?.singletons.identity).toEqual({ fields_set: 1 });
  });

  it('strict rejeita chave desconhecida; lenient importa, avisa e preserva em unmapped', () => {
    const text =
      'schema_version: "2.0.0"\nprofile:\n  typo_section: {x: 1}\n  identity:\n    full_name: Ana\n    cpf: "000"\n';
    const strict = importProfile(text);
    expect(strict.ok).toBe(false);
    expect(strict.document).toBeNull();
    expect(strict.preview).toBeNull();
    expect(strict.report.errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['profile', 'profile.identity']),
    );
    expect(strict.report.mode).toBe('strict');

    const lenient = importProfile(text, { mode: 'lenient' });
    expect(lenient.ok).toBe(true);
    expect(lenient.report.mode).toBe('lenient');
    expect(lenient.report.unmapped.map((u) => u.path).sort()).toEqual([
      'profile.identity.cpf',
      'profile.typo_section',
    ]);
    expect(lenient.report.warnings.filter((w) => w.code === 'UNKNOWN_KEY_UNMAPPED')).toHaveLength(
      2,
    );
    expect(lenient.preview?.unmapped_count).toBe(2);
    expect(JSON.stringify(lenient.document)).not.toContain('cpf');
  });

  it('erros de validacao trazem caminho, codigo e mensagem; nenhum documento parcial e devolvido', () => {
    const bad = importProfile(
      'schema_version: "2.0.0"\nprofile:\n  experiences:\n    - organization_name: X\n      start_date: ontem\n    - id: A\n      organization_name: Y\n    - id: A\n      organization_name: Z\n',
    );
    expect(bad.ok).toBe(false);
    expect(bad.document).toBeNull();
    expect(bad.report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'profile.experiences[0].start_date' }),
        expect.objectContaining({ path: 'profile.experiences[2].id' }),
      ]),
    );
    expect(bad.report.warnings.every((w) => typeof w.message === 'string')).toBe(true);
  });

  it('versao 9.9.9, ausente ou texto invalido: erro claro e nenhum documento', () => {
    expect(importProfile('schema_version: "9.9.9"\nprofile: {}').report.errors[0]?.code).toBe(
      'VERSION_FUTURE',
    );
    expect(importProfile('profile: {}').report.errors[0]?.code).toBe('VERSION_MISSING');
    expect(importProfile('schema_version: 2\nprofile: {}').report.errors[0]?.code).toBe(
      'VERSION_INVALID',
    );
    expect(importProfile('').report.errors[0]?.code).toBe('EMPTY');
    expect(importProfile('a: &x 1').report.errors[0]?.code).toBe('ANCHOR_NOT_ALLOWED');
    expect(importProfile('{"a":').report.errors[0]?.code).toBe('SYNTAX');
    const tooLarge = importProfile(`schema_version: "2.0.0"\nprofile: {}\n# ${'x'.repeat(3_000)}`, {
      limits: { maxBytes: 100 },
    });
    expect(tooLarge.report.errors[0]?.code).toBe('TOO_LARGE');
  });

  it('"" e registros vazios em arquivo v2 sao normalizados e reportados', () => {
    const result = importProfile(
      'schema_version: "2.0.0"\nprofile:\n  identity:\n    full_name: Ana\n    city: ""\n  experiences:\n    - id: E0\n      organization_name: ""\n    - organization_name: Org\n      department: "  "\n',
    );
    expect(result.ok).toBe(true);
    const codes = result.report.warnings.map((w) => w.code);
    expect(codes).toEqual(
      expect.arrayContaining(['EMPTY_STRING_NORMALIZED', 'EMPTY_RECORD_DROPPED']),
    );
    expect(result.document?.profile.identity).toEqual({ full_name: 'Ana' });
    expect(result.document?.profile.experiences).toHaveLength(1);
    expect(result.preview?.discarded).toHaveLength(1);
  });

  it('importar um 1.0.0 preenchido via importProfile registra versoes de origem/destino e passos (ImportRecord)', () => {
    const result = importProfile(legacyFilledYaml());
    expect(result.ok).toBe(true);
    expect(result.report).toMatchObject({
      source_schema_version: '1.0.0',
      target_schema_version: '2.1.0',
      source_format: 'yaml',
    });
    expect(result.report.steps.map((s) => s.id)).toEqual([
      'parse',
      'v1_0_0_to_v2_1_0',
      'normalize',
      'validate',
      'apply_import_defaults',
      'assign_ids',
    ]);
    expect(Object.keys(result.report.id_map).length).toBeGreaterThan(50);
    expect(result.preview?.source_schema_version).toBe('1.0.0');
    expect(result.preview?.totals.discarded).toBe(4);
    expect(metaOf(result.document!).every((f) => f.meta.status === 'needs_review')).toBe(true);
    expect(result.report.unmapped.length).toBeGreaterThanOrEqual(5);
  });
});
