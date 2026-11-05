import {
  deleteJobResponseSchema,
  jobResponseSchema,
  listJobsResponseSchema,
  type JobDetail,
} from '@chameleon/contracts';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { violations } from './helpers/axe';
import { FakeApi, errorResponse, jsonResponse, makeSession } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

const JOB_ID = '0190a8f0-0000-7000-8000-000000000a01';
const OTHER_ID = '0190a8f0-0000-7000-8000-000000000a02';
// LF only: a textarea (browser or jsdom) normalizes line breaks to LF, so pasted text arrives with LF.
const TEXT = 'Vaga: Dev Backend\n\n• Node.js e PostgreSQL\n  Remoto ';

function detail(overrides: Record<string, unknown> = {}): JobDetail {
  return jobResponseSchema.parse({
    job: {
      id: JOB_ID,
      title: 'Dev Backend',
      company: 'Acme',
      url: 'https://exemplo.test/vaga',
      location: 'Brasil',
      workMode: 'remote',
      postedOn: '2026-10-30',
      status: 'saved',
      excerpt: 'Vaga: Dev Backend',
      descriptionLength: TEXT.length,
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
      description: TEXT,
      descriptionHash: 'a'.repeat(64),
      notes: 'Falar com a recrutadora',
      ...overrides,
    },
  }).job;
}

const summaryOf = (job: JobDetail) => {
  const { description: _d, descriptionHash: _h, notes: _n, ...summary } = job;
  return summary;
};

function listBody(jobs: JobDetail[], total = jobs.length) {
  return jsonResponse(
    200,
    listJobsResponseSchema.parse({
      jobs: jobs.map(summaryOf),
      counts: {
        total,
        active: jobs.length,
        byStatus: {
          saved: jobs.length,
          analyzed: 0,
          application_prepared: 0,
          application_sent: 0,
          interview: 0,
          closed: total - jobs.length,
          archived: 0,
        },
      },
    }),
  );
}

function loggedIn(): FakeApi {
  const fake = new FakeApi().install();
  fake.session = makeSession();
  // the detail page also asks for the (still empty) analysis
  fake.on(
    `GET /api/jobs/${JOB_ID}/analysis`,
    jsonResponse(200, { analysis: null, stale: false, staleBecause: [] }),
  );
  return fake;
}

