import {
  createResumeResponseSchema,
  deleteResumeResponseSchema,
  jobResponseSchema,
  resumeVersionResponseSchema,
  type ResumeSummary,
} from '@chameleon/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { violations } from './helpers/axe';
import { FakeApi, errorResponse, jsonResponse, makeSession } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';
import {
  JOB_ID,
  RESUME_ID,
  V1,
  V2,
  V3,
  WARNING_ISSUE,
  GAP_ISSUE,
  contentWithGap,
  fileResponse,
  installProfile,
  listBody,
  makeResume,
  makeVersion,
  resumeBody,
  versionBody,
} from './helpers/resume-fixtures';

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
    description: 'Requisitos\n- Node.js',
    descriptionHash: 'a'.repeat(64),
    notes: null,
  },
});

const draft = makeVersion({
  id: V1,
  versionNumber: 1,
  issues: [GAP_ISSUE],
  content: contentWithGap(),
});
const approved = makeVersion({
  id: V2,
  versionNumber: 2,
  status: 'approved',
  issues: [WARNING_ISSUE],
});

const downloads: string[] = [];

beforeEach(() => {
  downloads.length = 0;
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(resumes: ResumeSummary[] = [makeResume([draft, approved])]): FakeApi {
  const fake = new FakeApi().install();
  fake.session = makeSession();
  fake.on(`GET /api/jobs/${JOB_ID}`, jsonResponse(200, job));
  fake.on(
    `GET /api/jobs/${JOB_ID}/analysis`,
    jsonResponse(200, { analysis: null, stale: false, staleBecause: [] }),
  );
  fake.on(`GET /api/jobs/${JOB_ID}/resumes`, listBody(resumes));
  installProfile(fake);
  return fake;
}

async function findSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name: 'Currículos desta vaga' });
  const section = heading.closest('section');
  if (section === null) throw new Error('section not found');
  await waitFor(() => {
    expect(within(section).queryByText('Carregando os currículos…')).toBeNull();
  });
  return section;
}

function rowOf(section: HTMLElement, text: string): HTMLElement {
  const row = within(section).getByText(text).closest('li');
  if (row === null) throw new Error(`row not found: ${text}`);
  return row;
}

