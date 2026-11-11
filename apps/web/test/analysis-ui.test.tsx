import {
  analysisStateResponseSchema,
  jobAnalysisSchema,
  jobResponseSchema,
  runAnalysisResponseSchema,
  type AnalysisResult,
  type JobAnalysis,
} from '@chameleon/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { violations } from './helpers/axe';
import { FakeApi, errorResponse, jsonResponse, makeSession } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

const JOB_ID = '0190a8f0-0000-7000-8000-000000000b01';
const ANALYSIS_ID = '0190a8f0-0000-7000-8000-000000000b02';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const job = jobResponseSchema.parse({
  job: {
    id: JOB_ID,
    title: 'Dev Backend',
    company: 'Acme',
    url: null,
    location: null,
    workMode: null,
    postedOn: null,
    status: 'saved',
    excerpt: 'Requisitos',
    descriptionLength: 10,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    description: 'Requisitos\n- Node.js é obrigatório\n- Kubernetes',
    descriptionHash: HASH_A,
    notes: null,
  },
});

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    schemaVersion: 2,
    extraction: {
      promptVersion: 'co-extract-1',
      role: {
        title: 'Dev Backend Júnior',
        company: 'Acme',
        seniority: 'Júnior',
        workMode: 'remote',
        location: null,
        contract: 'clt',
        salary: null,
        tldr: 'Vaga backend júnior remota.',
      },
      requirements: [
        {
          id: 'r1',
          text: 'Node.js',
          importance: 'critical',
          tier: 'stated',
          jdSignal: 'Node.js é obrigatório',
        },
        {
          id: 'r2',
          text: 'Kubernetes em produção',
          importance: 'high',
          tier: 'structural',
          jdSignal: 'Requisitos',
        },
      ],
      keywords: ['Node.js', 'Kubernetes'],
    },
    archetype: { label: 'Desenvolvedor Backend Júnior', fit: 'primary', note: null },
    dealbreakers: [],
    matches: [
      {
        requirementId: 'r1',
        match: 'strong',
        evidence: 'APIs REST com Node.js',
        evidenceVerified: true,
        gap: null,
      },
      {
        requirementId: 'r2',
        match: 'missing',
        evidence: null,
        evidenceVerified: false,
        gap: 'Sem Kubernetes na base',
      },
    ],
    gaps: [
      {
        requirementId: 'r2',
        blocker: false,
        risk: 'Perguntas sobre containers',
        mitigation: 'Estudar o básico de Kubernetes',
      },
    ],
    scores: { cvMatch: 4, northStar: 5, comp: null, conditions: 5, redFlags: 5 },
    score: 4.2,
    verdict: {
      recommendation: 'apply',
      headline: 'Boa vaga para o seu alvo principal.',
      reasons: ['Node.js forte'],
    },
    salary: {
      min: 3000,
      max: 3500,
      currency: 'BRL',
      period: 'monthly',
      contract: 'clt',
      text: 'Informe R$ 3.000 a R$ 3.500.',
      sources: ['faixa do perfil'],
      warning: 'A empresa não informou salário.',
    },
    customization: ['Abrir com o projeto de APIs'],
    order: ['r1', 'r2'],
    ai: { provider: 'gemini', model: 'm', promptVersion: 'co-extract-1+co-eval-1' },
    warnings: ['1 evidência citada pela IA não foi encontrada na sua base.'],
    ...overrides,
  };
}

function analysis(overrides: Partial<AnalysisResult> = {}): JobAnalysis {
  return jobAnalysisSchema.parse({
    id: ANALYSIS_ID,
    jobId: JOB_ID,
    descriptionHash: HASH_A,
    profileHash: HASH_B,
    createdAt: '2026-11-05T11:00:00.000Z',
    result: result(overrides),
  });
}

const state = (value: JobAnalysis | null, stale: string[] = []) =>
  analysisStateResponseSchema.parse({
    analysis: value,
    stale: stale.length > 0,
    staleBecause: stale,
  });

function setup(initial: JobAnalysis | null, stale: string[] = []): FakeApi {
  const fake = new FakeApi().install();
  fake.session = makeSession();
  fake.on(`GET /api/jobs/${JOB_ID}`, jsonResponse(200, job));
  fake.on(`GET /api/jobs/${JOB_ID}/analysis`, jsonResponse(200, state(initial, stale)));
  fake.on(`GET /api/jobs/${JOB_ID}/resumes`, jsonResponse(200, { resumes: [] }));
  return fake;
}