describe('vagas: painel', () => {
  it('lista vazia orienta a adicionar a primeira vaga e passa no axe', async () => {
    const fake = loggedIn();
    fake.on('GET /api/jobs?status=active', listBody([]));
    const { container } = renderApp('/vagas');
    expect(await screen.findByText(/Nenhuma vaga salva ainda/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Adicionar vaga' })).toHaveAttribute(
      'href',
      '/vagas/nova',
    );
    expect(await violations(container)).toEqual([]);
  });

  it('lista as vagas com situação e trecho, filtra por situação e busca por texto', async () => {
    const fake = loggedIn();
    fake.on('GET /api/jobs?status=active', listBody([detail()]));
    fake.on('GET /api/jobs?status=archived', listBody([], 1));
    fake.on('GET /api/jobs?status=active&q=react', listBody([], 1));
    const { user, container } = renderApp('/vagas');
    const link = await screen.findByRole('link', { name: 'Dev Backend' });
    expect(link).toHaveAttribute('href', `/vagas/${JOB_ID}`);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Situação:')).toBeInTheDocument();
    expect(screen.getByText('1 em andamento · 1 no total')).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);

    await user.selectOptions(screen.getByLabelText('Mostrar'), 'archived');
    expect(await screen.findByText(/Nenhuma vaga encontrada com este filtro/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Mostrar'), 'active');
    await user.type(screen.getByLabelText('Buscar'), 'react');
    await waitFor(() => {
      expect(fake.requestsTo('GET /api/jobs?status=active&q=react').length).toBeGreaterThan(0);
    });
  });

  it('falha ao carregar mostra alerta e permite tentar de novo', async () => {
    const fake = loggedIn();
    fake.on('GET /api/jobs?status=active', errorResponse(500, 'INTERNAL_ERROR'));
    renderApp('/vagas');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('o menu principal e a Home levam às vagas', async () => {
    const fake = loggedIn();
    fake.on('GET /api/jobs?status=active', listBody([]));
    const { user } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Início' });
    await user.click(screen.getByRole('link', { name: 'Ver minhas vagas' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Vagas' })).toBeInTheDocument();
  });
});

describe('vagas: adicionar', () => {
  it('exige a descrição e não envia nada enquanto estiver vazia', async () => {
    const fake = loggedIn();
    const { user, container } = renderApp('/vagas/nova');
    await screen.findByRole('heading', { level: 1, name: 'Adicionar vaga' });
    await user.click(screen.getByRole('button', { name: 'Salvar vaga' }));
    expect(await screen.findByText('Cole a descrição da vaga.')).toBeInTheDocument();
    expect(fake.requestsTo('POST /api/jobs')).toHaveLength(0);
    expect(await violations(container)).toEqual([]);
  });

  it('salva só com a descrição e abre o detalhe com o texto original', async () => {
    const fake = loggedIn();
    fake.on('POST /api/jobs', jsonResponse(201, { job: detail() }));
    fake.on(`GET /api/jobs/${JOB_ID}`, jsonResponse(200, { job: detail() }));
    const { user } = renderApp('/vagas/nova');
    await screen.findByRole('heading', { level: 1, name: 'Adicionar vaga' });
    await user.click(screen.getByLabelText(/Descrição da vaga/));
    await user.paste(TEXT);
    await user.type(screen.getByLabelText('Empresa'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Salvar vaga' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Dev Backend' })).toBeVisible();
    const sent = fake.requestsTo('POST /api/jobs')[0]?.body as Record<string, unknown>;
    expect(sent.description).toBe(TEXT);
    expect(sent.company).toBe('Acme');
    expect(sent.status).toBe('saved');
  });

  it('url inválida é recusada localmente com mensagem no campo', async () => {
    const fake = loggedIn();
    const { user } = renderApp('/vagas/nova');
    await screen.findByRole('heading', { level: 1, name: 'Adicionar vaga' });
    await user.click(screen.getByLabelText(/Descrição da vaga/));
    await user.paste('texto');
    await user.type(screen.getByLabelText(/Endereço da vaga/), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Salvar vaga' }));
    expect(await screen.findByText(/endereço http:\/\/ ou https:\/\/ válido/)).toBeInTheDocument();
    expect(fake.requestsTo('POST /api/jobs')).toHaveLength(0);
  });

  it('erro da API é mostrado e o texto digitado é preservado', async () => {
    const fake = loggedIn();
    fake.on('POST /api/jobs', errorResponse(500, 'INTERNAL_ERROR'));
    const { user } = renderApp('/vagas/nova');
    await screen.findByRole('heading', { level: 1, name: 'Adicionar vaga' });
    const area = screen.getByLabelText(/Descrição da vaga/);
    await user.click(area);
    await user.paste('meu texto');
    await user.click(screen.getByRole('button', { name: 'Salvar vaga' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(area).toHaveValue('meu texto');
  });
});

describe('vagas: detalhe, edição e exclusão', () => {
  it('mostra o texto exatamente como salvo, as anotações e passa no axe', async () => {
    const fake = loggedIn();
    fake.on(`GET /api/jobs/${JOB_ID}`, jsonResponse(200, { job: detail() }));
    const { container } = renderApp(`/vagas/${JOB_ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dev Backend' })).toBeVisible();
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe(TEXT);
    expect(screen.getByText('Falar com a recrutadora')).toBeInTheDocument();
    const original = screen.getByRole('link', { name: /Abrir a vaga original/ });
    expect(original).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await violations(container)).toEqual([]);
  });

  it('muda a situação e arquiva pela própria tela', async () => {
    const fake = loggedIn();
    let current = detail();
    fake.on(`GET /api/jobs/${JOB_ID}`, () => jsonResponse(200, { job: current }));
    fake.on(`PATCH /api/jobs/${JOB_ID}`, (request) => {
      current = detail(request.body as Record<string, unknown>);
      return jsonResponse(200, { job: current });
    });
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    await screen.findByRole('heading', { level: 1, name: 'Dev Backend' });
    await user.selectOptions(screen.getByLabelText('Situação'), 'interview');
    expect(await screen.findByText('Vaga atualizada.')).toBeInTheDocument();
    expect(fake.requestsTo(`PATCH /api/jobs/${JOB_ID}`)[0]?.body).toEqual({ status: 'interview' });
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));
    await screen.findByRole('button', { name: 'Desarquivar' });
    expect(fake.requestsTo(`PATCH /api/jobs/${JOB_ID}`)[1]?.body).toEqual({ status: 'archived' });
  });

  it('excluir exige confirmação e volta ao painel', async () => {
    const fake = loggedIn();
    fake.on(`GET /api/jobs/${JOB_ID}`, jsonResponse(200, { job: detail() }));
    fake.on(
      `DELETE /api/jobs/${JOB_ID}`,
      jsonResponse(200, deleteJobResponseSchema.parse({ deleted: true, id: JOB_ID })),
    );
    fake.on('GET /api/jobs?status=active', listBody([]));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    await screen.findByRole('heading', { level: 1, name: 'Dev Backend' });
    await user.click(screen.getByRole('button', { name: 'Excluir…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(fake.requestsTo(`DELETE /api/jobs/${JOB_ID}`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(dialog).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Excluir…' }));
    await user.click(await screen.findByRole('button', { name: 'Excluir definitivamente' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Vagas' })).toBeInTheDocument();
    expect(fake.requestsTo(`DELETE /api/jobs/${JOB_ID}`)).toHaveLength(1);
  });

  it('editar abre o formulário preenchido e salva as alterações', async () => {
    const fake = loggedIn();
    fake.on(`GET /api/jobs/${JOB_ID}`, jsonResponse(200, { job: detail() }));
    fake.on(`PATCH /api/jobs/${JOB_ID}`, jsonResponse(200, { job: detail({ company: 'Nova' }) }));
    const { user, container } = renderApp(`/vagas/${JOB_ID}/editar`);
    expect(await screen.findByLabelText(/Descrição da vaga/)).toHaveValue(TEXT);
    expect(screen.getByLabelText('Empresa')).toHaveValue('Acme');
    expect(await violations(container)).toEqual([]);
    await user.clear(screen.getByLabelText('Empresa'));
    await user.type(screen.getByLabelText('Empresa'), 'Nova');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await screen.findByRole('heading', { level: 1, name: 'Dev Backend' });
    expect(fake.requestsTo(`PATCH /api/jobs/${JOB_ID}`)[0]?.body).toMatchObject({
      company: 'Nova',
      description: TEXT,
    });
  });

  it('uma vaga inexistente mostra uma mensagem clara com volta ao painel', async () => {
    const fake = loggedIn();
    fake.on(`GET /api/jobs/${OTHER_ID}`, errorResponse(404, 'NOT_FOUND'));
    renderApp(`/vagas/${OTHER_ID}`);
    expect(await screen.findByText(/Esta vaga não foi encontrada/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar às vagas' })).toBeInTheDocument();
  });
});