describe('currículos na página da vaga', () => {
  it('lista currículos e versões (mais nova primeiro) com situação e contagens, e passa no axe', async () => {
    setup();
    const { container } = renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();

    expect(
      await within(section).findByRole('heading', { level: 3, name: 'Dev Backend — Acme' }),
    ).toBeVisible();
    const order = within(section)
      .getAllByText(/^Versão \d$/)
      .map((node) => node.textContent);
    expect(order).toEqual(['Versão 2', 'Versão 1']);

    const approvedRow = rowOf(section, 'Versão 2');
    expect(within(approvedRow).getByText('Aprovada')).toBeInTheDocument();
    expect(approvedRow).toHaveTextContent('0 erros e 1 aviso');
    expect(within(approvedRow).getByRole('link', { name: /^Abrir/ })).toHaveAttribute(
      'href',
      `/curriculos/${RESUME_ID}/versoes/${V2}`,
    );

    const draftRow = rowOf(section, 'Versão 1');
    expect(within(draftRow).getByText('Rascunho')).toBeInTheDocument();
    expect(draftRow).toHaveTextContent('1 erro e 0 avisos');

    // download só para versão aprovada
    expect(within(approvedRow).getByRole('button', { name: /^Baixar DOCX/ })).toBeEnabled();
    expect(within(approvedRow).getByRole('button', { name: /^Baixar PDF/ })).toBeEnabled();
    expect(within(draftRow).queryByRole('button', { name: /^Baixar/ })).toBeNull();
    expect(await violations(container)).toEqual([]);
  });

  it('sem currículos mostra o estado vazio e o botão de gerar', async () => {
    setup([]);
    renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();
    expect(await within(section).findByText(/Nenhum currículo gerado/)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Gerar currículo' })).toBeEnabled();
  });

  it('erro ao carregar a lista é explicado em um alerta', async () => {
    const fake = setup();
    fake.on(`GET /api/jobs/${JOB_ID}/resumes`, errorResponse(403, 'CONSENT_REQUIRED_FOR_PROFILE'));
    renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      /ainda não tem a autorização/,
    );
  });

  it('gerar currículo mostra o que ficou de fora e liga ao editor da versão 1', async () => {
    const fake = setup([]);
    const generated = makeResume([draft]);
    let created = false;
    fake.on(`GET /api/jobs/${JOB_ID}/resumes`, () => listBody(created ? [generated] : []));
    fake.on(`POST /api/jobs/${JOB_ID}/resumes`, () => {
      created = true;
      return jsonResponse(
        201,
        createResumeResponseSchema.parse({
          resume: generated,
          version: draft,
          notes: ['A experiência "Estágio" foi omitida: ainda não foi confirmada.'],
        }),
      );
    });
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();
    await user.click(await within(section).findByRole('button', { name: 'Gerar currículo' }));

    const info = await within(section).findByText(/A versão 1 é um rascunho/);
    const alert = info.closest('[role="status"]');
    expect(alert).toHaveTextContent('A experiência "Estágio" foi omitida');
    expect(
      within(alert as HTMLElement).getByRole('link', { name: /Abrir a versão 1/ }),
    ).toHaveAttribute('href', `/curriculos/${RESUME_ID}/versoes/${V1}`);
    expect(fake.requestsTo(`POST /api/jobs/${JOB_ID}/resumes`)[0]?.body).toEqual({});
    expect(
      await within(section).findByRole('heading', { level: 3, name: 'Dev Backend — Acme' }),
    ).toBeVisible();
  });

  it('sem perfil, gerar explica o próximo passo e liga à importação', async () => {
    const fake = setup([]);
    fake.on(`POST /api/jobs/${JOB_ID}/resumes`, errorResponse(409, 'PROFILE_REQUIRED'));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();
    await user.click(await within(section).findByRole('button', { name: 'Gerar currículo' }));
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent(/Cadastre ou importe o seu perfil/);
    expect(within(alert).getByRole('link', { name: 'Importar perfil' })).toHaveAttribute(
      'href',
      '/perfil/importar',
    );
  });

  it('baixar DOCX pede o arquivo da versão aprovada e entrega com o nome do servidor', async () => {
    const fake = setup();
    const route = `GET /api/resumes/${RESUME_ID}/versions/${V2}/export?format=docx`;
    fake.on(route, () => fileResponse('curriculo-v2.docx', 'application/octet-stream'));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();
    const row = rowOf(section, 'Versão 2');
    await user.click(await within(row).findByRole('button', { name: /^Baixar DOCX/ }));

    await waitFor(() => {
      expect(downloads).toEqual(['curriculo-v2.docx']);
    });
    expect(fake.requestsTo(route)).toHaveLength(1);
    expect(await within(row).findByText(/Arquivo DOCX gerado/)).toBeInTheDocument();
  });

  it('falha no download mostra a mensagem em português e não baixa nada', async () => {
    const fake = setup();
    fake.on(
      `GET /api/resumes/${RESUME_ID}/versions/${V2}/export?format=pdf`,
      errorResponse(409, 'VERSION_NOT_APPROVED'),
    );
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();
    const row = rowOf(section, 'Versão 2');
    await user.click(await within(row).findByRole('button', { name: /^Baixar PDF/ }));
    expect(await within(row).findByRole('alert')).toHaveTextContent(
      'Aprove a versão antes de exportar.',
    );
    expect(downloads).toEqual([]);
  });

  it('nova versão a partir de uma versão envia fromVersionId e abre o editor do novo rascunho', async () => {
    const fake = setup();
    const created = makeVersion({ id: V3, versionNumber: 3 });
    fake.on(
      `POST /api/resumes/${RESUME_ID}/versions`,
      jsonResponse(201, resumeVersionResponseSchema.parse({ version: created })),
    );
    fake.on(`GET /api/resumes/${RESUME_ID}`, resumeBody(makeResume([draft, approved, created])));
    fake.on(`GET /api/resumes/${RESUME_ID}/versions/${V3}`, versionBody(created));
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();
    await user.click(
      await within(rowOf(section, 'Versão 2')).findByRole('button', {
        name: /^Nova versão a partir desta/,
      }),
    );

    expect(fake.requestsTo(`POST /api/resumes/${RESUME_ID}/versions`)[0]?.body).toEqual({
      fromVersionId: V2,
    });
    expect(await screen.findByRole('button', { name: 'Salvar rascunho' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/curriculos/${RESUME_ID}/versoes/${V3}`,
    );
  });

  it('renomear mostra o campo, valida o nome vazio e envia o novo nome', async () => {
    const fake = setup();
    let current = makeResume([draft, approved]);
    fake.on(`GET /api/jobs/${JOB_ID}/resumes`, () => listBody([current]));
    fake.on(`PATCH /api/resumes/${RESUME_ID}`, () => {
      current = makeResume([draft, approved], 'Versão para a Acme');
      return resumeBody(current);
    });
    const { user } = renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();
    await user.click(await within(section).findByRole('button', { name: /^Renomear/ }));

    const field = within(section).getByLabelText('Nome do currículo');
    await user.clear(field);
    await user.click(within(section).getByRole('button', { name: 'Salvar nome' }));
    expect(await within(section).findByText('Informe um nome para o currículo.')).toBeVisible();
    expect(fake.requestsTo(`PATCH /api/resumes/${RESUME_ID}`)).toHaveLength(0);

    await user.type(field, 'Versão para a Acme');
    await user.click(within(section).getByRole('button', { name: 'Salvar nome' }));
    await waitFor(() => {
      expect(fake.requestsTo(`PATCH /api/resumes/${RESUME_ID}`)).toHaveLength(1);
    });
    expect(fake.requestsTo(`PATCH /api/resumes/${RESUME_ID}`)[0]?.body).toEqual({
      name: 'Versão para a Acme',
    });
    expect(
      await within(section).findByRole('heading', { level: 3, name: 'Versão para a Acme' }),
    ).toBeVisible();
    expect(within(section).queryByLabelText('Nome do currículo')).toBeNull();
  });

  it('excluir exige confirmação em duas etapas e permite cancelar', async () => {
    const fake = setup();
    let removed = false;
    fake.on(`GET /api/jobs/${JOB_ID}/resumes`, () =>
      listBody(removed ? [] : [makeResume([draft, approved])]),
    );
    fake.on(`DELETE /api/resumes/${RESUME_ID}`, () => {
      removed = true;
      return jsonResponse(200, deleteResumeResponseSchema.parse({ deleted: true, id: RESUME_ID }));
    });
    const { user, container } = renderApp(`/vagas/${JOB_ID}`);
    const section = await findSection();

    await user.click(await within(section).findByRole('button', { name: /^Excluir…/ }));
    const dialog = within(section).getByRole('alertdialog', {
      name: 'Excluir este currículo e todas as suas versões?',
    });
    expect(fake.requestsTo(`DELETE /api/resumes/${RESUME_ID}`)).toHaveLength(0);
    expect(await violations(container)).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(within(section).queryByRole('alertdialog')).toBeNull();
    expect(fake.requestsTo(`DELETE /api/resumes/${RESUME_ID}`)).toHaveLength(0);

    await user.click(within(section).getByRole('button', { name: /^Excluir…/ }));
    await user.click(
      within(within(section).getByRole('alertdialog')).getByRole('button', {
        name: 'Excluir definitivamente',
      }),
    );
    await waitFor(() => {
      expect(fake.requestsTo(`DELETE /api/resumes/${RESUME_ID}`)).toHaveLength(1);
    });
    expect(await within(section).findByText(/Nenhum currículo gerado/)).toBeInTheDocument();
  });
});
