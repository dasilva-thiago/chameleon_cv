import {
  resumeContentSchema,
  resumeVersionResponseSchema,
  updateResumeVersionRequestSchema,
  type ResumeContent,
  type ResumeVersionDetail,
} from '@chameleon/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { violations } from './helpers/axe';
import { FakeApi, errorResponse, jsonResponse, makeSession } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';
import {
  EXPERIENCE_ID,
  GAP_ISSUE,
  JOB_ID,
  RESUME_ID,
  V1,
  V2,
  V3,
  WARNING_ISSUE,
  contentWithGap,
  installProfile,
  makeContent,
  makeResume,
  makeVersion,
  reconcile,
  resumeBody,
  versionBody,
} from './helpers/resume-fixtures';

const VERSION_ROUTE = (id: string): string => `/api/resumes/${RESUME_ID}/versions/${id}`;
const editorUrl = (id: string): string => `/curriculos/${RESUME_ID}/versoes/${id}`;

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

/** Servidor falso com o perfil, o currículo e a versão; o PUT guarda e devolve o conteúdo recebido. */
function setup(version: ResumeVersionDetail = makeVersion()) {
  const fake = new FakeApi().install();
  fake.session = makeSession();
  installProfile(fake);
  let current = version;
  fake.on(`GET /api/resumes/${RESUME_ID}`, () => resumeBody(makeResume([current])));
  fake.on(`GET ${VERSION_ROUTE(version.id)}`, () => versionBody(current));
  fake.on(`PUT ${VERSION_ROUTE(version.id)}`, (request) => {
    const body = updateResumeVersionRequestSchema.parse(request.body);
    current = makeVersion({
      id: version.id,
      versionNumber: version.versionNumber,
      issues: [],
      content: reconcile(current.content, body.content),
    });
    return versionBody(current);
  });
  return fake;
}

const region = (name: string): HTMLElement => screen.getByRole('region', { name });
const entryOf = (name: string): HTMLElement => screen.getByRole('group', { name });

function itemRow(scope: HTMLElement, label: string): HTMLElement {
  const row = within(scope).getByLabelText(label).closest('li');
  if (row === null) throw new Error(`item not found: ${label}`);
  return row;
}

async function openEditor(id = V1) {
  const view = renderApp(editorUrl(id));
  await screen.findByRole('button', { name: 'Salvar rascunho' });
  return view;
}

function savedContent(fake: FakeApi): ResumeContent {
  const body = fake.requestsTo(`PUT ${VERSION_ROUTE(V1)}`).at(-1)?.body;
  return resumeContentSchema.parse(updateResumeVersionRequestSchema.parse(body).content);
}

