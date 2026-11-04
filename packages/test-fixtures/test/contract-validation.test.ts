/**
 * Validacao das fixtures contra o contrato canonico 2.0.0 (`@chameleon/contracts`) e contra o importador
 * (`@chameleon/profile-io`): validacao, round-trip, importacao com governanca, reimportacao idempotente,
 * casos de borda (strict/lenient), migracao 1.0.0 -> 2.0.0 e vazamento de canarios.
 *
 * Fonte da verdade: o contrato real (packages/contracts/src/profile/v2) e docs/domain-model.md §2 e §4, ADR-0004,
 * ADR-0005, ADR-0007 e ADR-0014. Quando uma fixture divergia do contrato, a FIXTURE foi corrigida (ver README).
 */
import {
  FACT_KINDS,
  IMPORT_WARNING_CODES,
  PROFILE_SCHEMA_VERSION,
  buildProfileJsonSchema,
  canonicalizeProfileDocument,
  importReportSchema,
  listRecords,
  listReferences,
  parseProfileDocument,
  profileDocumentSchema,
  safeParseProfileDocument,
  type ImportReport,
  type ProfileDocument,
} from '@chameleon/contracts';
import {
  ReportBuilder,
  importProfile,
  loadProfile as loadProfileText,
  migrateLegacyToCurrent,
  serializeProfile,
} from '@chameleon/profile-io';
import { describe, expect, it } from 'vitest';
import {
  EDGE_PROFILES,
  PROFILES,
  listEdgeProfiles,
  listLegacyProfileIds,
  listProfileCanaries,
  listV2ProfileIds,
  loadEdgeProfileYaml,
  loadProfile as loadProfileRaw,
  loadProfileYaml,
  parseProfileYaml,
  type EdgeProfileId,
  type ProfileId,
} from '../src/index';
import { privacyReason, type PathPart } from './privacy';
import { isRec, walk, type Rec } from './support';

const V2_IDS = listV2ProfileIds();
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEGACY_ID: ProfileId = 'legacy-1.0.0-filled';
const CANARY_TOKEN = /CANARY-[A-Za-z0-9_-]+/g;
const CANARY_ONE = /CANARY-[A-Za-z0-9_-]+/;

/**
 * Fixture ja lida do disco. As fixtures declaradas em 2.0.0 (prova da migracao aditiva 2.0.0 -> 2.1.0)
 * ganham a versao corrente aqui, para os testes que validam DIRETO no contrato Zod (que so aceita a
 * corrente); o que acontece com o arquivo original em 2.0.0 e testado na secao "versoes 2.x".
 */
