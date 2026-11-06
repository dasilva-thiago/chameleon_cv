import { aiStatusResponseSchema, jobResponseSchema } from '@chameleon/contracts';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { violations } from './helpers/axe';
import { FakeApi, jsonResponse, makeSession } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

const JOB_ID = '0190a8f0-0000-7000-8000-000000000a01';

const provider = (consented: boolean) => ({
  id: 'gemini',
  label: 'Google Gemini',
  model: 'gemini-test',
  note: 'Plano gratuito: o conteúdo pode ser usado pelo provedor.',
  consented,
});

const status = (over: Record<string, unknown> = {}) =>
  aiStatusResponseSchema.parse({
    mode: 'auto',
    configured: true,
    providers: [provider(false)],
    consented: false,
    active: false,
    usageToday: { requests: 0, tokens: 0 },
    limits: { totalDailyRequests: 120, totalDailyTokens: 200_000 },
    ...over,
  });

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
    excerpt: 'Vaga: Dev Backend',
    descriptionLength: 20,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    description: 'Vaga: Dev Backend Node.js',
    descriptionHash: 'a'.repeat(64),
    notes: null,
  },
});

function setup(initial: ReturnType<typeof status>): FakeApi {
  const fake = new FakeApi().install();
  fake.session = makeSession();
  fake.on(`GET /api/jobs/${JOB_ID}`, jsonResponse(200, job));
  fake.on(
    `GET /api/jobs/${JOB_ID}/analysis`,
    jsonResponse(200, { analysis: null, stale: false, staleBecause: [] }),
  );
  fake.on('GET /api/ai', jsonResponse(200, initial));
  return fake;
}

describe('painel de IA na análise da vaga', () => {
  it('sem chaves configuradas não mostra nada e a análise segue local', async () => {
    const fake = setup(status({ configured: false, providers: [] }));
    expect(fake.requestsTo('GET /api/ai')).toHaveLength(0);
    renderApp(`/vagas/${JOB_ID}`);
    await screen.findByText(/Análise da vaga/);
    await waitFor(() => {
      expect(fake.requestsTo('GET /api/ai')).toHaveLength(1);
    });
    expect(screen.queryByText(/IA disponível/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Permitir uso de IA/ })).toBeNull();
  });

  it('com chave e sem consentimento explica o que será enviado e pede permissão; depois liga', async () => {
    const fake = setup(status());
    fake.on('PUT /api/ai/consent', () =>
      jsonResponse(
        200,
        status({
          providers: [provider(true)],
          consented: true,
          active: true,
          usageToday: { requests: 2, tokens: 300 },
        }),
      ),
    );
    const { user } = renderApp(`/vagas/${JOB_ID}`);

    const alert = await screen.findByText(/IA disponível, mas desligada/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/sem telefone, e-mail ou itens privados/)).toBeInTheDocument();
    expect(screen.getByText(/Plano gratuito/)).toBeInTheDocument();
    expect(await violations(document.body)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Permitir uso de IA' }));
    expect(await screen.findByText(/IA ativa/)).toBeInTheDocument();
    expect(screen.getByText(/Hoje: 2 de 120 chamadas/)).toBeInTheDocument();
    expect(fake.requestsTo('PUT /api/ai/consent')).toHaveLength(1);
    expect(fake.requestsTo('PUT /api/ai/consent')[0]?.body).toEqual({
      granted: true,
    });
  });

  it('com a IA ligada dá para desligar', async () => {
    const fake = setup(status({ providers: [provider(true)], consented: true, active: true }));
    fake.on('PUT /api/ai/consent', () => jsonResponse(200, status()));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Desligar IA' }));
    await waitFor(() => {
      expect(screen.getByText(/IA disponível, mas desligada/)).toBeInTheDocument();
    });
    expect(fake.requestsTo('PUT /api/ai/consent')[0]?.body).toEqual({
      granted: false,
    });
  });
});
