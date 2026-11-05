import {
  applyImportResponseSchema,
  discardImportResponseSchema,
  evidenceListResponseSchema,
  evidenceLinksResponseSchema,
  importPreviewResponseSchema,
  pendingListResponseSchema,
  profileDocumentSchema,
  profileStateResponseSchema,
  type ProfileStateResponse,
} from '@chameleon/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, errorResponse, jsonResponse, makeSession } from './helpers/fake-api';
import { violations } from './helpers/axe';
import { renderApp } from './helpers/render-app';

const ID = (n: number): string => `0190a8f0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SKILL_ID = ID(1);
const EVIDENCE_ID = ID(2);
const IMPORT_ID = ID(3);

const ZERO_SUMMARY = {
  recordCount: 0,
  byStatus: { confirmed: 0, needs_review: 0, conflicting: 0, archived: 0 },
  pending: { open: 0, resolved: 0, dismissed: 0 },
  evidenceCount: 0,
  byKind: {},
};

function emptyState(): ProfileStateResponse {
  return profileStateResponseSchema.parse({
    exists: false,
    profile: null,
    document: null,
    summary: ZERO_SUMMARY,
  });
}

function filledState(): ProfileStateResponse {
  const document = profileDocumentSchema.parse({
    schema_version: '2.1.0',
    profile: {
      skills: [
        {
          id: SKILL_ID,
          name: 'TypeScript',
          meta: { status: 'needs_review' },
        },
      ],
      evidence: [{ id: EVIDENCE_ID, type: 'repository', title: 'Repositório de exemplo' }],
    },
  });
  return profileStateResponseSchema.parse({
    exists: true,
    profile: {
      id: ID(9),
      storedSchemaVersion: '2.1.0',
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
    },
    document,
    summary: {
      ...ZERO_SUMMARY,
      recordCount: 2,
      byStatus: { confirmed: 0, needs_review: 1, conflicting: 0, archived: 0 },
      evidenceCount: 1,
      byKind: { skill: 1, evidence: 1 },
    },
  });
}

const REVISION = {
  id: ID(7),
  revisionNumber: 2,
  schemaVersion: '2.1.0',
  contentHash: 'a'.repeat(64),
  reason: 'import',
  createdAt: '2026-11-05T10:05:00.000Z',
};

function importRecord(status: 'preview' | 'applied' | 'discarded', errors: unknown[] = []) {
  return {
    id: IMPORT_ID,
    status,
    sourceFormat: 'yaml',
    sourceSchemaVersion: '2.1.0',
    targetSchemaVersion: '2.1.0',
    mode: 'strict',
    steps: [],
    warnings: [],
    errors,
    idMap: {},
    unmappedCount: 0,
    summary: {},
    revisionId: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    appliedAt: null,
  };
}

function previewBody(options: { errors?: unknown[]; records?: number } = {}) {
  const records = options.records ?? 2;
  return importPreviewResponseSchema.parse({
    importRecord: importRecord('preview', options.errors),
    preview: {
      source_schema_version: '2.1.0',
      target_schema_version: '2.1.0',
      totals: {
        records,
        create: records,
        update: 0,
        unchanged: 0,
        discarded: 0,
        needs_review: records,
      },
      collections: {},
      singletons: {},
      records: Array.from({ length: records }, (_, i) => ({
        kind: 'skill',
        id: ID(100 + i),
        path: `profile.skills[${String(i)}]`,
        label: `skill #${String(i + 1)}`,
        action: 'create',
        changed_fields: [],
        declared_status: null,
      })),
      discarded: [],
      warnings_by_code: {},
      unmapped_count: 0,
      untouched_existing: 3,
    },
    warnings: [
      {
        code: 'STATUS_SET_NEEDS_REVIEW',
        severity: 'info',
        path: 'profile.skills[0]',
        message: 'Item marcado para revisão.',
      },
    ],
    unmapped: [],
    expiresAt: '2099-01-01T12:00:00.000Z',
  });
}

const ZERO_APPLY_SUMMARY = {
  created: {},
  updated: {},
  unchanged: {},
  archived: {},
  deleted: {},
  kept: {},
  totals: { created: 2, updated: 0, unchanged: 0, archived: 0, deleted: 0, kept: 3 },
};

function applyBody() {
  return applyImportResponseSchema.parse({
    importRecord: importRecord('applied'),
    save: {
      profileCreated: false,
      summary: ZERO_APPLY_SUMMARY,
      generatedIds: 0,
      revision: { revision: REVISION, reused: false },
    },
    revision: { revision: REVISION, reused: false },
    previousRevision: null,
    idRemapCount: 0,
    summary: filledState().summary,
  });
}

