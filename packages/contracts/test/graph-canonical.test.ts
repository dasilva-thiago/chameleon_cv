import { describe, expect, it } from 'vitest';
import {
  canonicalizeProfileDocument,
  cloneJson,
  isBlankValue,
  listContractPaths,
  listRecords,
  listReferences,
  listSchemaPaths,
  normalizeTerm,
  parseProfileDocument,
  profileDocumentSchema,
  recordFieldNames,
  remapIds,
  safeParseProfileDocument,
  type ProfileDocument,
  singletonFieldNames,
} from '../src/index';
import { doc } from './helpers';

const sample = () =>
  doc({
    skills: [{ id: 'S1', name: 'Habilidade' }],
    experiences: [
      {
        id: 'E1',
        organization_name: 'Org',
        items: [
          { id: 'I1', kind: 'responsibility', text: 'texto', meta: { evidence_ids: ['V1'] } },
        ],
        meta: { evidence_ids: ['V1'] },
      },
    ],
    projects: [
      {
        id: 'P1',
        name: 'Proj',
        related_experience_id: 'E1',
        collaborators: [{ id: 'C1', name_or_role: 'x' }],
      },
    ],
    skill_usages: [
      { id: 'U1', skill_id: 'S1', usage_context: 'professional_experience', experience_id: 'E1' },
    ],
    evidence: [{ id: 'V1', type: 'document', supports: ['E1', 'I1'] }],
    pending_items: [{ id: 'N1', subject: 'x', target: { record_id: 'E1', field: 'start_date' } }],
    usage_rules: {
      restrictions: [{ id: 'R1', target: { record_id: 'E1' }, rule: 'never_include' }],
    },
    resume_preferences: { older_experience_ids: ['E1'], highlight_record_ids: ['P1'] },
  });

describe('grafo de registros', () => {
  it('lista registros (incluindo sub-itens, colaboradores e restricoes) em ordem de documento', () => {
    const records = listRecords(sample());
    expect(records.map((r) => `${r.kind}:${r.id}`)).toEqual([
      'experience:E1',
      'experience_item:I1',
      'project:P1',
      'collaborator:C1',
      'skill:S1',
      'skill_usage:U1',
      'evidence:V1',
      'pending_item:N1',
      'restriction:R1',
    ]);
    expect(records[1]?.path).toEqual(['profile', 'experiences', 0, 'items', 0]);
  });

  it('lista referencias com tipos de alvo e caminhos', () => {
    const refs = listReferences(sample());
    const byPath = new Map(refs.map((r) => [r.path.join('.'), r]));
    expect(byPath.get('profile.experiences.0.meta.evidence_ids.0')?.targets).toEqual(['evidence']);
    expect(byPath.get('profile.projects.0.related_experience_id')?.targets).toEqual(['experience']);
    expect(byPath.get('profile.skill_usages.0.skill_id')?.id).toBe('S1');
    expect(byPath.get('profile.evidence.0.supports.1')?.id).toBe('I1');
    expect(byPath.get('profile.pending_items.0.target.record_id')?.id).toBe('E1');
    expect(byPath.get('profile.usage_rules.restrictions.0.target.record_id')?.id).toBe('E1');
    expect(byPath.get('profile.resume_preferences.highlight_record_ids.0')?.targets).toEqual([
      'experience',
      'project',
    ]);
    expect(refs.length).toBe(11);
  });

  it('funcoes sao defensivas com dados nao validados', () => {
    expect(listRecords(null)).toEqual([]);
    expect(
      listRecords({ profile: { experiences: 'x', skills: [null, 5, { id: 3 }] } }).length,
    ).toBe(1);
    expect(listReferences({ profile: { evidence: [{ supports: 'x' }] } })).toEqual([]);
  });

  it('remapIds reescreve ids e TODAS as referencias, sem alterar o original', () => {
    const original = sample();
    const frozen = cloneJson(original);
    const mapped = remapIds(original, (id, kind) => `${kind}/${id.toLowerCase()}`);
    expect(original).toEqual(frozen);
    const profile = (mapped as ProfileDocument).profile;
    expect(profile.experiences?.[0]?.id).toBe('experience/e1');
    expect(profile.experiences?.[0]?.items?.[0]?.id).toBe('experience_item/i1');
    expect(profile.experiences?.[0]?.meta?.evidence_ids).toEqual(['evidence/v1']);
    expect(profile.projects?.[0]?.related_experience_id).toBe('experience/e1');
    expect(profile.skill_usages?.[0]?.skill_id).toBe('skill/s1');
    expect(profile.evidence?.[0]?.supports).toEqual(['experience/e1', 'experience_item/i1']);
    expect(profile.pending_items?.[0]?.target).toEqual({
      record_id: 'experience/e1',
      field: 'start_date',
    });
    expect(profile.resume_preferences?.highlight_record_ids).toEqual(['project/p1']);
    // o documento reescrito continua com integridade (ids novos tambem sao validos se passarem pelo formato)
    const safe = remapIds(original, (id) => `x-${id}`);
    expect(safeParseProfileDocument(safe).success).toBe(true);
  });

  it('remapIds mantem referencias pendentes como estao (a validacao as reporta)', () => {
    const broken = doc({ projects: [{ id: 'P', name: 'x', related_experience_id: 'NADA' }] });
    const mapped = remapIds(broken, (id) => `n-${id}`);
    expect((mapped as ProfileDocument).profile.projects?.[0]?.related_experience_id).toBe('NADA');
  });
});

