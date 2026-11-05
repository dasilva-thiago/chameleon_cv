import {
  ANALYSIS_LIMITS,
  type AnalysisResult,
  type EvidenceRef,
  type JobRequirement,
  type MatchStrength,
  type PrioritizedRecord,
  type ProfileDocument,
  type RecordKind,
  type RequirementMatch,
} from '@chameleon/contracts';
import { EXTRACTOR_VERSION, extractRequirements, looksLikeInstructions } from './requirements';
import { buildMatchIndex, type IndexedFact, type MatchIndex } from './profile-index';
import { containsPhrase, haystackOf, termInText, tokenize } from './text';

/** Versao do conjunto extrator + matcher: muda quando o resultado para a mesma entrada pode mudar. */
export const MATCHER_VERSION = `${EXTRACTOR_VERSION}.match-1`;

type Level = 'direct' | 'partial';

const STRENGTH_RANK: Record<MatchStrength, number> = {
  direct: 0,
  partial: 1,
  transferable: 2,
  pending: 3,
  absent: 4,
};

const IMPORTANCE_WEIGHT = { mandatory: 3, responsibility: 2, desirable: 1 } as const;

const CONTEXT_LEVEL: Record<string, Level> = {
  professional_experience: 'direct',
};

const CONTEXT_CAUTION: Record<string, string> = {
  project_experience: 'Evidência de projeto, não de emprego: descreva como projeto.',
  volunteer_experience: 'Evidência de voluntariado: descreva como tal.',
  coursework: 'Evidência de estudo/curso: não apresente como experiência profissional.',
  certification: 'Evidência de certificação: não apresente como experiência profissional.',
  self_declared_knowledge:
    'Apenas declarado por você, sem experiência registrada: use com cuidado.',
  conceptual_familiarity: 'Familiaridade conceitual: não afirme domínio prático.',
  unverified: 'Contexto de uso não verificado: confirme antes de usar.',
};

const KIND_CAUTION: Partial<Record<RecordKind, string>> = {
  project: CONTEXT_CAUTION.project_experience!,
  project_item: CONTEXT_CAUTION.project_experience!,
  volunteering: CONTEXT_CAUTION.volunteer_experience!,
  course: CONTEXT_CAUTION.coursework!,
  education: CONTEXT_CAUTION.coursework!,
  certification: CONTEXT_CAUTION.certification!,
};

/** Tipos de registro com texto proprio que podem mencionar um requisito, e o nivel da evidencia. */
const TEXT_KIND_LEVEL: Partial<Record<RecordKind, Level>> = {
  experience: 'direct',
  experience_item: 'direct',
  language: 'direct',
  competency_example: 'partial',
  project: 'partial',
  project_item: 'partial',
  education: 'partial',
  course: 'partial',
  certification: 'partial',
  award: 'partial',
  publication: 'partial',
  volunteering: 'partial',
};

const KIND_NOUN: Partial<Record<RecordKind, string>> = {
  experience: 'experiência profissional',
  experience_item: 'experiência profissional',
  language: 'idioma',
  competency_example: 'exemplo de competência',
  project: 'projeto',
  project_item: 'projeto',
  education: 'formação',
  course: 'curso',
  certification: 'certificação',
  award: 'prêmio',
  publication: 'publicação',
  volunteering: 'voluntariado',
};

/**
 * Familias de tecnologias parecidas (heuristica generica, nao dado pessoal). Servem so para sugerir
 * "transferivel", sempre com cautela e revisao.
 */
const RELATED_GROUPS: readonly (readonly string[])[] = [
  ['postgresql', 'mysql', 'mariadb', 'sql server', 'oracle', 'sqlite'],
  ['mongodb', 'dynamodb', 'couchdb', 'cassandra'],
  ['react', 'vue', 'angular', 'svelte'],
  ['node', 'express', 'nestjs', 'fastify'],
  ['java', 'kotlin', 'scala'],
  ['django', 'flask', 'fastapi'],
  ['aws', 'azure', 'gcp', 'google cloud'],
  ['terraform', 'pulumi', 'cloudformation'],
  ['github actions', 'gitlab ci', 'jenkins', 'circleci'],
  ['jest', 'vitest', 'mocha', 'junit', 'pytest'],
  ['power bi', 'tableau', 'looker'],
  ['excel', 'google sheets'],
];

