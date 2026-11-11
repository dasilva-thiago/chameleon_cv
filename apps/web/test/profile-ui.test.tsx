import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { violations } from './helpers/axe';
import { FakeApi, errorResponse, jsonResponse, makeSession } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

const REV_1 = '0190a8f0-0000-7000-8000-000000000c01';
const REV_2 = '0190a8f0-0000-7000-8000-000000000c02';
const HASH = 'c'.repeat(64);

const base = (cv: string, profile: string, revisionId = REV_1) => ({
  cvMarkdown: cv,
  profileMarkdown: profile,
  revisionId,
  hash: HASH,
  updatedAt: '2026-11-10T12:00:00.000Z',
});

function setup(initial: ReturnType<typeof base> | null): FakeApi {
  const fake = new FakeApi().install();
  fake.session = makeSession();
  fake.on('GET /api/profile', jsonResponse(200, { base: initial }));
  return fake;
}

describe('base profissional', () => {
  it('sem base explica o que preencher; salvar envia os dois textos e confirma', async () => {
    const fake = setup(null);
    let saved = null as ReturnType<typeof base> | null;
    fake.on('GET /api/profile', () => jsonResponse(200, { base: saved }));
    fake.on('PUT /api/profile', (request) => {
      const body = request.body as { cvMarkdown: string; profileMarkdown: string };
      saved = base(body.cvMarkdown, body.profileMarkdown);
      return jsonResponse(200, { base: saved, changed: true });
    });
    const { user, container } = renderApp('/perfil');
    expect(await screen.findByText('Comece pela sua base')).toBeVisible();
    const save = screen.getByRole('button', { name: 'Salvar base' });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('CV (Markdown)'), '# CV -- Ana');
    await user.type(screen.getByLabelText('Perfil e regras (Markdown)'), '## Alvos');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => {
      expect(fake.requestsTo('PUT /api/profile')).toHaveLength(1);
    });
    expect(fake.requestsTo('PUT /api/profile')[0]?.body).toEqual({
      cvMarkdown: '# CV -- Ana',
      profileMarkdown: '## Alvos',
    });
    expect(await violations(container)).toEqual([]);
  });

  it('mostra o histórico e restaura uma versão anterior', async () => {
    const fake = setup(base('# CV -- Ana v2', '', REV_2));
    fake.on('GET /api/profile/revisions', () =>
      jsonResponse(200, {
        revisions: [
          {
            id: REV_2,
            hash: HASH,
            cvChars: 14,
            profileChars: 0,
            createdAt: '2026-11-10T12:00:00.000Z',
          },
          {
            id: REV_1,
            hash: HASH,
            cvChars: 11,
            profileChars: 0,
            createdAt: '2026-11-09T12:00:00.000Z',
          },
        ],
      }),
    );
    fake.on(`POST /api/profile/revisions/${REV_1}/restore`, () =>
      jsonResponse(200, { base: base('# CV -- Ana', '', REV_1), changed: true }),
    );
    const { user } = renderApp('/perfil');
    expect(await screen.findByDisplayValue('# CV -- Ana v2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Ver versões' }));
    expect(await screen.findByText(/· atual/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Restaurar' }));
    await waitFor(() => {
      expect(fake.requestsTo(`POST /api/profile/revisions/${REV_1}/restore`)).toHaveLength(1);
    });
  });

  it('sem consentimento mostra o erro do servidor', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    fake.on('GET /api/profile', errorResponse(403, 'CONSENT_REQUIRED_FOR_PROFILE'));
    renderApp('/perfil');
    expect(await screen.findByText('Não foi possível carregar a base')).toBeVisible();
  });
});