describe('forma canonica', () => {
  it('ordena chaves pelo schema e remove nulls, preservando [] e a ordem dos arrays', () => {
    const messy = {
      profile: {
        skills: [
          { meta: { status: 'confirmed', source: null }, name: 'B', category: null },
          { name: 'A' },
        ],
        identity: { city: 'X', full_name: 'Ana', pronouns: null },
        experiences: [],
        review: null,
      },
      locale: 'pt-BR',
      schema_version: '2.1.0',
    };
    const canonical = canonicalizeProfileDocument(messy);
    expect(Object.keys(canonical)).toEqual(['schema_version', 'locale', 'profile']);
    expect(Object.keys(canonical.profile)).toEqual(['identity', 'experiences', 'skills']);
    expect(Object.keys((canonical as ProfileDocument).profile.identity ?? {})).toEqual([
      'full_name',
      'city',
    ]);
    expect((canonical as ProfileDocument).profile.skills).toEqual([
      { name: 'B', meta: { status: 'confirmed' } },
      { name: 'A' },
    ]);
    expect((canonical as ProfileDocument).profile.experiences).toEqual([]);
    expect(canonicalizeProfileDocument(canonical)).toEqual(canonical); // idempotente
  });

  it('o resultado continua valido', () => {
    expect(parseProfileDocument(canonicalizeProfileDocument(sample()))).toBeTruthy();
    expect(profileDocumentSchema.safeParse(canonicalizeProfileDocument(sample())).success).toBe(
      true,
    );
  });
});

describe('introspecao de caminhos', () => {
  it('lista folhas e conteineres do contrato', () => {
    const listing = listSchemaPaths(profileDocumentSchema);
    const leaves = new Set(listing.leaves.map((leaf) => leaf.path));
    expect(leaves.has('profile.experiences[].items[].metric.name')).toBe(true);
    expect(leaves.has('profile.identity.countries_of_work_interest')).toBe(true); // lista de escalares = folha
    expect(leaves.has('profile.experiences[].meta.field_states')).toBe(true); // record = folha
    expect(leaves.has('profile.experiences')).toBe(false);
    expect(
      listing.containers.some((c) => c.path === 'profile.experiences[]' && c.type === 'array'),
    ).toBe(true);
    expect(
      listing.containers.some(
        (c) => c.path === 'profile.experiences[].location' && c.type === 'object',
      ),
    ).toBe(true);
    const enumLeaf = listing.leaves.find(
      (leaf) => leaf.path === 'profile.experiences[].employment_type',
    );
    expect(enumLeaf?.enumValues).toContain('freelance');
    expect(listContractPaths().length).toBe(listing.leaves.length);
  });

  it('campos planos de registro (para target.field e field_states)', () => {
    const names = recordFieldNames(profileDocumentSchema.shape.profile.shape.experiences);
    void names; // colecao nao e registro: apenas garante que nao lanca
    expect(singletonFieldNames().has('identity.pronouns')).toBe(true);
    expect(singletonFieldNames().has('availability_preferences.salary_expectation.amount')).toBe(
      true,
    );
    expect(singletonFieldNames().has('identity.field_states')).toBe(false);
    expect(singletonFieldNames().has('experiences.start_date')).toBe(false);
  });
});

describe('utilitarios comuns', () => {
  it('normalizeTerm e isBlankValue', () => {
    expect(normalizeTerm('  Ação   Rápida ')).toBe('acao rapida');
    expect(isBlankValue({ a: [null, ''] })).toBe(true);
    expect(isBlankValue({ a: [0] })).toBe(false);
  });
});