interface Candidate {
  fact: IndexedFact;
  level: Level;
  via: 'skill' | 'record_text';
  context: string | null;
  supportingRecordId: string | null;
  matchedTerms: string[];
  cautions: string[];
}

const dedupe = (items: readonly string[]): string[] => [...new Set(items)];

function skillCandidates(
  index: MatchIndex,
  requirement: JobRequirement,
  haystack: string,
): { usable: Candidate[]; pending: Candidate[] } {
  const usable: Candidate[] = [];
  const pending: Candidate[] = [];
  for (const skill of index.skills) {
    if (!skill.usable && !skill.pending) continue;
    const matchedTerms = skill.names.filter((name) => termInText(requirement.text, haystack, name));
    if (matchedTerms.length === 0) continue;
    const cautions: string[] = skill.requiresApproval
      ? ['O uso deste item em currículos exige a sua aprovação.']
      : [];

    if (!skill.usable) {
      pending.push({
        fact: skill,
        level: 'partial',
        via: 'skill',
        context: null,
        supportingRecordId: null,
        matchedTerms,
        cautions: ['A habilidade ainda aguarda a sua confirmação.', ...cautions],
      });
      continue;
    }

    const usages = index.usagesBySkill.get(skill.id) ?? [];
    const usableUsages = usages.filter((usage) => usage.usable);
    const best =
      usableUsages.find((usage) => CONTEXT_LEVEL[usage.context] === 'direct') ?? usableUsages[0];
    if (best === undefined) {
      usable.push({
        fact: skill,
        level: 'partial',
        via: 'skill',
        context: null,
        supportingRecordId: null,
        matchedTerms,
        cautions: [
          usages.length > 0
            ? 'O uso desta habilidade aguarda confirmação: o contexto ainda não vale como evidência.'
            : 'Habilidade confirmada, mas sem contexto de uso registrado.',
          ...cautions,
        ],
      });
      continue;
    }
    const level: Level = CONTEXT_LEVEL[best.context] ?? 'partial';
    const contextCaution = CONTEXT_CAUTION[best.context];
    const candidate: Candidate = {
      fact: skill,
      level,
      via: 'skill',
      context: best.context,
      supportingRecordId: best.usageId,
      matchedTerms,
      cautions: [...(contextCaution !== undefined ? [contextCaution] : []), ...cautions],
    };
    usable.push(candidate);
    // A experiencia/projeto onde a habilidade foi usada tambem sustenta o requisito.
    const source = best.sourceId !== null ? index.byId.get(best.sourceId) : undefined;
    if (source?.usable === true) {
      usable.push({
        fact: source,
        level,
        via: 'skill',
        context: best.context,
        supportingRecordId: best.usageId,
        matchedTerms,
        cautions: source.requiresApproval
          ? ['O uso deste item em currículos exige a sua aprovação.']
          : [],
      });
    }
  }
  return { usable, pending };
}

function textCandidates(
  index: MatchIndex,
  requirement: JobRequirement,
  haystack: string,
): { usable: Candidate[]; pending: Candidate[] } {
  const usable: Candidate[] = [];
  const pending: Candidate[] = [];
  const keywords = requirement.keywords.filter((keyword) => keyword.length > 2);
  for (const fact of index.facts) {
    const level = TEXT_KIND_LEVEL[fact.kind];
    if (level === undefined || (!fact.usable && !fact.pending)) continue;
    const byName = fact.names.filter(
      (name) => name.length > 2 && termInText(requirement.text, haystack, name),
    );
    const byKeyword = keywords.filter((keyword) => containsPhrase(fact.haystack, keyword));
    const matchedTerms = dedupe([...byName, ...byKeyword]).slice(
      0,
      ANALYSIS_LIMITS.keywordsPerRequirement,
    );
    if (matchedTerms.length === 0) continue;
    const kindCaution = KIND_CAUTION[fact.kind];
    const cautions = [
      ...(kindCaution !== undefined ? [kindCaution] : []),
      ...(fact.kind === 'language'
        ? ['Confira se o seu nível no idioma atende ao que a vaga pede.']
        : []),
      ...(fact.requiresApproval ? ['O uso deste item em currículos exige a sua aprovação.'] : []),
      ...(!fact.usable ? ['O item ainda aguarda a sua confirmação.'] : []),
    ];
    (fact.usable ? usable : pending).push({
      fact,
      level,
      via: 'record_text',
      context: null,
      supportingRecordId: null,
      matchedTerms,
      cautions,
    });
  }
  return { usable, pending };
}