describe('avaliação da vaga na tela', () => {
  it('sem avaliação oferece "Avaliar vaga"; ao avaliar mostra nota, veredito, requisitos, lacunas e salário', async () => {
    const fake = setup(null);
    let stored: JobAnalysis | null = null;
    fake.on(`GET /api/jobs/${JOB_ID}/analysis`, () => jsonResponse(200, state(stored)));
    fake.on(`POST /api/jobs/${JOB_ID}/analysis`, () => {
      stored = analysis();
      return jsonResponse(
        201,
        runAnalysisResponseSchema.parse({ ...state(stored), reused: false }),
      );
    });
    const { user, container } = renderApp(`/vagas/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Avaliar vaga' }));

    expect(await screen.findByText('Boa vaga para o seu alvo principal.')).toBeVisible();
    expect(fake.requestsTo(`POST /api/jobs/${JOB_ID}/analysis`)[0]?.body).toEqual({ force: false });
    expect(screen.getByText('4.2')).toBeVisible();
    expect(screen.getByText('Vale se candidatar')).toBeVisible();
    expect(screen.getByText(/Desenvolvedor Backend Júnior · alvo principal/)).toBeVisible();

    const requirements = screen.getByRole('region', { name: 'Requisitos × sua base' });
    const items = within(requirements).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Forte');
    expect(items[0]).toHaveTextContent('Crítico (dito na vaga)');
    expect(items[0]).toHaveTextContent('Na sua base: “APIs REST com Node.js”');
    expect(items[1]).toHaveTextContent('Faltando');
    expect(items[1]).toHaveTextContent('Falta: Sem Kubernetes na base');

    expect(screen.getByRole('region', { name: 'Lacunas e como contornar' })).toHaveTextContent(
      'Como contornar: Estudar o básico de Kubernetes',
    );
    const salary = screen.getByRole('region', { name: 'Pretensão salarial sugerida' });
    expect(salary).toHaveTextContent('A empresa não informou salário.');
    expect(screen.getByText(/não foi encontrada na sua base/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it('uma regra que barra a vaga aparece no topo, com a frase da vaga', async () => {
    setup(
      analysis({
        dealbreakers: [{ rule: 'Vagas com Java estão fora do alvo', jdQuote: 'Java obrigatório' }],
        score: 2.5,
        verdict: { recommendation: 'skip', headline: 'Fora do alvo.', reasons: [] },
      }),
    );
    renderApp(`/vagas/${JOB_ID}`);
    expect(await screen.findByText('Esta vaga quebra uma regra sua')).toBeVisible();
    expect(screen.getByText(/a vaga diz: “Java obrigatório”/)).toBeVisible();
    expect(screen.getByText('Não recomendado')).toBeVisible();
  });

  it('mostra o aviso de avaliação desatualizada com o motivo e reavalia sem forçar', async () => {
    const fake = setup(analysis(), ['job_text', 'profile']);
    fake.on(`POST /api/jobs/${JOB_ID}/analysis`, () =>
      jsonResponse(201, runAnalysisResponseSchema.parse({ ...state(analysis()), reused: false })),
    );
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    const alert = await screen.findByText('Avaliação desatualizada');
    expect(alert.parentElement).toHaveTextContent(
      /o texto da vaga mudou e a sua base profissional mudou/,
    );
    await user.click(screen.getByRole('button', { name: 'Avaliar de novo' }));
    expect(fake.requestsTo(`POST /api/jobs/${JOB_ID}/analysis`)[0]?.body).toEqual({ force: false });
  });

  it('com a avaliação em dia, "Avaliar de novo" força uma nova chamada', async () => {
    const fake = setup(analysis());
    fake.on(`POST /api/jobs/${JOB_ID}/analysis`, () =>
      jsonResponse(200, runAnalysisResponseSchema.parse({ ...state(analysis()), reused: false })),
    );
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Avaliar de novo' }));
    expect(fake.requestsTo(`POST /api/jobs/${JOB_ID}/analysis`)[0]?.body).toEqual({ force: true });
  });

  it('sem base, o erro explica o próximo passo e liga à base', async () => {
    const fake = setup(null);
    fake.on(`POST /api/jobs/${JOB_ID}/analysis`, errorResponse(409, 'PROFILE_REQUIRED'));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Avaliar vaga' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Preencha a sua base profissional/);
    expect(within(alert).getByRole('link', { name: 'Preencher a base' })).toHaveAttribute(
      'href',
      '/perfil',
    );
  });

  it('sem IA disponível, explica o motivo', async () => {
    const fake = setup(null);
    fake.on(`POST /api/jobs/${JOB_ID}/analysis`, errorResponse(503, 'AI_UNAVAILABLE'));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Avaliar vaga' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nenhum provedor de IA respondeu/);
  });
});