function loadProfile(id: ProfileId): Rec {
  const data = loadProfileRaw(id) as Rec;
  return data.schema_version === '2.0.0'
    ? { ...data, schema_version: PROFILE_SCHEMA_VERSION }
    : data;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

function must<T>(value: T | null | undefined, what = 'valor'): T {
  if (value === null || value === undefined) throw new Error(`${what} ausente`);
  return value;
}

function importOk(text: string, options: Parameters<typeof importProfile>[1] = {}) {
  const result = importProfile(text, options);
  expect(result.report.errors, 'erros de importacao').toEqual([]);
  expect(result.ok).toBe(true);
  return { ...result, document: must(result.document, 'document'), preview: must(result.preview) };
}

function loadOk(text: string, options: Parameters<typeof loadProfileText>[1] = {}) {
  const result = loadProfileText(text, options);
  expect(result.report.errors).toEqual([]);
  expect(result.ok).toBe(true);
  return { ...result, document: must(result.document, 'document') };
}

const warningCodes = (report: ImportReport): Set<string> =>
  new Set(report.warnings.map((warning) => warning.code));

/** Folhas string do documento que contem algum canario, com seu caminho. */
function canaryLeaves(document: unknown): { path: PathPart[]; value: string }[] {
  const leaves: { path: PathPart[]; value: string }[] = [];
  walk(document, ({ value, path }) => {
    if (typeof value === 'string' && value.includes('CANARY-')) {
      leaves.push({ path: [...path], value });
    }
  });
  return leaves;
}

function leaks(document: unknown): string[] {
  return canaryLeaves(document)
    .filter(({ path }) => privacyReason(document, path) === null)
    .map(({ path }) => path.join('.'));
}

// ---------------------------------------------------------------------------------------------
// 1. Validacao das fixtures v2 contra o contrato
// ---------------------------------------------------------------------------------------------

describe('fixtures v2 x profileDocumentSchema (@chameleon/contracts)', () => {
  it('ha 12 fixtures v2 e 1 legada', () => {
    expect(V2_IDS).toHaveLength(12);
    expect(listLegacyProfileIds()).toEqual([LEGACY_ID]);
  });

  it.each(V2_IDS.map((id) => [id] as const))(
    '%s valida em profileDocumentSchema (strict: sem chaves desconhecidas)',
    (id) => {
      const data = loadProfile(id);
      const result = safeParseProfileDocument(data);
      expect(result.success ? [] : result.issues, 'problemas do contrato').toEqual([]);
      expect(profileDocumentSchema.safeParse(data).success).toBe(true);
      expect(() => parseProfileDocument(data)).not.toThrow();
    },
  );

  it('o contrato esta realmente estrito: uma chave desconhecida em qualquer fixture e rejeitada com o caminho', () => {
    for (const id of V2_IDS) {
      const data = structuredClone(loadProfile(id));
      must<Rec>(data.profile as Rec).chave_desconhecida_de_teste = 'x';
      const result = safeParseProfileDocument(data);
      expect(result.success, id).toBe(false);
      if (!result.success) {
        expect(result.issues.some((i) => i.keys?.includes('chave_desconhecida_de_teste'))).toBe(
          true,
        );
      }
    }
  });

  it('as fixtures usam os nomes do contrato: nenhum nome inferido do domain-model (start/end/organization/source/...) sobrou', () => {
    const OLD_KEYS = new Set([
      'organization',
      'start',
      'end',
      'completion',
      'expected_completion',
      'metric_name',
      'metric_value',
      'calculation_method',
      'is_public_project',
      'business_name',
      'project_or_client_count',
      'client_names_disclosure',
      'exit_reason_private',
      'resume_display_title',
      'created_date',
      'overall',
      'source',
    ]);
    const found: string[] = [];
    for (const id of V2_IDS) {
      walk(loadProfile(id), ({ value, path }) => {
        if (!isRec(value)) return;
        // `meta.source` e o campo de origem do fato (valido); so `source` fora de meta e legado
        const inMeta = path[path.length - 1] === 'meta';
        for (const key of Object.keys(value)) {
          // `organization` e campo valido em voluntariado e premios; so e legado em experiencias
          const legacyOrganization = key === 'organization' && !path.includes('experiences');
          if (OLD_KEYS.has(key) && !(key === 'source' && inMeta) && !legacyOrganization) {
            found.push(`${id}: ${[...path, key].join('.')}`);
          }
        }
      });
    }
    expect(found).toEqual([]);
  });

  it('o catalogo descreve cada fixture v2 com o locale e a versao do arquivo', () => {
    for (const info of PROFILES.filter((p) => p.format === 'v2')) {
      expect((loadProfileRaw(info.id) as Rec).schema_version).toBe(info.schemaVersion);
      const doc = parseProfileDocument(loadProfile(info.id));
      expect(doc.schema_version).toBe(PROFILE_SCHEMA_VERSION);
      expect(doc.locale).toBe(info.locale);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Round-trip (A§12.4 parcial)
// ---------------------------------------------------------------------------------------------

describe('round-trip: parse -> serializar -> parse e estavel (YAML e JSON)', () => {
  it.each(V2_IDS.map((id) => [id] as const))('%s', (id) => {
    const text = loadProfileYaml(id);
    const first = loadOk(text, { format: 'yaml' });

    // carregar nao altera o conteudo: apenas a forma canonica (null/ausente equivalem)
    expect(first.document).toEqual(canonicalizeProfileDocument(loadProfile(id)));

    for (const format of ['yaml', 'json'] as const) {
      const out1 = serializeProfile(first.document, format);
      const second = loadOk(out1, { format });
      expect(second.document, `${format}: documento apos reler`).toEqual(first.document);
      const out2 = serializeProfile(second.document, format);
      expect(out2, `${format}: serializacao e ponto fixo`).toBe(out1);
      expect(out1.endsWith('\n')).toBe(true);
      expect(out1).not.toContain('\r');
    }

    // YAML -> JSON -> YAML tambem converge para o mesmo documento
    const viaJson = loadOk(serializeProfile(first.document, 'json'), { format: 'json' });
    expect(serializeProfile(viaJson.document, 'yaml')).toBe(
      serializeProfile(first.document, 'yaml'),
    );
  });

  it('a forma canonica nao emite null e preserva [] ("nenhum item"), ao contrario de omitido ("nao informado")', () => {
    const student = loadOk(loadProfileYaml('student-no-employment')).document;
    expect(student.profile.experiences).toEqual([]);
    const yaml = serializeProfile(student, 'yaml');
    expect(yaml).toMatch(/^ {2}experiences: \[\]$/m);
    for (const id of V2_IDS) {
      const out = serializeProfile(loadOk(loadProfileYaml(id)).document, 'yaml');
      expect(out, id).not.toMatch(/: null$/m);
    }
  });

  it('datas e versoes saem entre aspas no YAML (YAML 1.1 le AAAA-MM-DD como timestamp) e a precisao nunca aumenta', () => {
    const imprecise = loadOk(loadProfileYaml('imprecise-dates')).document;
    const yaml = serializeProfile(imprecise, 'yaml');
    expect(yaml).toMatch(/^schema_version: "2\.1\.0"$/m);
    const raw = loadProfile('imprecise-dates');
    const dates = (doc: unknown): string[] => {
      const out: string[] = [];
      walk(doc, ({ value, path }) => {
        const key = String(path[path.length - 1]);
        if (key.endsWith('_date') && typeof value === 'string')
          out.push(`${path.join('.')}=${value}`);
      });
      return out;
    };
    expect(dates(loadOk(yaml).document)).toEqual(dates(raw));
    // os tres graus de precisao sobrevivem
    expect(dates(raw).some((d) => /=\d{4}$/.test(d))).toBe(true);
    expect(dates(raw).some((d) => /=\d{4}-\d{2}$/.test(d))).toBe(true);
    expect(dates(raw).some((d) => /=\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });

  it('end_date "present" e start_date/end_date null sobrevivem ao round-trip com a semantica certa', () => {
    const doc = loadOk(
      serializeProfile(loadOk(loadProfileYaml('imprecise-dates')).document, 'yaml'),
    ).document;
    const exps = must(doc.profile.experiences);
    expect(exps.some((e) => e.end_date === 'present')).toBe(true);
    // null = nao informado: a forma canonica omite a chave
    expect(exps.some((e) => e.start_date === undefined)).toBe(true);
    expect(exps.some((e) => e.end_date === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Importacao: governanca, ids e reimportacao
// ---------------------------------------------------------------------------------------------

describe('importProfile: governanca (needs_review, declared_status) e ids (UUID v7)', () => {
  it.each(V2_IDS.map((id) => [id] as const))('%s', (id) => {
    const raw = parseProfileDocument(loadProfile(id));
    const result = importOk(loadProfileYaml(id));
    const rawRecords = listRecords(raw);
    const records = listRecords(result.document);
    expect(records.map((r) => r.kind)).toEqual(rawRecords.map((r) => r.kind));

    records.forEach((record, index) => {
      const source = must(rawRecords[index]);
      // 1. todo id e UUID v7 e o mapa local -> uuid esta no relatorio
      expect(record.id, record.path.join('.')).toMatch(UUID_V7);
      if (source.id !== null) expect(result.report.id_map[source.id]).toBe(record.id);

      // 2. todo fato citavel entra como needs_review e guarda o status declarado
      if (!(FACT_KINDS as readonly string[]).includes(record.kind)) return;
      const meta = isRec(record.value.meta) ? record.value.meta : {};
      const sourceMeta = isRec(source.value.meta) ? source.value.meta : {};
      if (sourceMeta.status === 'archived') {
        // ADR-0005, emenda 2.1.0: archived permanece archived e nunca entra em curriculo
        expect(meta.status, `${record.kind} ${source.id}`).toBe('archived');
        expect(meta.resume_use, `${record.kind} ${source.id}: resume_use`).toBe('never');
      } else {
        expect(meta.status, `${record.kind} ${source.id}`).toBe('needs_review');
        const declared =
          sourceMeta.declared_status ??
          (sourceMeta.status && sourceMeta.status !== 'needs_review'
            ? sourceMeta.status
            : undefined);
        expect(meta.declared_status, `${record.kind} ${source.id}: declared_status`).toBe(declared);
        expect(['allowed', 'requires_approval', 'never']).toContain(meta.resume_use);
      }
      // governanca preenchida somente quando o arquivo nao informa
      expect(meta.visibility).toBe(sourceMeta.visibility ?? meta.visibility);
      expect(['public', 'private', 'conditional']).toContain(meta.visibility);
      expect(meta.source).toBe(sourceMeta.source ?? 'profile_import');
    });

    // 3. todas as referencias foram reescritas e resolvem
    const ids = new Set(records.map((r) => r.id));
    for (const reference of listReferences(result.document)) {
      expect(reference.id, reference.path.join('.')).toMatch(UUID_V7);
      expect(ids.has(reference.id)).toBe(true);
    }
    // 4. ids locais do arquivo nao sobraram no documento
    const localIds = rawRecords.map((r) => r.id).filter((x): x is string => x !== null);
    for (const local of localIds) expect(ids.has(local)).toBe(false);
    expect(new Set(Object.values(result.report.id_map)).size).toBe(
      Object.keys(result.report.id_map).length,
    );

    // 5. o relatorio e valido contra o contrato e so usa codigos conhecidos
    expect(importReportSchema.safeParse(result.report).success).toBe(true);
    for (const code of warningCodes(result.report)) {
      expect(IMPORT_WARNING_CODES as readonly string[]).toContain(code);
    }
    // archived permanece archived: so os demais fatos contam como needs_review
    expect(result.preview.totals.needs_review).toBe(
      records.filter(
        (r) =>
          (FACT_KINDS as readonly string[]).includes(r.kind) &&
          !(isRec(r.value.meta) && r.value.meta.status === 'archived'),
      ).length,
    );
  });

  it('o status declarado diferente de needs_review (confirmed, conflicting, archived) e preservado e nunca promovido', () => {
    const seen = new Set<string>();
    for (const id of V2_IDS) {
      for (const record of listRecords(importOk(loadProfileYaml(id)).document)) {
        const meta = isRec(record.value.meta) ? record.value.meta : {};
        if (typeof meta.declared_status === 'string') seen.add(meta.declared_status);
        expect(meta.status === 'confirmed', `${id} ${record.kind}`).toBe(false);
      }
    }
    // archived NAO e rebaixado (ADR-0005, emenda 2.1.0): permanece archived com resume_use never
    expect([...seen].sort()).toEqual(['confirmed', 'conflicting']);
  });

  it('career_narrative sem visibilidade no arquivo vira private/never por padrao', () => {
    const text = `schema_version: '2.1.0'
profile:
  statements:
    - { id: S1, kind: career_narrative, text: Narrativa de teste sintetica. }
    - { id: S2, kind: short_summary, text: Resumo de teste sintetico. }
`;
    const statements = must(importOk(text).document.profile.statements);
    expect(statements[0]?.meta).toMatchObject({ visibility: 'private', resume_use: 'never' });
    expect(statements[1]?.meta).toMatchObject({ visibility: 'public', resume_use: 'allowed' });
  });

  it('a confirmacao e exclusiva do usuario: o importador nao confirma nem com meta.status confirmed no arquivo', () => {
    const text = `schema_version: '2.1.0'
profile:
  skills:
    - { id: SKL-1, name: Excel, meta: { status: confirmed } }
`;
    const skills = must(importOk(text).document.profile.skills);
    expect(skills[0]?.meta).toMatchObject({ status: 'needs_review', declared_status: 'confirmed' });
  });
});

describe('reimportacao idempotente (A§12.4, plano Fase 0)', () => {
  it.each(V2_IDS.map((id) => [id] as const))(
    '%s: reimportar o YAML/JSON exportado cria 0 registros',
    (id) => {
      const first = importOk(loadProfileYaml(id));
      for (const format of ['yaml', 'json'] as const) {
        const exported = serializeProfile(first.document, format);
        const again = importOk(exported, { format, existing: first.document });
        expect(again.preview.totals.create, `${format}: novos`).toBe(0);
        expect(again.preview.totals.update, `${format}: alterados`).toBe(0);
        expect(again.preview.totals.unchanged).toBe(listRecords(first.document).length);
        expect(again.document).toEqual(first.document);
        // ids ja eram UUID: nada a mapear e nada gerado
        expect(again.report.id_map).toEqual({});
        expect(warningCodes(again.report).has('ID_GENERATED')).toBe(false);
        expect(warningCodes(again.report).has('ID_REMAPPED')).toBe(false);
      }
    },
  );

  it.each(V2_IDS.map((id) => [id] as const))(
    '%s: reimportar o arquivo ORIGINAL com existingIdMap reaproveita os ids; so registros sem id sao novos',
    (id) => {
      const text = loadProfileYaml(id);
      const first = importOk(text);
      const again = importOk(text, {
        existing: first.document,
        existingIdMap: first.report.id_map,
      });
      const idLess = listRecords(parseProfileDocument(loadProfile(id))).filter(
        (r) => r.id === null,
      ).length;
      expect(again.preview.totals.create).toBe(idLess);
      expect(again.preview.totals.update).toBe(0);
      // todo registro que tinha id local recebe o mesmo UUID da primeira importacao
      const firstIds = listRecords(first.document).map((r) => r.id);
      const againIds = listRecords(again.document).map((r) => r.id);
      const sourceIds = listRecords(parseProfileDocument(loadProfile(id))).map((r) => r.id);
      sourceIds.forEach((sourceId, i) => {
        if (sourceId !== null) expect(againIds[i]).toBe(firstIds[i]);
      });
    },
  );

  it('SEM existingIdMap, reimportar o arquivo original gera ids novos (por isso o mapa e persistido no ImportRecord)', () => {
    const text = loadProfileYaml('conflicting-facts');
    const a = importOk(text);
    const b = importOk(text);
    const aIds = listRecords(a.document).map((r) => r.id);
    const bIds = listRecords(b.document).map((r) => r.id);
    expect(aIds.some((x, i) => x === bIds[i])).toBe(false);
  });

  it('com generateId deterministico a importacao e reprodutivel byte a byte', () => {
    const counter = (): (() => string) => {
      let n = 0;
      return () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
    };
    for (const id of V2_IDS) {
      const text = loadProfileYaml(id);
      const a = serializeProfile(importOk(text, { generateId: counter() }).document, 'yaml');
      const b = serializeProfile(importOk(text, { generateId: counter() }).document, 'yaml');
      expect(a, id).toBe(b);
    }
  });
});

describe('perfis parciais: importam sem erro e geram apenas os registros presentes', () => {
  it('minimal-partial: 1 contato + 1 experiencia, sem datas, sem texto negativo inventado', () => {
    const raw = parseProfileDocument(loadProfile('minimal-partial'));
    const result = importOk(loadProfileYaml('minimal-partial'));
    const records = listRecords(result.document);
    expect(records.map((r) => r.kind).sort()).toEqual(
      listRecords(raw)
        .map((r) => r.kind)
        .sort(),
    );
    expect(records.map((r) => r.kind)).toEqual(['contact_point', 'experience']);
    const experience = must(result.document.profile.experiences)[0];
    expect(experience?.start_date).toBeUndefined();
    expect(experience?.end_date).toBeUndefined();
    const text = JSON.stringify(result.document);
    expect(text).not.toMatch(/sem experi[eê]ncia|n[aã]o possui|nenhum/i);
  });

  it.each(['empty-profile', 'all-null-fields'] as const)(
    '%s: aceito, 0 registros, 0 pendencias de erro',
    (id) => {
      const result = importOk(loadEdgeProfileYaml(id));
      expect(listRecords(result.document)).toHaveLength(0);
      expect(result.preview.totals.records).toBe(0);
      expect(result.preview.totals.create).toBe(0);
      expect(result.report.errors).toEqual([]);
      expect(result.report.id_map).toEqual({});
      // ainda e um documento valido e serializavel
      expect(() =>
        parseProfileDocument(JSON.parse(serializeProfile(result.document, 'json'))),
      ).not.toThrow();
    },
  );

  it('all-null-fields: listas vazias continuam [] (nenhum item) e nulls viram ausencia (nao informado)', () => {
    const doc = loadOk(loadEdgeProfileYaml('all-null-fields')).document;
    expect(doc.profile.experiences).toEqual([]);
    expect(doc.profile.contact_points).toEqual([]);
    expect(doc.profile.positioning).toBeUndefined();
    expect(doc.profile.identity).toEqual({});
    expect(doc.locale).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Casos de borda x importacao (strict e lenient)
// ---------------------------------------------------------------------------------------------

describe('casos de borda: resultado esperado do catalogo x importador real', () => {
  const edges = listEdgeProfiles();

  it.each(edges.map((e) => [e.id, e.expected] as const))('%s (%s): modo strict', (id, expected) => {
    const edge = must(edges.find((e) => e.id === id));
    const result = loadProfileText(loadEdgeProfileYaml(id as EdgeProfileId), {
      format: 'yaml',
      mode: 'strict',
    });
    const haystack = result.report.errors.map((e) => `${e.path} ${e.code} ${e.message}`).join('\n');
    switch (expected) {
      case 'accepted':
        expect(result.ok).toBe(true);
        expect(result.report.errors).toEqual([]);
        expect(result.report.warnings).toEqual([]);
        break;
      case 'accepted_with_warnings':
        expect(result.ok).toBe(true);
        expect(result.report.errors).toEqual([]);
        for (const code of edge.expectedIssues)
          expect(warningCodes(result.report).has(code)).toBe(true);
        break;
      case 'rejected':
        expect(result.ok).toBe(false);
        expect(result.document).toBeNull();
        expect(result.report.errors.length).toBeGreaterThan(0);
        for (const fragment of edge.expectedIssues) {
          expect(haystack, `fragmento "${fragment}" nos erros`).toContain(fragment);
        }
        break;
      case 'yaml_syntax_error':
        expect(result.ok).toBe(false);
        expect(result.report.errors.length).toBeGreaterThan(0);
        // erro de parse, antes de qualquer validacao de contrato
        expect(result.report.errors.every((e) => e.code === 'SYNTAX')).toBe(true);
        expect(result.report.steps.map((s) => s.id)).not.toContain('validate');
        break;
    }
    // importProfile nunca devolve preview quando rejeita
    const imported = importProfile(loadEdgeProfileYaml(id as EdgeProfileId), { format: 'yaml' });
    expect(imported.ok).toBe(expected === 'accepted' || expected === 'accepted_with_warnings');
    expect(imported.preview === null).toBe(!imported.ok);
  });

  it('cada caso rejeitado tem erros com caminho (path) apontando para o problema, em ambos os modos', () => {
    for (const edge of EDGE_PROFILES.filter((e) => e.expected === 'rejected')) {
      for (const mode of ['strict', 'lenient'] as const) {
        // unknown-key e rejeitado so em strict (em lenient vira aviso)
        if (edge.id === 'unknown-key' && mode === 'lenient') continue;
        const result = loadProfileText(loadEdgeProfileYaml(edge.id), { format: 'yaml', mode });
        expect(result.ok, `${edge.id} ${mode}`).toBe(false);
        expect(
          result.report.errors.every((e) => e.path.length > 0),
          `${edge.id} ${mode}: path`,
        ).toBe(true);
      }
    }
  });

  it('lenient so relaxa chaves desconhecidas: os demais rejeitados continuam rejeitados', () => {
    for (const edge of EDGE_PROFILES.filter((e) => e.expected === 'rejected')) {
      if (edge.id === 'unknown-key') continue;
      const lenient = loadProfileText(loadEdgeProfileYaml(edge.id), {
        format: 'yaml',
        mode: 'lenient',
      });
      expect(lenient.ok, edge.id).toBe(false);
    }
  });

  it('unknown-key em modo lenient: aviso UNKNOWN_KEY_UNMAPPED e valor preservado em `unmapped` (nada se perde em silencio)', () => {
    const result = loadOk(loadEdgeProfileYaml('unknown-key'), { format: 'yaml', mode: 'lenient' });
    expect(result.report.mode).toBe('lenient');
    const warning = result.report.warnings.find((w) => w.code === 'UNKNOWN_KEY_UNMAPPED');
    expect(warning?.path).toBe('profile.typo_experinces');
    expect(result.report.unmapped).toHaveLength(1);
    expect(result.report.unmapped[0]).toMatchObject({
      path: 'profile.typo_experinces',
      value: [
        { id: 'EXP-001', organization_name: 'Empresa Fictícia Alfa', official_title: 'Analista' },
      ],
    });
    // o documento resultante e valido e nao contem a chave desconhecida
    expect(profileDocumentSchema.safeParse(result.document).success).toBe(true);
    expect(JSON.stringify(result.document)).not.toContain('typo_experinces');
    expect(result.document.profile.identity?.full_name).toBe('Ana Exemplo de Teste');
    // importProfile em lenient preserva o `unmapped` no relatorio final
    const imported = importOk(loadEdgeProfileYaml('unknown-key'), {
      format: 'yaml',
      mode: 'lenient',
    });
    expect(imported.report.unmapped).toHaveLength(1);
  });

  it('unknown-key em modo strict: erro unrecognized_keys com o caminho do objeto e a chave', () => {
    const result = loadProfileText(loadEdgeProfileYaml('unknown-key'), { format: 'yaml' });
    expect(result.report.mode).toBe('strict');
    expect(result.report.errors).toEqual([
      expect.objectContaining({ path: 'profile', code: 'unrecognized_keys' }),
    ]);
    expect(result.report.errors[0]?.message).toContain('typo_experinces');
    expect(result.report.unmapped).toEqual([]);
  });

  it('empty-strings-and-phantoms: aceito com EMPTY_STRING_NORMALIZED e EMPTY_RECORD_DROPPED; 1 experiencia, 0 formacoes, 0 competencias', () => {
    for (const mode of ['strict', 'lenient'] as const) {
      const result = loadOk(loadEdgeProfileYaml('empty-strings-and-phantoms'), {
        format: 'yaml',
        mode,
      });
      const codes = warningCodes(result.report);
      expect(codes.has('EMPTY_STRING_NORMALIZED')).toBe(true);
      expect(codes.has('EMPTY_RECORD_DROPPED')).toBe(true);
      expect(must(result.document.profile.experiences)).toHaveLength(1);
      expect(must(result.document.profile.education)).toHaveLength(0);
      expect(must(result.document.profile.skills)).toHaveLength(0);
      // "" virou ausencia e o resto do conteudo foi preservado
      const experience = must(result.document.profile.experiences)[0];
      expect(experience).toMatchObject({
        id: 'EXP-001',
        organization_name: 'Empresa Fictícia Iota',
        official_title: 'Operador',
        start_date: '2019-05',
      });
      expect(experience?.department).toBeUndefined();
      expect(experience?.end_date).toBeUndefined();
      expect(result.document.profile.identity).toEqual({ full_name: 'Bruno Exemplo Silveira' });
    }
  });

  it('o contrato rejeita "" (a normalizacao e papel do importador): a mesma fixture NAO valida direto no schema', () => {
    const direct = safeParseProfileDocument(
      parseProfileYaml(loadEdgeProfileYaml('empty-strings-and-phantoms')),
    );
    expect(direct.success).toBe(false);
  });

  it('broken-syntax: erro de parse (SYNTAX) com mensagem, sem vazar o conteudo do arquivo', () => {
    const text = loadEdgeProfileYaml('broken-syntax');
    const result = loadProfileText(text, { format: 'yaml' });
    expect(result.ok).toBe(false);
    expect(result.report.errors.length).toBeGreaterThan(0);
    for (const error of result.report.errors) {
      expect(error.code).toBe('SYNTAX');
      expect(error.message.length).toBeGreaterThan(5);
    }
    expect(result.report.source_schema_version).toBeNull();
  });

  it('empty-profile e all-null-fields: aceitos, sem avisos, 0 registros', () => {
    for (const id of ['empty-profile', 'all-null-fields'] as const) {
      const result = loadOk(loadEdgeProfileYaml(id), { format: 'yaml' });
      expect(result.report.warnings).toEqual([]);
      expect(listRecords(result.document)).toHaveLength(0);
    }
  });

  it('versao: ausente e nao suportada sao rejeitadas com codigo especifico no caminho schema_version', () => {
    const missing = loadProfileText(loadEdgeProfileYaml('missing-schema-version'), {
      format: 'yaml',
    });
    expect(missing.report.errors).toEqual([
      expect.objectContaining({ path: 'schema_version', code: 'VERSION_MISSING' }),
    ]);
    const unsupported = loadProfileText(loadEdgeProfileYaml('unsupported-schema-version'), {
      format: 'yaml',
    });
    expect(unsupported.report.errors).toEqual([
      expect.objectContaining({ path: 'schema_version', code: 'VERSION_UNSUPPORTED' }),
    ]);
  });

  it('integridade: ids duplicados e referencias pendentes citam o id/caminho exato', () => {
    const dup = loadProfileText(loadEdgeProfileYaml('duplicate-ids'), { format: 'yaml' });
    expect(dup.report.errors).toHaveLength(1);
    expect(dup.report.errors[0]).toMatchObject({ path: 'profile.experiences[1].id' });
    const dangling = loadProfileText(loadEdgeProfileYaml('dangling-references'), {
      format: 'yaml',
    });
    const byPath = new Map(dangling.report.errors.map((e) => [e.path, e.message]));
    expect(byPath.get('profile.experiences[0].meta.evidence_ids[0]')).toContain('EVD-404');
    expect(byPath.get('profile.skill_usages[0].skill_id')).toContain('SKL-404');
    expect(byPath.get('profile.evidence[0].supports[0]')).toContain('EXP-404');
    expect(byPath.get('profile.pending_items[0].target.record_id')).toContain('PRJ-404');
    expect(dangling.report.errors).toHaveLength(4);
  });

  it('ADR-0007: contexto de uso incoerente gera um erro por uso, no indice certo', () => {
    const result = loadProfileText(loadEdgeProfileYaml('incoherent-usage-context'), {
      format: 'yaml',
    });
    const paths = result.report.errors.map((e) => e.path);
    expect(paths).toEqual([
      'profile.skill_usages[0]',
      'profile.skill_usages[1].experience_id',
      'profile.skill_usages[2]',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Migracao 1.0.0 -> 2.0.0
// ---------------------------------------------------------------------------------------------

describe('legacy-1.0.0-filled x migracao v1 -> v2', () => {
  const text = loadProfileYaml(LEGACY_ID);
  const imported = importOk(text);
  const doc: ProfileDocument = imported.document;
  const profile = doc.profile;
  const records = listRecords(doc);
  const byId = new Map(records.map((r) => [r.id, r]));
  const skills = must(profile.skills);
  const usages = must(profile.skill_usages);
  const skillName = (id: string | null | undefined): string | undefined =>
    skills.find((s) => s.id === id)?.name;
  const usagesOf = (name: string) => usages.filter((u) => skillName(u.skill_id) === name);
  const SOURCE_FIELDS = [
    'experience_id',
    'project_id',
    'education_id',
    'course_id',
    'certification_id',
    'volunteering_id',
  ] as const;
  const sourceOf = (usage: Rec): string | undefined =>
    SOURCE_FIELDS.find((field) => typeof usage[field] === 'string');
  const pendingFor = (subjectPart: string) =>
    must(profile.pending_items).filter((p) => p.subject.includes(subjectPart));

  it('migra para 2.1.0 e o resultado valida em profileDocumentSchema', () => {
    expect(doc.schema_version).toBe('2.1.0');
    expect(imported.report.source_schema_version).toBe('1.0.0');
    expect(imported.report.target_schema_version).toBe('2.1.0');
    expect(imported.report.steps.map((s) => s.id)).toContain('v1_0_0_to_v2_1_0');
    expect(safeParseProfileDocument(doc).success).toBe(true);
    expect(importReportSchema.safeParse(imported.report).success).toBe(true);
  });

  it('avisos incluem EMPTY_STRING_NORMALIZED, EMPTY_RECORD_DROPPED e CONSENT_IN_FILE_NOT_RECORDED, so com codigos conhecidos', () => {
    const codes = warningCodes(imported.report);
    for (const code of [
      'EMPTY_STRING_NORMALIZED',
      'EMPTY_RECORD_DROPPED',
      'CONSENT_IN_FILE_NOT_RECORDED',
      'USAGE_CONTEXT_MAPPED',
      'USAGE_CONTEXT_UNVERIFIED',
      'PENDING_ITEM_CREATED',
      'DISCLOSURE_MAPPED',
      'RESUME_USAGE_MAPPED',
      'CLIENT_NAMES_RESTRICTION_ADDED',
      'SKILL_MERGED',
      'FIELD_MERGED',
      'RECORD_RELOCATED',
      'STATUS_SET_NEEDS_REVIEW',
      'DECLARED_STATUS_PRESERVED',
    ] as const) {
      expect(codes.has(code), code).toBe(true);
    }
    for (const code of codes) expect(IMPORT_WARNING_CODES as readonly string[]).toContain(code);
    // o registro-modelo vazio (premio so com "") foi descartado e o consentimento NAO foi aceito
    const dropped = imported.report.warnings.find((w) => w.code === 'EMPTY_RECORD_DROPPED');
    expect(dropped?.path).toBe('profile.awards[0]');
    expect(must(profile.awards ?? [])).toHaveLength(0);
    const consent = imported.report.warnings.find((w) => w.code === 'CONSENT_IN_FILE_NOT_RECORDED');
    expect(consent?.path).toBe('profile.review.processing_consent');
    expect(JSON.stringify(doc)).not.toMatch(/processing_consent|consent_notes/);
    expect(imported.report.unmapped).toEqual([]);
  });

  it('fact_status declarado vira declared_status e todo registro migrado fica needs_review', () => {
    const facts = records.filter((r) => (FACT_KINDS as readonly string[]).includes(r.kind));
    expect(facts.length).toBeGreaterThan(30);
    for (const record of facts) {
      const meta = isRec(record.value.meta) ? record.value.meta : {};
      expect(meta.status, `${record.kind} ${textOf(record.value.name ?? record.value.text)}`).toBe(
        'needs_review',
      );
    }
    const declaredOf = (name: string, key: 'name' | 'official_title' | 'institution') =>
      records.find((r) => r.value[key] === name)?.value.meta as Rec | undefined;
    expect(declaredOf('QGIS', 'name')?.declared_status).toBe('confirmed');
    expect(declaredOf('R', 'name')?.declared_status).toBe('needs_review');
    expect(declaredOf('Geoestatística', 'name')?.declared_status).toBe('confirmed');
    expect(declaredOf('Gerente Agrícola', 'official_title')?.declared_status).toBe('conflicting');
    expect(declaredOf('Extensionista Rural', 'official_title')?.declared_status).toBe('confirmed');
    expect(
      declaredOf('Universidade Estadual do Cerrado Paulista', 'institution')?.declared_status,
    ).toBe('confirmed');
    expect((must(profile.projects)[0]?.meta as Rec | undefined)?.declared_status).toBe('confirmed');
  });

  it('usage_context legado: professional/internal_project -> professional_experience; study -> self_declared_knowledge; training/other -> unverified + pendencia', () => {
    // professional
    expect(
      usagesOf('QGIS').some(
        (u) => u.usage_context === 'professional_experience' && u.experience_id,
      ),
    ).toBe(true);
    // internal_project
    expect(usagesOf('Planilhas de adubação')).toEqual([
      expect.objectContaining({ usage_context: 'professional_experience' }),
    ]);
    expect(sourceOf(usagesOf('Planilhas de adubação')[0] as Rec)).toBe('experience_id');
    // study
    expect(usagesOf('Python')).toEqual([
      expect.objectContaining({ usage_context: 'self_declared_knowledge' }),
    ]);
    // training: o treinamento nao esta cadastrado, entao nao ha fonte -> unverified + pendencia
    const gee = usagesOf('Google Earth Engine');
    expect(gee.map((u) => u.usage_context)).toEqual(['unverified']);
    const geePending = pendingFor('Google Earth Engine');
    expect(geePending).toHaveLength(1);
    expect(geePending[0]).toMatchObject({ reason: 'unclear', status: 'open' });
    expect(geePending[0]?.target?.record_id).toBe(gee[0]?.id);
    // other
    expect(usagesOf('Drones de mapeamento').map((u) => u.usage_context)).toEqual(['unverified']);
    const codes = imported.report.warnings
      .filter((w) => w.code === 'USAGE_CONTEXT_UNVERIFIED')
      .map((w) => w.path);
    expect(codes).toContain('profile.experiences[1].technologies_used[2]');
    expect(codes).toContain('profile.experiences[1].technologies_used[3]');
    // o aviso agregado conta cada contexto legado mapeado
    const mapped = imported.report.warnings
      .filter((w) => w.code === 'USAGE_CONTEXT_MAPPED' && w.path === 'profile')
      .map((w) => w.message)
      .join('\n');
    for (const legacy of ['professional', 'internal_project', 'study', 'training', 'other']) {
      expect(mapped).toContain(`"${legacy}"`);
    }
  });

  it('skills[].acquisition_contexts: employment/course/volunteer sem fonte relacionada -> unverified + pendencia; self_study -> self_declared_knowledge; com fonte -> contexto do ADR-0007', () => {
    // employment sem related_experience_ids (R): unverified + pendencia
    const r = usagesOf('R');
    expect(r.some((u) => u.usage_context === 'unverified' && sourceOf(u) === undefined)).toBe(true);
    expect(pendingFor('"R"').length).toBeGreaterThanOrEqual(1);
    // QGIS: employment + related_experience -> professional_experience; project -> project_experience
    const qgis = usagesOf('QGIS');
    expect(qgis.some((u) => u.usage_context === 'project_experience' && u.project_id)).toBe(true);
    expect(qgis.some((u) => u.usage_context === 'professional_experience' && u.experience_id)).toBe(
      true,
    );
    // Geoestatistica: course (sem curso relacionado) e volunteer (sem voluntariado relacionado) -> unverified; self_study -> self_declared
    const geo = usagesOf('Geoestatística');
    expect(geo.some((u) => u.usage_context === 'unverified')).toBe(true);
    expect(geo.some((u) => u.usage_context === 'self_declared_knowledge')).toBe(true);
    expect(pendingFor('Geoestatística').length).toBe(2);
    // ... e o voluntariado que cita a competencia (skills_demonstrated) liga um volunteer_experience com fonte
    expect(geo.some((u) => u.usage_context === 'volunteer_experience' && u.volunteering_id)).toBe(
      true,
    );
    // nenhum uso viola a coerencia contexto x fonte (o contrato ja valida; aqui por nome de campo)
    for (const usage of usages) {
      const source = sourceOf(usage);
      if (usage.usage_context === 'professional_experience') expect(source).toBe('experience_id');
      if (usage.usage_context === 'project_experience') expect(source).toBe('project_id');
      if (
        ['unverified', 'self_declared_knowledge', 'conceptual_familiarity'].includes(
          usage.usage_context,
        )
      ) {
        // sem fonte obrigatoria; se houver, o contrato aceita qualquer uma
        expect(SOURCE_FIELDS.filter((f) => usage[f]).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('disclosure: approved -> allowed; restricted -> requires_approval; not_approved -> never; not_confirmed -> requires_approval', () => {
    const use = (record: Rec | undefined): unknown => (record?.meta as Rec | undefined)?.resume_use;
    const items = records.filter((r) => r.kind === 'experience_item').map((r) => r.value);
    const item = (start: string) => items.find((i) => textOf(i.text).startsWith(start));
    expect(use(item('Redução do consumo de fertilizante'))).toBe('requires_approval'); // restricted
    expect(use(item('Rotina de limpeza de dados de colhedora'))).toBe('requires_approval'); // not_confirmed
    expect(use(item('Implantação de amostragem'))).toBe('allowed'); // approved
    expect(use(must(profile.projects)[0] as Rec)).toBe('never'); // not_approved
    const projectItems = records.filter((r) => r.kind === 'project_item').map((r) => r.value);
    expect(
      use(projectItems.find((i) => textOf(i.text).startsWith('Redução de fertilizante'))),
    ).toBe('requires_approval'); // restricted
    expect(use(must(profile.volunteering)[0] as Rec)).toBe('allowed'); // approved
    const messages = imported.report.warnings
      .filter((w) => w.code === 'DISCLOSURE_MAPPED')
      .map((w) => w.message)
      .join('\n');
    for (const value of ['approved', 'restricted', 'not_approved', 'not_confirmed']) {
      expect(messages).toContain(`"${value}"`);
    }
    // resume_usage / include_in_resume: include -> allowed; depending_on_job -> requires_approval; exclude -> never
    const language = (name: string) => must(profile.languages).find((l) => l.language === name);
    expect(language('Português')?.meta?.resume_use).toBe('allowed');
    expect(language('Espanhol')?.meta?.resume_use).toBe('requires_approval');
    const skill = (name: string) => skills.find((s) => s.name === name);
    expect(skill('QGIS')?.meta?.resume_use).toBe('allowed');
    expect(skill('R')?.meta?.resume_use).toBe('requires_approval');
    expect(skill('Geoestatística')?.meta?.resume_use).toBe('never');
  });

  it('usage_rules em texto livre viram restrictions com target.term; freelance_and_business vira experiencia freelance com business e restricao never_include em organization_name', () => {
    const restrictions = must(profile.usage_rules?.restrictions);
    const byRule = (rule: string) => restrictions.filter((r) => r.rule === rule);
    const terms = (rule: string) => byRule(rule).map((r) => r.target.term);
    expect(terms('never_include').some((t) => t?.includes('Fazenda Experimental Três Rios'))).toBe(
      true,
    );
    expect(terms('never_include')).toContain('Clientes da consultoria própria');
    expect(terms('never_include')).toContain('Relatórios técnicos');
    expect(terms('require_approval')).toContain('Consultorias no Paraguai');
    expect(terms('private_guidance_only').some((t) => t?.includes('Quero migrar para dados'))).toBe(
      true,
    );
    for (const restriction of restrictions) {
      expect(Boolean(restriction.target.term ?? restriction.target.record_id)).toBe(true);
    }

    const freelance = must(profile.experiences).find((e) => e.employment_type === 'freelance');
    expect(freelance).toMatchObject({
      organization_name: 'Vale Ortiz Consultoria Agronômica',
      business: {
        activity: 'Consultoria de agricultura de precisão para produtores',
        client_count: 9,
      },
    });
    expect(freelance?.business?.services_scope).toEqual([
      'amostragem de solo',
      'mapas de fertilidade',
    ]);
    // client_names_disclosure not_approved -> restricao never_include sobre organization_name da experiencia
    const clientRestriction = restrictions.find((r) => r.target.record_id === freelance?.id);
    expect(clientRestriction).toMatchObject({
      rule: 'never_include',
      target: { record_id: freelance?.id, field: 'organization_name' },
    });
    expect(byId.get(freelance?.id ?? null)?.kind).toBe('experience');
    expect(JSON.stringify(freelance)).not.toContain('client_names_disclosure');
    // as ferramentas do negocio autonomo viram usos profissionais ligados a essa experiencia
    expect(
      usages
        .filter((u) => u.experience_id === freelance?.id)
        .map((u) => skillName(u.skill_id))
        .sort(),
    ).toEqual(['QGIS', 'R']);
  });

  it('developing_knowledge vira skills + skill_usages: conceptual_familiarity (ou self_declared_knowledge com practical_project) e resume_use requires_approval', () => {
    const sensoriamento = 'Sensoriamento remoto com Google Earth Engine';
    const ml = 'Aprendizado de máquina para previsão de produtividade';
    expect(usagesOf(sensoriamento)).toEqual([
      expect.objectContaining({ usage_context: 'conceptual_familiarity' }),
    ]);
    expect(usagesOf(ml)).toEqual([
      expect.objectContaining({ usage_context: 'self_declared_knowledge' }),
    ]);
    for (const name of [sensoriamento, ml]) {
      expect(usagesOf(name)[0]?.meta?.resume_use, name).toBe('requires_approval');
      expect(skills.find((s) => s.name === name)?.meta?.resume_use, name).toBe('requires_approval');
      expect(skills.find((s) => s.name === name)?.study_plan, name).toBeDefined();
    }
    expect(skills.find((s) => s.name === ml)?.study_plan?.practical_project).toContain('Notebook');
  });

  it('os canarios privados do legado sobrevivem ao documento migrado apenas em campos privados (segundo o contrato)', () => {
    const expected = [...listProfileCanaries(LEGACY_ID)];
    expect([...expected].sort()).toEqual(
      [
        'pronouns',
        'exit_reason',
        'salary_notes',
        'link_notes',
        'career_narrative',
        'never_term',
        'guidance',
      ]
        .map((f) => `CANARY-legacy-100-filled-${f}`)
        .sort(),
    );
    const survived = new Set(
      canaryLeaves(doc).flatMap((leaf) => leaf.value.match(CANARY_TOKEN) ?? []),
    );
    expect([...survived].sort()).toEqual([...expected].sort());
    expect(leaks(doc)).toEqual([]);
    // onde cada um foi parar
    const reasons = new Map(
      canaryLeaves(doc).map((leaf) => [
        CANARY_ONE.exec(leaf.value)?.[0],
        privacyReason(doc, leaf.path),
      ]),
    );
    expect(reasons.get('CANARY-legacy-100-filled-pronouns')).toBe('identity.pronouns');
    expect(reasons.get('CANARY-legacy-100-filled-exit_reason')).toBe('experiences[].exit_reason');
    expect(reasons.get('CANARY-legacy-100-filled-salary_notes')).toBe(
      'bloco privado: availability_preferences',
    );
    expect(reasons.get('CANARY-legacy-100-filled-never_term')).toBe('bloco privado: usage_rules');
    expect(reasons.get('CANARY-legacy-100-filled-guidance')).toBe('bloco privado: usage_rules');
    expect(reasons.get('CANARY-legacy-100-filled-career_narrative')).toMatch(
      /statement: meta\.visibility=private/,
    );
    expect(reasons.get('CANARY-legacy-100-filled-link_notes')).toMatch(/^contact_point:/);
  });

  it('migrar o mesmo arquivo duas vezes produz o mesmo documento (determinismo, exceto UUIDs)', () => {
    const a = loadOk(text);
    const b = loadOk(text);
    expect(b.document).toEqual(a.document);
    expect(b.report.warnings).toEqual(a.report.warnings);
    expect(b.report.steps).toEqual(a.report.steps);
    // com ids injetados tambem e identico byte a byte
    const counter = (): (() => string) => {
      let n = 0;
      return () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
    };
    const x = serializeProfile(importOk(text, { generateId: counter() }).document, 'yaml');
    const y = serializeProfile(importOk(text, { generateId: counter() }).document, 'yaml');
    expect(y).toBe(x);
    // e via API direta da cadeia de migracao
    const raw = loadProfile(LEGACY_ID);
    const r1 = migrateLegacyToCurrent(raw, new ReportBuilder());
    const r2 = migrateLegacyToCurrent(raw, new ReportBuilder());
    expect(r1.ok && r2.ok).toBe(true);
    expect(r2).toEqual(r1);
  });

  it('a migracao nao altera o arquivo de origem e o documento exportado reimporta com 0 registros novos', () => {
    const raw = loadProfile(LEGACY_ID);
    const snapshot = structuredClone(raw);
    migrateLegacyToCurrent(raw, new ReportBuilder());
    expect(raw).toEqual(snapshot);
    const exported = serializeProfile(doc, 'yaml');
    const again = importOk(exported, { existing: doc });
    expect(again.preview.totals.create).toBe(0);
    expect(again.document).toEqual(doc);
    expect(again.report.source_schema_version).toBe('2.1.0');
  });

  it('a migracao e o round-trip YAML/JSON do documento migrado sao estaveis', () => {
    for (const format of ['yaml', 'json'] as const) {
      const out = serializeProfile(doc, format);
      expect(loadOk(out, { format }).document).toEqual(doc);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Vazamento de canarios (por ora: classificacao pelo contrato; o documento publico derivado vem nas fases seguintes)
// ---------------------------------------------------------------------------------------------

describe('vazamento: canarios so residem em campos privados segundo o contrato', () => {
  it('private-heavy: cada canario esta em campo privado/condicional/never/requires_approval/archived (listRecords/meta, sem heuristica de nome)', () => {
    const raw = parseProfileDocument(loadProfile('private-heavy'));
    const canaries = listProfileCanaries('private-heavy');
    const leaves = canaryLeaves(raw);
    // todo canario do arquivo foi localizado (nenhum se perdeu no parse) e nenhum esta fora de campo privado
    const found = new Set(leaves.flatMap((l) => l.value.match(/CANARY-[A-Za-z0-9_-]+/g) ?? []));
    expect([...found].sort()).toEqual([...canaries].sort());
    expect(leaks(raw)).toEqual([]);

    const reasonOf = (field: string): string | null => {
      const leaf = leaves.find((l) => l.value.includes(`CANARY-private-heavy-${field}`));
      return leaf ? privacyReason(raw, leaf.path) : 'NAO ENCONTRADO';
    };
    expect(reasonOf('pronouns')).toBe('identity.pronouns');
    expect(reasonOf('exit_reason')).toBe('experiences[].exit_reason');
    expect(reasonOf('private_note_1')).toBe('meta.private_notes');
    expect(reasonOf('salary_notes')).toBe('bloco privado: availability_preferences');
    expect(reasonOf('deal_breaker')).toBe('bloco privado: availability_preferences');
    expect(reasonOf('excluded_industry')).toBe('bloco privado: career_preferences');
    expect(reasonOf('restricted_term')).toBe('bloco privado: usage_rules');
    expect(reasonOf('contact_private_label')).toBe('contact_point: contact.visibility=private');
    expect(reasonOf('contact_conditional_label')).toBe(
      'contact_point: contact.visibility=conditional',
    );
    expect(reasonOf('career_narrative')).toBe('statement: meta.visibility=private');
    expect(reasonOf('conditional_statement')).toBe('statement: meta.visibility=conditional');
    expect(reasonOf('never_org')).toBe('experience: meta.visibility=private');
    expect(reasonOf('never_item')).toBe('experience: meta.visibility=private'); // herda do vinculo omitido
    expect(reasonOf('conditional_item')).toBe('experience_item: meta.visibility=conditional');
    expect(reasonOf('archived_item')).toBe('experience_item: archived');
    expect(reasonOf('private_project')).toBe('meta.private_notes');
    expect(reasonOf('project_private_item')).toBe('project: meta.visibility=private');
    expect(reasonOf('never_skill')).toBe('skill: meta.visibility=private');
    expect(reasonOf('evidence_location')).toBe('evidence: evidence.is_public=false');
  });

  it.each(V2_IDS.map((id) => [id] as const))(
    '%s: nenhum canario fora de campo privado (documento validado e documento importado)',
    (id) => {
      const raw = parseProfileDocument(loadProfile(id));
      expect(leaks(raw)).toEqual([]);
      expect(canaryLeaves(raw).length).toBeGreaterThanOrEqual(listProfileCanaries(id).length);
      const imported = importOk(loadProfileYaml(id)).document;
      expect(leaks(imported)).toEqual([]);
      // a importacao nao move nem copia canario para outro lugar
      const count = (d: unknown): number => canaryLeaves(d).length;
      expect(count(imported)).toBe(count(raw));
    },
  );

  it('o detector de vazamento funciona (autoteste): canario em campo publico e apontado', () => {
    const document = {
      schema_version: '2.1.0',
      profile: {
        identity: { full_name: 'X', pronouns: 'CANARY-x-pronouns' },
        statements: [
          {
            id: 'S1',
            kind: 'short_summary',
            text: 'CANARY-x-public',
            meta: { visibility: 'public', resume_use: 'allowed' },
          },
          {
            id: 'S2',
            kind: 'short_summary',
            text: 'CANARY-x-never',
            meta: { visibility: 'public', resume_use: 'never' },
          },
        ],
        experiences: [{ id: 'E1', official_title: 'Cargo', exit_reason: 'CANARY-x-exit' }],
        availability_preferences: { start_availability: 'CANARY-x-avail' },
      },
    };
    expect(leaks(document)).toEqual(['profile.statements.0.text']);
    // sem meta algum: nao ha como afirmar que e privado
    expect(
      leaks({
        schema_version: '2.1.0',
        profile: { statements: [{ id: 'S', kind: 'value', text: 'CANARY-y-a' }] },
      }),
    ).toEqual(['profile.statements.0.text']);
  });

  it('a importacao MANTEM "archived" (ADR-0005, emenda 2.1.0): o item arquivado sai archived com resume_use never', () => {
    const result = importOk(loadProfileYaml('private-heavy'));
    const item = records(result.document).find((r) =>
      textOf(r.value.text).includes('CANARY-private-heavy-archived_item'),
    );
    expect(item?.value.meta).toMatchObject({ status: 'archived', resume_use: 'never' });
    expect(warningCodes(result.report).has('ARCHIVED_STATUS_KEPT')).toBe(true);
    // conflicting continua virando needs_review com declared_status preservado
    const conflicting = importOk(loadProfileYaml('conflicting-facts')).document;
    const declared = records(conflicting)
      .map((r) => (isRec(r.value.meta) ? r.value.meta : {}))
      .filter((meta) => meta.declared_status === 'conflicting');
    expect(declared.length).toBeGreaterThan(0);
    for (const meta of declared) expect(meta.status).toBe('needs_review');
  });

  it('o JSON Schema gerado nao contem nenhum canario (nem valores de fixtures)', () => {
    const schema = JSON.stringify(buildProfileJsonSchema());
    for (const id of V2_IDS) {
      for (const canary of listProfileCanaries(id)) expect(schema).not.toContain(canary);
    }
  });

  it('mensagens de erro de validacao nao ecoam valores: canario trocado por tipo errado ou ao lado de chave desconhecida nao vaza', () => {
    for (const id of V2_IDS) {
      const data = loadProfile(id);
      for (const leaf of canaryLeaves(data)) {
        // (a) valor do canario substituido por um numero -> erro de tipo, que nao deve citar o valor
        const mutated = structuredClone(data);
        let cursor: unknown = mutated;
        for (const part of leaf.path.slice(0, -1))
          cursor = (cursor as Record<PathPart, unknown>)[part];
        (cursor as Record<PathPart, unknown>)[must(leaf.path[leaf.path.length - 1])] = 12345;
        const result = safeParseProfileDocument(mutated);
        const messages = JSON.stringify(result);
        // erros de tipo; o texto de outros canarios do documento tambem nao aparece
        expect(messages, `${id} ${leaf.path.join('.')}`).not.toContain('CANARY-');
      }
      // (b) chave desconhecida cujo VALOR e canario: a mensagem cita a chave, nunca o valor
      const withUnknown = structuredClone(data);
      (withUnknown.profile as Rec).chave_extra = 'CANARY-extra-valor';
      const strict = loadProfileText(withUnknown, { mode: 'strict' });
      expect(strict.ok).toBe(false);
      expect(JSON.stringify(strict.report.errors)).not.toContain('CANARY-');
    }
  });
});

/** Alias local para `listRecords` (evita colisao com variaveis `records` nos testes). */
function records(document: unknown) {
  return listRecords(document);
}