function transferableCandidates(
  index: MatchIndex,
  requirement: JobRequirement,
  haystack: string,
): Candidate[] {
  const out: Candidate[] = [];
  for (const group of RELATED_GROUPS) {
    const wanted = group.filter((term) => termInText(requirement.text, haystack, term));
    if (wanted.length === 0) continue;
    for (const skill of index.skills) {
      if (!skill.usable) continue;
      const own = skill.names.map((name) => tokenize(name).join(' '));
      const related = group.filter((term) => own.includes(tokenize(term).join(' ')));
      if (related.length === 0 || related.some((term) => wanted.includes(term))) continue;
      out.push({
        fact: skill,
        level: 'partial',
        via: 'skill',
        context: null,
        supportingRecordId: null,
        matchedTerms: wanted,
        cautions: [
          `Você registra ${related.join(', ')}, da mesma família de ${wanted.join(', ')} (sugestão automática): avalie se serve e diga o que muda.`,
        ],
      });
    }
  }
  return out;
}

const toEvidence = (candidate: Candidate): EvidenceRef => ({
  recordId: candidate.fact.id,
  kind: candidate.fact.kind,
  label: candidate.fact.label,
  via: candidate.via,
  context: candidate.context as EvidenceRef['context'],
  supportingRecordId: candidate.supportingRecordId,
  status: candidate.fact.status,
  matchedTerms: candidate.matchedTerms.slice(0, ANALYSIS_LIMITS.keywordsPerRequirement),
});

function sortCandidates(candidates: Candidate[]): Candidate[] {
  const order = (c: Candidate): number => (c.level === 'direct' ? 0 : 1);
  return [...candidates].sort(
    (a, b) => order(a) - order(b) || a.fact.label.localeCompare(b.fact.label, 'pt-BR'),
  );
}

function uniqueByFact(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.fact.id)) return false;
    seen.add(candidate.fact.id);
    return true;
  });
}

function matchRequirement(index: MatchIndex, requirement: JobRequirement): RequirementMatch {
  const haystack = haystackOf(requirement.text);
  const skills = skillCandidates(index, requirement, haystack);
  const texts = textCandidates(index, requirement, haystack);
  const usable = uniqueByFact(sortCandidates([...skills.usable, ...texts.usable]));
  const pending = uniqueByFact(sortCandidates([...skills.pending, ...texts.pending]));
  const cautions: string[] = [];
  const evidenceCap = ANALYSIS_LIMITS.evidencePerRequirement;

  if (usable.length > 0) {
    const strength: MatchStrength = usable.some((c) => c.level === 'direct') ? 'direct' : 'partial';
    const lead = usable[0]!;
    cautions.push(...usable.slice(0, 3).flatMap((candidate) => candidate.cautions));
    if (strength === 'direct' && requirement.yearsRequired !== null) {
      cautions.push(
        `A vaga pede ${String(requirement.yearsRequired)} ano(s): confira se o tempo confirmado no seu perfil cobre isso.`,
      );
    }
    if (pending.length > 0) {
      cautions.push('Há também itens relacionados aguardando a sua confirmação.');
    }
    const noun = KIND_NOUN[lead.fact.kind] ?? 'registro do perfil';
    return {
      requirementId: requirement.id,
      strength,
      evidence: [...usable, ...pending].slice(0, evidenceCap).map(toEvidence),
      rationale:
        strength === 'direct'
          ? `Sustentado por ${noun} confirmada: ${lead.fact.label}.`
          : `Sustentado por registro confirmado que não é experiência profissional: ${lead.fact.label}.`,
      gap: null,
      cautions: dedupe(cautions).slice(0, 5),
    };
  }

  const transferable = uniqueByFact(
    sortCandidates(transferableCandidates(index, requirement, haystack)),
  );
  if (transferable.length > 0) {
    const lead = transferable[0]!;
    return {
      requirementId: requirement.id,
      strength: 'transferable',
      evidence: [...transferable, ...pending].slice(0, evidenceCap).map(toEvidence),
      rationale: `Tecnologia relacionada confirmada no perfil: ${lead.fact.label}.`,
      gap: `Nenhum registro confirmado menciona ${lead.matchedTerms.join(', ')} diretamente.`,
      cautions: dedupe([
        ...lead.cautions,
        ...(pending.length > 0 ? ['Há também itens aguardando a sua confirmação.'] : []),
      ]).slice(0, 5),
    };
  }

  if (pending.length > 0) {
    return {
      requirementId: requirement.id,
      strength: 'pending',
      evidence: pending.slice(0, evidenceCap).map(toEvidence),
      rationale: 'Há registros relacionados, mas nenhum está confirmado ainda.',
      gap: 'Confirme (ou corrija) os itens indicados para que possam sustentar o currículo.',
      cautions: dedupe(pending[0]!.cautions).slice(0, 5),
    };
  }

  const quoted =
    requirement.text.length > 100 ? `${requirement.text.slice(0, 99)}…` : requirement.text;
  return {
    requirementId: requirement.id,
    strength: 'absent',
    evidence: [],
    rationale: 'Nenhum registro do perfil sustenta este requisito.',
    gap: `Nada no perfil sustenta: "${quoted}". Se você tem essa experiência, registre-a no perfil.`,
    cautions: [],
  };
}