function loggedIn(state: ProfileStateResponse | Response = emptyState()): FakeApi {
  const fake = new FakeApi().install();
  fake.session = makeSession();
  fake.on(
    'GET /api/profile',
    state instanceof Response ? state : jsonResponse(200, profileStateResponseSchema.parse(state)),
  );
  return fake;
}

describe('perfil: visao geral e navegacao', () => {
  it('perfil vazio orienta o inicio sem tratar como erro e liga a importacao', async () => {
    loggedIn();
    const { user } = renderApp('/perfil');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Perfil profissional' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Por onde começar' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Seções do perfil' });
    await user.click(within(nav).getByRole('link', { name: 'Importar arquivo' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Importar arquivo' }),
    ).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/perfil/importar');
  });

  it('a Home liga ao perfil e o menu principal tem Perfil', async () => {
    loggedIn();
    const { user } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Início' });
    const main = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(main).getAllByRole('link')).toHaveLength(4);
    await user.click(screen.getByRole('link', { name: 'Abrir meu perfil' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Perfil profissional' }),
    ).toBeVisible();
  });

  it('sem consentimento a API recusa e a tela explica sem expor o perfil', async () => {
    loggedIn(errorResponse(403, 'CONSENT_REQUIRED_FOR_PROFILE'));
    renderApp('/perfil');
    expect(
      await screen.findByText('Falta a autorização para tratar os dados do perfil'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Seções do perfil' })).not.toBeInTheDocument();
  });

  it('uma secao existente abre e uma secao desconhecida volta a visao geral', async () => {
    loggedIn(filledState());
    renderApp('/perfil/competencias');
    expect(await screen.findByRole('heading', { level: 1, name: 'Competências' })).toBeVisible();
  });

  it('o formulario de uma secao abre, mostra o essencial e nao tem violacoes (axe)', async () => {
    loggedIn(filledState());
    const { user, container } = renderApp('/perfil/competencias');
    await screen.findByRole('heading', { level: 1, name: 'Competências' });
    expect(await screen.findByText('TypeScript')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Adicionar/ }));
    expect(await screen.findByRole('form')).toBeVisible();
    expect(await violations(container)).toEqual([]);
  });

  it('pendencias: lista vazia acessivel', async () => {
    const fake = loggedIn(filledState());
    fake.on(
      'GET /api/profile/pending?status=open',
      jsonResponse(
        200,
        pendingListResponseSchema.parse({
          pending: [],
          counts: { open: 0, resolved: 0, dismissed: 0 },
        }),
      ),
    );
    const { container } = renderApp('/perfil/pendencias');
    expect(await screen.findByText(/Nenhuma pendência/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it('a visao geral e a secao nao tem violacoes de acessibilidade (axe)', async () => {
    loggedIn(filledState());
    const { container } = renderApp('/perfil');
    await screen.findByRole('heading', { level: 1, name: 'Perfil profissional' });
    expect(await violations(container)).toEqual([]);
  });
});

describe('perfil: importacao com previa', () => {
  async function toPreview(fake: FakeApi, user: ReturnType<typeof renderApp>['user']) {
    fake.on('POST /api/profile/imports/preview', jsonResponse(201, previewBody()));
    await screen.findByRole('heading', { level: 1, name: 'Importar arquivo' });
    const button = screen.getByRole('button', { name: 'Gerar prévia' });
    expect(button).toBeDisabled();
    await user.click(screen.getByLabelText(/Ou cole o conteúdo aqui/));
    await user.paste('schema_version: "2.1.0"');
    await user.click(button);
    await screen.findByText('Prévia: nada foi gravado ainda');
  }

  it('gera a previa, mostra totais e avisos e aplica em modo mesclar', async () => {
    const fake = loggedIn();
    fake.on(`POST /api/profile/imports/${IMPORT_ID}/apply`, jsonResponse(200, applyBody()));
    const { user, container } = renderApp('/perfil/importar');
    await toPreview(fake, user);

    const sent = fake.requestsTo('POST /api/profile/imports/preview')[0]!;
    expect(sent.body).toEqual({ format: 'auto', text: 'schema_version: "2.1.0"', mode: 'strict' });
    expect(screen.getByText('Item marcado para revisão.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Avisos (1)' })).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Aplicar importação' }));
    expect(await screen.findByText('Importação aplicada')).toBeInTheDocument();
    const applied = fake.requestsTo(`POST /api/profile/imports/${IMPORT_ID}/apply`)[0];
    expect(applied?.body).toEqual({
      mode: 'merge',
      confirmReplace: false,
      regenerateConflictingIds: false,
    });
    expect(screen.getByRole('link', { name: 'Revisar itens importados' })).toHaveAttribute(
      'href',
      '/perfil/confirmar',
    );
  });

  it('substituir exige confirmacao explicita antes de habilitar a aplicacao', async () => {
    const fake = loggedIn();
    fake.on(`POST /api/profile/imports/${IMPORT_ID}/apply`, jsonResponse(200, applyBody()));
    const { user } = renderApp('/perfil/importar');
    await toPreview(fake, user);

    await user.click(screen.getByRole('radio', { name: /Substituir/ }));
    const apply = screen.getByRole('button', { name: 'Aplicar importação' });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /remove itens que não estão/ }));
    expect(apply).toBeEnabled();
    await user.click(apply);
    await screen.findByText('Importação aplicada');
    expect(fake.requestsTo(`POST /api/profile/imports/${IMPORT_ID}/apply`)[0]?.body).toMatchObject({
      mode: 'replace',
      confirmReplace: true,
    });
  });

  it('descartar nao altera o perfil e permite importar outro arquivo', async () => {
    const fake = loggedIn();
    fake.on(
      `POST /api/profile/imports/${IMPORT_ID}/discard`,
      jsonResponse(
        200,
        discardImportResponseSchema.parse({ importRecord: importRecord('discarded') }),
      ),
    );
    const { user } = renderApp('/perfil/importar');
    await toPreview(fake, user);
    await user.click(screen.getByRole('button', { name: 'Descartar prévia' }));
    expect(await screen.findByText(/Nada foi alterado no seu perfil/)).toBeInTheDocument();
    expect(fake.requestsTo(`POST /api/profile/imports/${IMPORT_ID}/apply`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Importar outro arquivo' }));
    expect(screen.getByRole('button', { name: 'Gerar prévia' })).toBeInTheDocument();
  });

  it('arquivo com erros mostra os motivos e nao pode ser aplicado', async () => {
    const fake = loggedIn();
    fake.on(
      'POST /api/profile/imports/preview',
      jsonResponse(
        201,
        previewBody({
          errors: [
            { path: 'profile.skills[0].name', code: 'REQUIRED', message: 'Campo obrigatório.' },
          ],
        }),
      ),
    );
    const { user } = renderApp('/perfil/importar');
    await screen.findByRole('heading', { level: 1, name: 'Importar arquivo' });
    await user.click(screen.getByLabelText(/Ou cole o conteúdo aqui/));
    await user.paste('x: 1');
    await user.click(screen.getByRole('button', { name: 'Gerar prévia' }));
    expect(await screen.findByText('O arquivo tem erros e não pode ser aplicado')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aplicar importação' })).toBeDisabled();
  });

  it('falha da API na previa vira alerta e preserva o texto digitado', async () => {
    const fake = loggedIn();
    fake.on('POST /api/profile/imports/preview', errorResponse(413, 'PAYLOAD_TOO_LARGE'));
    const { user } = renderApp('/perfil/importar');
    await screen.findByRole('heading', { level: 1, name: 'Importar arquivo' });
    const area = screen.getByLabelText(/Ou cole o conteúdo aqui/);
    await user.click(area);
    await user.paste('conteudo grande');
    await user.click(screen.getByRole('button', { name: 'Gerar prévia' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(area).toHaveValue('conteudo grande');
  });
});

describe('perfil: evidencias', () => {
  it('lista a evidencia, vincula a um fato e passa no axe', async () => {
    const fake = loggedIn(filledState());
    let links: { recordId: string; kind: string }[] = [];
    const list = () =>
      jsonResponse(
        200,
        evidenceListResponseSchema.parse({
          evidence: [
            {
              record: { id: EVIDENCE_ID, type: 'repository', title: 'Repositório de exemplo' },
              links,
            },
          ],
        }),
      );
    fake.on('GET /api/profile/evidence', () => list());
    fake.on(`POST /api/profile/evidence/${EVIDENCE_ID}/links`, () => {
      links = [{ recordId: SKILL_ID, kind: 'skill' }];
      return jsonResponse(
        200,
        evidenceLinksResponseSchema.parse({ evidenceId: EVIDENCE_ID, links }),
      );
    });
    const { user, container } = renderApp('/perfil/evidencias');
    expect(await screen.findByRole('heading', { name: 'Repositório de exemplo' })).toBeVisible();
    expect(screen.getByText('Ainda não vinculada a nenhum item.')).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);

    await user.selectOptions(screen.getByLabelText(/Vincular/), SKILL_ID);
    await user.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Desvincular/ })).toBeInTheDocument();
    });
    expect(fake.requestsTo(`POST /api/profile/evidence/${EVIDENCE_ID}/links`)[0]?.body).toEqual({
      recordId: SKILL_ID,
    });
  });
});
