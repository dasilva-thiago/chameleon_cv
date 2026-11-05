import {
  analysisStateResponseSchema,
  jobAnalysisSchema,
  jobResponseSchema,
  runAnalysisResponseSchema,
  type JobAnalysis,
} from '@chameleon/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { violations } from './helpers/axe';
import { FakeApi, errorResponse, jsonResponse, makeSession } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

const JOB_ID = '0190a8f0-0000-7000-8000-000000000b01';
const ANALYSIS_ID = '0190a8f0-0000-7000-8000-000000000b02';
const SKILL_ID = '0190a8f0-0000-7000-8000-000000000b03';
const EXPERIENCE_ID = '0190a8f0-0000-7000-8000-000000000b04';
const PENDING_ID = '0190a8f0-0000-7000-8000-000000000b05';
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
    description: 'Requisitos\n- Node.js\n- Kubernetes\n- Terraform',
    descriptionHash: HASH_A,
    notes: null,
  },
});

function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return jobAnalysisSchema.parse({
    id: ANALYSIS_ID,
    jobId: JOB_ID,
    descriptionHash: HASH_A,
    profileHash: HASH_B,
    reviewedAt: null,
    createdAt: '2026-11-05T11:00:00.000Z',
    review: { excludedRecordIds: [], pinnedRecordIds: [], notes: {} },
    result: {
      engine: 'deterministic',
      engineVersion: 'req-1.match-1',
      requirements: [
        {
          id: 'r1',
          importance: 'mandatory',
          text: 'Node.js',
          keywords: ['Node.js'],
          yearsRequired: 3,
        },
        {
          id: 'r2',
          importance: 'mandatory',
          text: 'Kubernetes em produção',
          keywords: [],
          yearsRequired: null,
        },
        {
          id: 'r3',
          importance: 'desirable',
          text: 'Terraform',
          keywords: ['Terraform'],
          yearsRequired: null,
        },
      ],
      matches: [
        {
          requirementId: 'r1',
          strength: 'direct',
          evidence: [
            {
              recordId: SKILL_ID,
              kind: 'skill',
              label: 'Node.js',
              via: 'skill',
              context: 'professional_experience',
              supportingRecordId: null,
              status: 'confirmed',
              matchedTerms: ['Node.js'],
            },
            {
              recordId: EXPERIENCE_ID,
              kind: 'experience',
              label: 'Dev Backend — Acme',
              via: 'skill',
              context: 'professional_experience',
              supportingRecordId: null,
              status: 'confirmed',
              matchedTerms: ['Node.js'],
            },
          ],
          rationale: 'Sustentado por experiência profissional confirmada: Dev Backend — Acme.',
          gap: null,
          cautions: [
            'A vaga pede 3 ano(s): confira se o tempo confirmado no seu perfil cobre isso.',
          ],
        },
        {
          requirementId: 'r2',
          strength: 'absent',
          evidence: [],
          rationale: 'Nenhum registro do perfil sustenta este requisito.',
          gap: 'Nada no perfil sustenta: "Kubernetes em produção". Se você tem essa experiência, registre-a no perfil.',
          cautions: [],
        },
        {
          requirementId: 'r3',
          strength: 'pending',
          evidence: [
            {
              recordId: PENDING_ID,
              kind: 'skill',
              label: 'Terraform',
              via: 'skill',
              context: null,
              supportingRecordId: null,
              status: 'needs_review',
              matchedTerms: ['Terraform'],
            },
          ],
          rationale: 'Há registros relacionados, mas nenhum está confirmado ainda.',
          gap: 'Confirme (ou corrija) os itens indicados para que possam sustentar o currículo.',
          cautions: ['A habilidade ainda aguarda a sua confirmação.'],
        },
      ],
      summary: {
        requirements: 3,
        byStrength: { direct: 1, partial: 0, transferable: 0, pending: 1, absent: 1 },
        mandatoryByStrength: { direct: 1, partial: 0, transferable: 0, pending: 0, absent: 1 },
      },
      prioritized: [
        {
          recordId: SKILL_ID,
          kind: 'skill',
          label: 'Node.js',
          strength: 'direct',
          score: 3,
          requirementIds: ['r1'],
        },
        {
          recordId: EXPERIENCE_ID,
          kind: 'experience',
          label: 'Dev Backend — Acme',
          strength: 'direct',
          score: 3,
          requirementIds: ['r1'],
        },
      ],
      warnings: [
        'O texto da vaga contém trechos que parecem instruções para um sistema; eles foram tratados apenas como texto.',
      ],
    },
    ...overrides,
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
  return fake;
}

describe('análise da vaga na tela', () => {
  it('sem análise oferece "Analisar vaga"; ao analisar mostra resumo, evidências, lacunas e plano', async () => {
    const fake = setup(null);
    let stored: JobAnalysis | null = null;
    // after the POST the query is refetched and must see the stored analysis
    fake.on(`GET /api/jobs/${JOB_ID}/analysis`, () => jsonResponse(200, state(stored)));
    fake.on(`POST /api/jobs/${JOB_ID}/analysis`, () => {
      stored = analysis();
      return jsonResponse(
        201,
        runAnalysisResponseSchema.parse({ ...state(stored), reused: false }),
      );
    });
    const { user, container } = renderApp(`/vagas/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Analisar vaga' }));

    expect(await screen.findByRole('heading', { name: 'Resumo' })).toBeVisible();
    expect(fake.requestsTo(`POST /api/jobs/${JOB_ID}/analysis`)[0]?.body).toEqual({ force: false });
    expect(
      screen.getByText('Requisitos obrigatórios com alguma sustentação confirmada: 1 de 2.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/parecem instruções/)).toBeInTheDocument();

    const nodeLinks = screen.getAllByRole('link', { name: 'Competência: Node.js' });
    expect(nodeLinks[0]).toHaveAttribute('href', '/perfil/competencias');
    expect(
      screen.getByText(/Nada no perfil sustenta: "Kubernetes em produção"/),
    ).toBeInTheDocument();
    expect(screen.getByText(/A vaga pede 3 ano/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Competência: Terraform' })).toBeInTheDocument();
    expect(screen.getByText(/aguardando confirmação\)/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it('mostra o aviso de análise desatualizada com o motivo', async () => {
    setup(analysis(), ['job_text', 'profile']);
    renderApp(`/vagas/${JOB_ID}`);
    const alert = await screen.findByText('Análise desatualizada');
    expect(alert.parentElement).toHaveTextContent(/o texto da vaga mudou e o seu perfil mudou/);
    expect(screen.getByRole('button', { name: 'Analisar de novo' })).toBeInTheDocument();
  });

  it('revisão: desmarcar item e anotar só habilita salvar depois da mudança e envia o corpo certo', async () => {
    const fake = setup(analysis());
    const saved = analysis({
      reviewedAt: '2026-11-05T12:00:00.000Z',
      review: {
        excludedRecordIds: [EXPERIENCE_ID],
        pinnedRecordIds: [],
        notes: { r2: 'Tenho, falta registrar' },
      },
    });
    fake.on(`PATCH /api/jobs/${JOB_ID}/analysis/review`, jsonResponse(200, state(saved)));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    const save = await screen.findByRole('button', { name: 'Salvar revisão' });
    expect(save).toBeDisabled();

    const plan = screen.getByRole('heading', { name: 'Plano de adaptação' }).parentElement!;
    await user.click(
      within(plan).getByRole('checkbox', { name: /Experiência: Dev Backend — Acme/ }),
    );
    await user.type(
      screen.getByLabelText('Sua anotação sobre este requisito (r2)'),
      'Tenho, falta registrar',
    );
    expect(save).toBeEnabled();
    fake.on(`GET /api/jobs/${JOB_ID}/analysis`, jsonResponse(200, state(saved)));
    await user.click(save);

    await waitFor(() => {
      expect(fake.requestsTo(`PATCH /api/jobs/${JOB_ID}/analysis/review`)).toHaveLength(1);
    });
    expect(fake.requestsTo(`PATCH /api/jobs/${JOB_ID}/analysis/review`)[0]?.body).toEqual({
      review: {
        excludedRecordIds: [EXPERIENCE_ID],
        pinnedRecordIds: [],
        notes: { r2: 'Tenho, falta registrar' },
      },
    });
    expect(await screen.findByText(/Revisada em/)).toBeInTheDocument();
  });

  it('sem perfil, o erro explica o próximo passo e liga à importação', async () => {
    const fake = setup(null);
    fake.on(`POST /api/jobs/${JOB_ID}/analysis`, errorResponse(409, 'PROFILE_REQUIRED'));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Analisar vaga' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Cadastre ou importe o seu perfil/);
    expect(within(alert).getByRole('link', { name: 'Importar perfil' })).toHaveAttribute(
      'href',
      '/perfil/importar',
    );
  });

  it('avisa quando nada mudou e a análise anterior foi mantida', async () => {
    const fake = setup(analysis());
    fake.on(
      `POST /api/jobs/${JOB_ID}/analysis`,
      jsonResponse(200, runAnalysisResponseSchema.parse({ ...state(analysis()), reused: true })),
    );
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Analisar de novo' }));
    expect(
      await screen.findByText('Nada mudou desde a última análise: ela foi mantida.'),
    ).toBeInTheDocument();
  });
});
