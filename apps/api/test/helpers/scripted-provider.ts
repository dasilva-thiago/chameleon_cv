/**
 * A scripted AI provider and a synthetic professional base, shared by the API tests and the end-to-end run (no
 * vitest import here: Playwright loads this file too).
 */
import type { AiProvider, CompletionRequest } from '@chameleon/ai';

/** A synthetic professional base (no real person). */
export const BASE_CV = [
  '# CV -- Ana Teste',
  '**Headline:** Desenvolvedora de Software',
  '**Location:** Curitiba - PR',
  '**Phone:** (41) 99999-0000',
  '**Email:** ana.contato@example.test',
  '**GitHub:** https://github.com/ana-teste',
  '',
  '## Professional Summary',
  '',
  'Estudante de Sistemas de Informação com experiência em suporte e um projeto full stack.',
  '',
  '## Work Experience',
  '',
  '### Acme — Curitiba - PR',
  '',
  '**Suporte Técnico**',
  '2025 - Atual',
  '',
  '- Triagem de incidentes em sistemas web.',
  '- Atendimento a 120 clientes por mês.',
  '',
  '## Projects',
  '',
  '### Painel de Equipamentos',
  '',
  'https://painel.example.test',
  '',
  'TypeScript, Node.js, Express, PostgreSQL',
  '',
  '- Criou APIs REST em Node.js.',
  '- Modelagem PostgreSQL com Prisma.',
  '',
  '## Education',
  '',
  '### UFPR — Curitiba',
  '',
  '**Sistemas de Informação**',
  'Em andamento',
  '',
  '## Skills',
  '',
  '- **Backend:** Node.js, Express, APIs REST',
  '- **Dados:** SQL, PostgreSQL',
  '',
].join('\n');

export const BASE_PROFILE = [
  '## Alvos',
  '- Desenvolvedora Backend Júnior (principal)',
  '',
  '## Regras que barram a vaga',
  '- Vagas que exigem Java estão fora do alvo.',
  '',
  '## Salário',
  '- CLT remoto: mínimo R$ 2.500, preferência R$ 3.000.',
  '',
  '## Expressões a evitar',
  '- ninja',
  '',
].join('\n');

export const JOB_TEXT = [
  'Desenvolvedor Backend Júnior',
  'Requisitos:',
  '- Node.js é obrigatório',
  '- Kubernetes em produção',
].join('\n');

const EXTRACTION = {
  role: {
    title: 'Desenvolvedor Backend Júnior',
    company: 'Acme',
    seniority: 'Júnior',
    workMode: 'remote',
    location: null,
    contract: 'clt',
    salary: null,
    tldr: 'Vaga backend júnior.',
  },
  requirements: [
    { text: 'Node.js', importance: 'critical', tier: 'stated', jdSignal: 'Node.js é obrigatório' },
    {
      text: 'Kubernetes em produção',
      importance: 'high',
      tier: 'structural',
      jdSignal: 'Requisitos',
    },
  ],
  keywords: ['Node.js', 'Kubernetes', 'APIs REST'],
};

const EVALUATION = {
  archetype: { label: 'Desenvolvedora Backend Júnior', fit: 'primary', note: null },
  dealbreakers: [],
  matches: [
    { requirementId: 'r1', match: 'strong', evidence: 'Criou APIs REST em Node.js.', gap: null },
    { requirementId: 'r2', match: 'missing', evidence: null, gap: 'Sem Kubernetes na base' },
  ],
  gaps: [
    {
      requirementId: 'r2',
      blocker: false,
      risk: 'Perguntas de Kubernetes',
      mitigation: 'Estudar o básico',
    },
  ],
  scores: { cvMatch: 4, northStar: 5, comp: null, conditions: 5, redFlags: 5 },
  score: 4.1,
  verdict: { headline: 'Boa vaga para o alvo principal.', reasons: ['Node.js forte'] },
  salary: {
    min: 3000,
    max: 3500,
    currency: 'BRL',
    period: 'monthly',
    contract: 'clt',
    text: 'R$ 3.000 a R$ 3.500',
    sources: ['faixa do perfil'],
    warning: 'A empresa não informou salário.',
  },
  customization: ['Abrir com o projeto de APIs'],
};

const PLAN = {
  headline: 'Desenvolvedora Backend Júnior | Node.js · PostgreSQL',
  summary: 'Estudante de Sistemas de Informação com projeto de APIs REST em Node.js e PostgreSQL.',
  competencies: ['Node.js', 'APIs REST', 'PostgreSQL'],
  experience: [
    {
      company: 'Acme',
      bullets: ['Triagem de incidentes em sistemas web.', 'Atendimento a 120 clientes por mês.'],
    },
  ],
  projects: [{ name: 'Painel de Equipamentos', bullets: ['Criou APIs REST em Node.js.'] }],
  skills: [{ group: 'Backend', items: ['Node.js', 'Express'] }],
};

export interface Scripted extends AiProvider {
  requests: CompletionRequest[];
  mode: 'ok' | 'quota';
  /** Overrides of the answers (by stage). */
  answers: { extract?: unknown; evaluate?: unknown; tailor?: unknown };
  calls(stage: 'extract' | 'evaluate' | 'tailor'): number;
}

const stageOf = (request: CompletionRequest): 'extract' | 'evaluate' | 'tailor' => {
  const system = request.messages[0]?.content ?? '';
  if (system.includes('You read ONE job posting')) return 'extract';
  if (system.includes('You evaluate ONE job')) return 'evaluate';
  return 'tailor';
};

/** A provider that answers each stage with a fixed, valid JSON (or fails with a quota error). */
export function scriptedProvider(): Scripted {
  const provider: Scripted = {
    requests: [],
    mode: 'ok',
    answers: {},
    calls: (stage) => provider.requests.filter((request) => stageOf(request) === stage).length,
    spec: {
      id: 'fake',
      label: 'Fake',
      baseUrl: 'https://fake.example.test/v1',
      model: 'fake-model',
      apiKey: 'k',
      dailyRequests: 500,
      jsonMode: true,
      timeoutMs: 1000,
    },
    complete(request) {
      provider.requests.push(request);
      if (provider.mode === 'quota') {
        return Promise.reject(
          Object.assign(new Error('quota'), { name: 'AiProviderError', kind: 'quota' }),
        );
      }
      const stage = stageOf(request);
      const answer =
        provider.answers[stage] ??
        (stage === 'extract' ? EXTRACTION : stage === 'evaluate' ? EVALUATION : PLAN);
      return Promise.resolve({
        text: JSON.stringify(answer),
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        provider: 'fake',
        model: 'fake-model',
      });
    },
  };
  return provider;
}