describe('editor de currículo: rascunho', () => {
  it('mostra cabeçalho, seções, origem, fontes resolvidas e problemas ao lado do item', async () => {
    setup(makeVersion({ issues: [GAP_ISSUE], content: contentWithGap() }));
    const { container } = await openEditor();

    expect(screen.getByRole('heading', { level: 1, name: 'Dev Backend — Acme' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Voltar à vaga' })).toHaveAttribute(
      'href',
      `/vagas/${JOB_ID}`,
    );
    expect(screen.getByLabelText(/^Nome/)).toHaveValue('Ana Teste');
    expect(screen.getByLabelText('Título profissional')).toHaveValue('Desenvolvedora Backend');
    expect(screen.getByLabelText('Localização')).toHaveValue('São Paulo, SP');
    expect(screen.getByRole('list', { name: 'Contatos' })).toHaveTextContent(
      'E-mail: ana@example.com',
    );

    // resumo de problemas
    expect(screen.getByText(/Verificação de fontes:/)).toHaveTextContent('1 erro e 0 avisos');

    const entry = entryOf('Dev Backend — Acme');
    expect(within(entry).getByLabelText('Título da entrada')).toHaveValue('Dev Backend — Acme');
    expect(within(entry).getByLabelText('Período')).toHaveValue('2020-01 – atual');
    // fontes resolvidas com link para a seção do perfil
    expect(
      await within(entry).findByRole('link', { name: 'Experiência: Dev Backend — Acme' }),
    ).toHaveAttribute('href', '/perfil/experiencias');
    expect(
      within(entry).getByRole('link', {
        name: 'Item de experiência: Construí APIs REST em Node.js.',
      }),
    ).toHaveAttribute('href', '/perfil/experiencias');

    // o item sem fonte resolvida mostra o problema do servidor ao lado
    const gapItem = itemRow(entry, 'Item 2');
    expect(within(gapItem).getByText('registro não encontrado')).toBeVisible();
    expect(gapItem).toHaveTextContent('Erro: O item cita um registro que não existe no perfil.');
    expect(within(gapItem).getByText('Editado')).toBeVisible();
    expect(itemRow(entry, 'Item 1')).not.toHaveTextContent('Erro:');
    expect(within(region('Competências')).getAllByText('Gerado')).toHaveLength(2);

    expect(await violations(container)).toEqual([]);
  });

  it('salvar só habilita com alterações, envia o conteúdo editado e adota a resposta do servidor', async () => {
    const fake = setup();
    const { user } = await openEditor();
    const save = screen.getByRole('button', { name: 'Salvar rascunho' });
    expect(save).toBeDisabled();

    const entry = entryOf('Dev Backend — Acme');
    const bullet = within(entry).getByLabelText('Item 1');
    await user.clear(bullet);
    await user.type(bullet, 'Construí APIs em Node.js.');
    await user.type(within(entry).getByLabelText('Subtítulo'), 'Time de plataforma');
    await user.clear(within(entry).getByLabelText('Período'));

    expect(save).toBeEnabled();
    expect(screen.getByText('Há alterações não salvas.')).toBeVisible();
    // a origem exibida já reflete a regra do servidor
    expect(within(itemRow(entry, 'Item 1')).getByText('Editado')).toBeVisible();

    await user.click(save);
    await waitFor(() => {
      expect(fake.requestsTo(`PUT ${VERSION_ROUTE(V1)}`)).toHaveLength(1);
    });
    const expected = makeContent();
    const experience = expected.sections[2]?.entries[0];
    const first = experience?.bullets[0];
    if (experience === undefined || first === undefined) throw new Error('fixture');
    experience.bullets[0] = { ...first, text: 'Construí APIs em Node.js.' };
    experience.subheading = 'Time de plataforma';
    experience.period = null;
    expect(savedContent(fake)).toEqual(expected);

    expect(await screen.findByText('Rascunho salvo.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();
    expect(within(entry).getByLabelText('Período')).toHaveValue('');
  });

  it('adicionar item cria um item vazio "Adicionado", bloqueia o salvamento até preencher e herda as fontes da entrada', async () => {
    const fake = setup();
    const { user } = await openEditor();
    const entry = entryOf('Dev Backend — Acme');
    await user.click(within(entry).getByRole('button', { name: 'Adicionar item' }));

    const added = within(entry).getByLabelText('Item 2');
    expect(within(itemRow(entry, 'Item 2')).getByText('Adicionado')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText('O texto não pode ficar vazio.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Corrija os campos antes de salvar');
    expect(fake.requestsTo(`PUT ${VERSION_ROUTE(V1)}`)).toHaveLength(0);

    await user.type(added, 'Reduzi o tempo de resposta das APIs.');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => {
      expect(fake.requestsTo(`PUT ${VERSION_ROUTE(V1)}`)).toHaveLength(1);
    });
    const bullets = savedContent(fake).sections[2]?.entries[0]?.bullets ?? [];
    expect(bullets).toHaveLength(2);
    expect(bullets[1]).toEqual({
      id: expect.stringMatching(/^[a-z0-9][a-z0-9-]{0,39}$/) as string,
      text: 'Reduzi o tempo de resposta das APIs.',
      sourceIds: [EXPERIENCE_ID],
      origin: 'added',
    });
  });

  it('remove item, entrada, seção e contato e envia o conteúdo sem eles', async () => {
    const fake = setup();
    const { user } = await openEditor();

    await user.click(
      within(entryOf('Tecnologias e competências')).getByRole('button', { name: 'Remover item 1' }),
    );
    expect(screen.getByText('Item 1 removido.')).toBeInTheDocument();
    await user.click(within(entryOf('Resumo')).getByRole('button', { name: 'Remover entrada' }));
    await user.click(within(region('Experiência')).getByRole('button', { name: 'Remover seção' }));
    expect(screen.queryByRole('region', { name: 'Experiência' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Remover contato/ }));
    expect(screen.getByText('Nenhum contato neste currículo.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => {
      expect(fake.requestsTo(`PUT ${VERSION_ROUTE(V1)}`)).toHaveLength(1);
    });
    const content = savedContent(fake);
    expect(content.header.contacts).toEqual([]);
    expect(content.sections.map((section) => section.id)).toEqual(['summary', 'skills']);
    expect(content.sections[0]?.entries).toEqual([]);
    expect(content.sections[1]?.entries[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Node.js',
    ]);
  });

  it('pré-visualizar mostra o documento (sem fontes), inclui alterações não salvas e passa no axe', async () => {
    setup();
    const { user, container } = await openEditor();
    const edit = screen.getByRole('button', { name: 'Editar' });
    const preview = screen.getByRole('button', { name: 'Pré-visualizar' });
    expect(edit).toHaveAttribute('aria-pressed', 'true');

    await user.type(screen.getByLabelText('Localização'), ' (remoto)');
    await user.click(preview);
    expect(preview).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);

    const article = screen.getByRole('article', { name: 'Pré-visualização do currículo' });
    expect(within(article).getByRole('heading', { level: 2, name: 'Ana Teste' })).toBeVisible();
    expect(within(article).getByText('Desenvolvedora Backend')).toBeVisible();
    expect(within(article).getByText('São Paulo, SP (remoto)')).toBeVisible();
    expect(within(article).getByText('ana@example.com')).toBeVisible();
    expect(within(article).getByRole('heading', { level: 3, name: 'Competências' })).toBeVisible();
    // competências em uma linha separada por pontos
    expect(within(article).getByText('TypeScript · Node.js')).toBeVisible();
    expect(
      within(article).getByRole('heading', { level: 4, name: 'Dev Backend — Acme' }),
    ).toBeVisible();
    expect(within(article).getByText('2020-01 – atual')).toBeVisible();
    expect(within(article).getByText('Construí APIs REST em Node.js.')).toBeVisible();
    expect(within(article).queryByText(/Fontes/)).toBeNull();
    expect(screen.getByText(/inclui alterações ainda não salvas/)).toBeVisible();
    expect(await violations(container)).toEqual([]);

    await user.click(edit);
    expect(screen.getByLabelText('Localização')).toHaveValue('São Paulo, SP (remoto)');
  });
});

describe('editor de currículo: aprovação', () => {
  it('aprovar sem alterações não salva antes, envia a aprovação e passa ao modo somente leitura', async () => {
    const fake = setup();
    fake.on(`POST ${VERSION_ROUTE(V1)}/approve`, versionBody(makeVersion({ status: 'approved' })));
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Aprovar versão' }));
    expect(await screen.findByText('Versão aprovada')).toBeVisible();
    expect(fake.requestsTo(`PUT ${VERSION_ROUTE(V1)}`)).toHaveLength(0);
    expect(fake.requestsTo(`POST ${VERSION_ROUTE(V1)}/approve`)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Baixar DOCX/ })).toBeEnabled();
  });

  it('aprovar com alterações salva primeiro e só então aprova', async () => {
    const fake = setup();
    fake.on(`POST ${VERSION_ROUTE(V1)}/approve`, versionBody(makeVersion({ status: 'approved' })));
    const { user } = await openEditor();
    await user.type(screen.getByLabelText('Localização'), '!');
    await user.click(screen.getByRole('button', { name: 'Aprovar versão' }));
    await screen.findByText('Versão aprovada');

    const order = fake.requests
      .filter((request) => request.method !== 'GET')
      .map((request) => `${request.method} ${request.path}`);
    expect(order).toEqual([`PUT ${VERSION_ROUTE(V1)}`, `POST ${VERSION_ROUTE(V1)}/approve`]);
  });

  it('409 RESUME_INVALID lista os problemas que bloqueiam, com a localização em palavras', async () => {
    const fake = setup(makeVersion({ issues: [GAP_ISSUE], content: contentWithGap() }));
    fake.on(
      `POST ${VERSION_ROUTE(V1)}/approve`,
      errorResponse(409, 'RESUME_INVALID', {
        details: [{ path: GAP_ISSUE.path, message: GAP_ISSUE.message }],
      }),
    );
    const { user } = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Aprovar versão' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('O currículo tem itens sem fonte confirmada');
    expect(alert).toHaveTextContent(
      'Seção "Experiência", entrada "Dev Backend — Acme", item 2: O item cita um registro que não existe no perfil.',
    );
    // continua em modo de edição para corrigir
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeVisible();
  });

  it('avisos pedem confirmação "Revisei os avisos" antes de aprovar, mas não bloqueiam', async () => {
    const fake = setup(makeVersion({ issues: [WARNING_ISSUE] }));
    fake.on(
      `POST ${VERSION_ROUTE(V1)}/approve`,
      versionBody(makeVersion({ status: 'approved', issues: [WARNING_ISSUE] })),
    );
    const { user } = await openEditor();

    expect(itemRow(entryOf('Dev Backend — Acme'), 'Item 1')).toHaveTextContent(
      'Aviso: O texto menciona termos que não aparecem',
    );
    const approve = screen.getByRole('button', { name: 'Aprovar versão' });
    expect(approve).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Revisei os avisos' }));
    expect(approve).toBeEnabled();
    await user.click(approve);
    expect(await screen.findByText('Versão aprovada')).toBeVisible();
    expect(fake.requestsTo(`POST ${VERSION_ROUTE(V1)}/approve`)).toHaveLength(1);
  });

  it('se salvar antes de aprovar gerar avisos novos, não aprova e pede a revisão', async () => {
    const fake = setup();
    fake.on(`PUT ${VERSION_ROUTE(V1)}`, versionBody(makeVersion({ issues: [WARNING_ISSUE] })));
    const { user } = await openEditor();

    await user.type(screen.getByLabelText('Localização'), '!');
    await user.click(screen.getByRole('button', { name: 'Aprovar versão' }));

    expect(await screen.findByText(/há avisos novos/)).toBeVisible();
    expect(fake.requestsTo(`POST ${VERSION_ROUTE(V1)}/approve`)).toHaveLength(0);
    expect(screen.getByRole('checkbox', { name: 'Revisei os avisos' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Aprovar versão' })).toBeDisabled();
  });

  it('salvar uma versão que foi aprovada em outra aba explica o motivo', async () => {
    const fake = setup();
    fake.on(`PUT ${VERSION_ROUTE(V1)}`, errorResponse(409, 'VERSION_APPROVED'));
    const { user } = await openEditor();
    await user.type(screen.getByLabelText('Localização'), '!');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta versão já foi aprovada e não pode ser alterada.',
    );
  });
});

describe('editor de currículo: versão aprovada', () => {
  const approved = makeVersion({ id: V2, versionNumber: 2, status: 'approved' });

  it('é somente leitura, explica o motivo e oferece downloads e nova versão', async () => {
    const fake = setup(approved);
    const created = makeVersion({ id: V3, versionNumber: 3 });
    fake.on(
      `POST /api/resumes/${RESUME_ID}/versions`,
      jsonResponse(201, resumeVersionResponseSchema.parse({ version: created })),
    );
    fake.on(`GET ${VERSION_ROUTE(V3)}`, versionBody(created));
    const { user, container } = renderApp(editorUrl(V2));

    expect(await screen.findByText('Versão aprovada')).toBeVisible();
    expect(screen.getByText(/não pode ser alterada/)).toBeVisible();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aprovar versão' })).toBeNull();
    expect(
      screen.getByRole('article', { name: 'Pré-visualização do currículo' }),
    ).toHaveTextContent('Construí APIs REST em Node.js.');
    expect(screen.getByRole('button', { name: /^Baixar DOCX/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Baixar PDF/ })).toBeEnabled();
    expect(await violations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Criar nova versão para editar' }));
    expect(await screen.findByRole('button', { name: 'Salvar rascunho' })).toBeVisible();
    expect(fake.requestsTo(`POST /api/resumes/${RESUME_ID}/versions`)[0]?.body).toEqual({
      fromVersionId: V2,
    });
    expect(screen.getByTestId('location')).toHaveTextContent(editorUrl(V3));
  });

  it('o botão de download baixa o arquivo da versão aprovada', async () => {
    const fake = setup(approved);
    fake.on(
      `GET ${VERSION_ROUTE(V2)}/export?format=pdf`,
      () =>
        new Response(new Blob(['pdf'], { type: 'application/pdf' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="curriculo-v2.pdf"',
          },
        }),
    );
    const { user } = renderApp(editorUrl(V2));
    await user.click(await screen.findByRole('button', { name: /^Baixar PDF/ }));
    await waitFor(() => {
      expect(downloads).toEqual(['curriculo-v2.pdf']);
    });
  });
});

describe('editor de currículo: erros de carregamento', () => {
  it('versão inexistente explica e oferece o caminho de volta', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    installProfile(fake);
    fake.on(`GET /api/resumes/${RESUME_ID}`, errorResponse(404, 'NOT_FOUND'));
    fake.on(`GET ${VERSION_ROUTE(V1)}`, errorResponse(404, 'NOT_FOUND'));
    renderApp(editorUrl(V1));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta versão não foi encontrada');
    expect(screen.getByRole('link', { name: 'Voltar às vagas' })).toHaveAttribute('href', '/vagas');
  });
});