const emptyCounts = (): Record<MatchStrength, number> => ({
  direct: 0,
  partial: 0,
  transferable: 0,
  pending: 0,
  absent: 0,
});

function buildPlan(
  requirements: readonly JobRequirement[],
  matches: readonly RequirementMatch[],
  index: MatchIndex,
): PrioritizedRecord[] {
  const byRequirement = new Map(requirements.map((r) => [r.id, r]));
  const acc = new Map<string, PrioritizedRecord>();
  for (const match of matches) {
    if (match.strength === 'pending' || match.strength === 'absent') continue;
    const requirement = byRequirement.get(match.requirementId);
    if (requirement === undefined) continue;
    for (const evidence of match.evidence) {
      const fact = index.byId.get(evidence.recordId.toLowerCase());
      if (!fact?.usable) continue;
      const current = acc.get(evidence.recordId);
      const weight = IMPORTANCE_WEIGHT[requirement.importance];
      if (current === undefined) {
        acc.set(evidence.recordId, {
          recordId: evidence.recordId,
          kind: evidence.kind,
          label: evidence.label,
          strength: match.strength,
          score: weight,
          requirementIds: [requirement.id],
        });
      } else {
        current.score += weight;
        if (!current.requirementIds.includes(requirement.id))
          current.requirementIds.push(requirement.id);
        if (STRENGTH_RANK[match.strength] < STRENGTH_RANK[current.strength]) {
          current.strength = match.strength;
        }
      }
    }
  }
  return [...acc.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        STRENGTH_RANK[a.strength] - STRENGTH_RANK[b.strength] ||
        a.label.localeCompare(b.label, 'pt-BR'),
    )
    .slice(0, ANALYSIS_LIMITS.prioritized);
}

/**
 * Analise deterministica de uma vaga contra o perfil: mesma entrada, mesmo resultado, sem rede e sem IA.
 * So registros confirmados, permitidos em curriculo e nao privados contam como evidencia usavel; os que
 * aguardam confirmacao aparecem como `pending`.
 */
export function analyzeJob(jobText: string, document: ProfileDocument): AnalysisResult {
  const { requirements, warnings } = extractRequirements(jobText);
  const index = buildMatchIndex(document);
  const matches = requirements.map((requirement) => matchRequirement(index, requirement));

  const byStrength = emptyCounts();
  const mandatoryByStrength = emptyCounts();
  const importanceOf = new Map(requirements.map((r) => [r.id, r.importance]));
  for (const match of matches) {
    byStrength[match.strength] += 1;
    if (importanceOf.get(match.requirementId) === 'mandatory')
      mandatoryByStrength[match.strength] += 1;
  }

  const allWarnings = [...warnings];
  if (looksLikeInstructions(jobText)) {
    allWarnings.push(
      'O texto da vaga contém trechos que parecem instruções para um sistema; eles foram tratados apenas como texto.',
    );
  }
  if (!index.facts.some((fact) => fact.usable)) {
    allWarnings.push('O perfil ainda não tem itens confirmados: nada pode sustentar um currículo.');
  }

  return {
    engine: 'deterministic',
    engineVersion: MATCHER_VERSION,
    requirements,
    matches,
    summary: { requirements: requirements.length, byStrength, mandatoryByStrength },
    prioritized: buildPlan(requirements, matches, index),
    warnings: allWarnings.slice(0, 10),
  };
}
