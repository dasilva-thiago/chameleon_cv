import { screen, waitFor, render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../src/app/App';
import { createAppQueryClient } from '../src/features/auth/session';
import { PROFILE_POLICY_VERSION, resolvePolicyVersion } from '../src/lib/config';
import {
  FakeApi,
  INVITE_TOKEN,
  TEST_EMAIL,
  errorResponse,
  makeSession,
  previewResponse,
  sessionResponse,
} from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

const PASSWORD = 'uma-senha-bem-longa-123';
const INVITE_ROUTE = `/accept-invite#token=${INVITE_TOKEN}`;

function setupHappyPath() {
  const fake = new FakeApi().install();
  fake.on('POST /api/auth/invites/preview', previewResponse());
  fake.on('POST /api/auth/invites/accept', () => {
    fake.session = makeSession({ displayName: 'Bia Souza' });
    return sessionResponse(fake.session, 201);
  });
  return fake;
}

const CONSENT_NAME = /Autorizo o tratamento dos dados/;

/** Fills both password fields and, unless disabled, ticks the mandatory profile consent. */
async function fillPasswords(
  user: ReturnType<typeof userEvent.setup>,
  { consent = true }: { consent?: boolean } = {},
) {
  await user.type(await screen.findByLabelText(/^Senha/), PASSWORD);
  await user.type(screen.getByLabelText(/^Confirme a senha/), PASSWORD);
  if (consent) await user.click(screen.getByRole('checkbox', { name: CONSENT_NAME }));
}

describe('aceite de convite: token no fragmento', () => {
  it('le o token do fragmento, consulta o preview por POST e mostra o e-mail do convite', async () => {
    const fake = setupHappyPath();
    renderApp(INVITE_ROUTE);

    expect(await screen.findByLabelText(/E-mail do convite/)).toHaveValue(TEST_EMAIL);
    expect(screen.getByLabelText(/E-mail do convite/)).toHaveAttribute('readonly');
    const previews = fake.requestsTo('POST /api/auth/invites/preview');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.body).toEqual({ token: INVITE_TOKEN });
  });

  it('limpa o fragmento da URL real (history.replaceState) depois de ler o token', async () => {
    setupHappyPath();
    window.history.replaceState(null, '', `/accept-invite#token=${INVITE_TOKEN}`);
    expect(window.location.hash).toContain(INVITE_TOKEN);

    render(
      <BrowserRouter>
        <QueryClientProvider client={createAppQueryClient()}>
          <AppRoutes />
        </QueryClientProvider>
      </BrowserRouter>,
    );

    expect(await screen.findByLabelText(/E-mail do convite/)).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.hash).toBe('');
    });
    expect(window.location.href).not.toContain(INVITE_TOKEN);
    expect(window.location.pathname).toBe('/accept-invite');
    // O formulario continua utilizavel mesmo depois de a URL ter sido limpa.
    expect(screen.getByLabelText(/^Senha/)).toBeInTheDocument();
  });

  it('nunca envia o token em URL ou query string e nao o grava em storage', async () => {
    const fake = setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    await screen.findByRole('heading', { level: 1, name: 'Início' });

    for (const request of fake.requests) {
      expect(request.path).not.toContain(INVITE_TOKEN);
      // the auth/invite endpoints never take a query string (the home's job list legitimately does)
      if (request.path.startsWith('/api/auth')) expect(request.path).not.toContain('?');
    }
    expect(JSON.stringify({ ...localStorage })).not.toContain(INVITE_TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(INVITE_TOKEN);
    expect(document.title).not.toContain(INVITE_TOKEN);
  });

  it('sem token no fragmento mostra convite invalido e nao chama a API de convites', async () => {
    const fake = setupHappyPath();
    renderApp('/accept-invite');
    expect(await screen.findByText('Convite inválido ou expirado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
    expect(fake.requestsTo('POST /api/auth/invites/preview')).toHaveLength(0);
  });

  it('ignora token na query string (somente o fragmento e aceito)', async () => {
    const fake = setupHappyPath();
    renderApp(`/accept-invite?token=${INVITE_TOKEN}`);
    expect(await screen.findByText('Convite inválido ou expirado')).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.path.includes('invites'))).toHaveLength(0);
  });

  it('token malformado nao gera chamada a API', async () => {
    const fake = setupHappyPath();
    renderApp('/accept-invite#token=curto');
    expect(await screen.findByText('Convite inválido ou expirado')).toBeInTheDocument();
    expect(fake.requestsTo('POST /api/auth/invites/preview')).toHaveLength(0);
  });
});

describe('aceite de convite: estados do preview', () => {
  it('mostra carregamento e depois o formulario', async () => {
    const fake = new FakeApi().install();
    let release: () => void = () => undefined;
    fake.on(
      'POST /api/auth/invites/preview',
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(previewResponse());
          };
        }),
    );
    renderApp(INVITE_ROUTE);
    expect(await screen.findByRole('status')).toHaveTextContent('Verificando convite');
    release();
    expect(await screen.findByLabelText(/E-mail do convite/)).toBeInTheDocument();
  });

  it('convite invalido, expirado ou usado recebe a mesma mensagem generica', async () => {
    const fake = new FakeApi().install();
    fake.on('POST /api/auth/invites/preview', errorResponse(400, 'INVITE_INVALID'));
    renderApp(INVITE_ROUTE);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Convite inválido ou expirado');
    expect(screen.queryByLabelText(/^Senha/)).not.toBeInTheDocument();
  });

  it('falha de rede no preview permite tentar novamente', async () => {
    const fake = new FakeApi().install();
    let attempts = 0;
    fake.on('POST /api/auth/invites/preview', () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new TypeError('x')) : previewResponse();
    });
    const { user } = renderApp(INVITE_ROUTE);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByLabelText(/E-mail do convite/)).toBeInTheDocument();
  });

  it('429 no preview informa o limite de tentativas', async () => {
    const fake = new FakeApi().install();
    fake.on('POST /api/auth/invites/preview', errorResponse(429, 'RATE_LIMITED'));
    renderApp(INVITE_ROUTE);
    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas');
  });
});

describe('aceite de convite: formulario', () => {
  it('valida tamanho minimo e confirmacao da senha sem chamar a API', async () => {
    const fake = setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);

    await user.type(await screen.findByLabelText(/^Senha/), 'curta');
    await user.type(screen.getByLabelText(/^Confirme a senha/), 'diferente');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText(/deve ter ao menos 12 caracteres/)).toBeInTheDocument();
    expect(screen.getByText('As senhas não coincidem.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Senha/)).toHaveAttribute('aria-invalid', 'true');
    expect(fake.requestsTo('POST /api/auth/invites/accept')).toHaveLength(0);
  });

  it('exige senha e confirmacao preenchidas', async () => {
    const fake = setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    await user.click(await screen.findByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Crie uma senha.')).toBeInTheDocument();
    expect(screen.getByText('Repita a senha.')).toBeInTheDocument();
    expect(fake.requestsTo('POST /api/auth/invites/accept')).toHaveLength(0);
  });

  it('o indicador de requisitos acompanha a digitacao (texto, nao so cor)', async () => {
    setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    const list = await screen.findByRole('list', { name: 'Requisitos da senha' });
    expect(list).toHaveTextContent('Pelo menos 12 caracteres — pendente');

    await user.type(screen.getByLabelText(/^Senha/), PASSWORD);
    expect(list).toHaveTextContent('Pelo menos 12 caracteres — atendido');

    const match = screen.getByRole('list', { name: 'Confirmação da senha' });
    expect(match).toHaveTextContent('pendente');
    await user.type(screen.getByLabelText(/^Confirme a senha/), PASSWORD);
    expect(match).toHaveTextContent('atendido');
  });

  it('alterna a visibilidade das senhas', async () => {
    setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    const password = await screen.findByLabelText(/^Senha/);
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByLabelText('Mostrar senhas'));
    expect(password).toHaveAttribute('type', 'text');
  });

  it('submitting without the consent shows the error, focuses the checkbox and sends no request', async () => {
    const fake = setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user, { consent: false });
    const consent = screen.getByRole('checkbox', { name: CONSENT_NAME });
    expect(consent).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    const message = await screen.findByText(
      'Você precisa autorizar o tratamento dos dados do perfil para criar a conta.',
    );
    expect(consent).toHaveAttribute('aria-invalid', 'true');
    expect(consent.getAttribute('aria-describedby')).toContain(message.id);
    expect(consent).toHaveFocus();
    expect(fake.requestsTo('POST /api/auth/invites/accept')).toHaveLength(0);
  });

  it('ticking the consent after the error clears it and allows submitting', async () => {
    const fake = setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user, { consent: false });
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    await screen.findByText(/Você precisa autorizar o tratamento/);

    await user.click(screen.getByRole('checkbox', { name: CONSENT_NAME }));
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    await screen.findByRole('heading', { level: 1, name: 'Início' });
    expect(fake.requestsTo('POST /api/auth/invites/accept')).toHaveLength(1);
  });

  it('shows that the authorization is required and no longer calls it optional', async () => {
    setupHappyPath();
    renderApp(INVITE_ROUTE);
    expect(
      await screen.findByText(/Esta autorização é necessária para criar a conta/),
    ).toBeVisible();
    expect(screen.queryByText(/opcional para criar a conta/)).not.toBeInTheDocument();
  });

  it('sends exactly the required consent entry; an empty name is not sent', async () => {
    const fake = setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText('Olá, Bia Souza.')).toBeInTheDocument();
    const [accept] = fake.requestsTo('POST /api/auth/invites/accept');
    expect(accept?.body).toEqual({
      token: INVITE_TOKEN,
      password: PASSWORD,
      consents: [
        { purpose: 'profile_processing', granted: true, policyVersion: PROFILE_POLICY_VERSION },
      ],
    });
    expect(accept?.headers.get('X-CSRF-Token')).toMatch(/^Q{43}$/);
  });

  it('with the consent ticked, registers only profile_processing with the policy version', async () => {
    const fake = setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    await user.type(await screen.findByLabelText(/^Nome/), '  Bia Souza ');
    expect(screen.getByText(`Versão da política: ${PROFILE_POLICY_VERSION}`)).toBeInTheDocument();
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    await screen.findByRole('heading', { level: 1, name: 'Início' });
    const [accept] = fake.requestsTo('POST /api/auth/invites/accept');
    expect(accept?.body).toEqual({
      token: INVITE_TOKEN,
      password: PASSWORD,
      displayName: 'Bia Souza',
      consents: [
        { purpose: 'profile_processing', granted: true, policyVersion: PROFILE_POLICY_VERSION },
      ],
    });
    expect(JSON.stringify(accept?.body)).not.toContain('ai_processing');
  });

  it('senha fraca recusada pelo servidor aparece no campo da senha', async () => {
    const fake = setupHappyPath();
    fake.on('POST /api/auth/invites/accept', errorResponse(400, 'WEAK_PASSWORD'));
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText(/Esta senha não é aceita/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Senha/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Senha/)).toHaveFocus();
  });

  it('CONSENT_REQUIRED from the server appears on the checkbox and focuses it', async () => {
    const fake = setupHappyPath();
    fake.on('POST /api/auth/invites/accept', errorResponse(400, 'CONSENT_REQUIRED'));
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(
      await screen.findByText(
        'Para criar a conta é necessário autorizar o tratamento dos dados do perfil.',
      ),
    ).toBeInTheDocument();
    const consent = screen.getByRole('checkbox', { name: CONSENT_NAME });
    expect(consent).toHaveAttribute('aria-invalid', 'true');
    expect(consent).toHaveFocus();
    // The field error replaces the generic banner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('CONSENT_INVALID (stale policy version) shows the reload banner, not a field error', async () => {
    const fake = setupHappyPath();
    fake.acceptedPolicyVersions = ['2099-01.1'];
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O texto da política foi atualizado. Recarregue a página e tente novamente.',
    );
    expect(screen.getByRole('checkbox', { name: CONSENT_NAME })).not.toHaveAttribute(
      'aria-invalid',
    );
    expect(fake.requestsTo('POST /api/auth/invites/accept')).toHaveLength(1);
  });

  it('convite consumido entre o preview e o aceite mostra convite invalido', async () => {
    const fake = setupHappyPath();
    fake.on('POST /api/auth/invites/accept', errorResponse(400, 'INVITE_INVALID'));
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Convite inválido ou expirado')).toBeInTheDocument();
  });

  it('erro de validacao do servidor em displayName aparece no campo, sem eco do servidor', async () => {
    const fake = setupHappyPath();
    fake.on(
      'POST /api/auth/invites/accept',
      errorResponse(400, 'VALIDATION_ERROR', {
        message: 'Dados invalidos.',
        details: [{ path: 'displayName', message: 'Too big' }],
      }),
    );
    const { user } = renderApp(INVITE_ROUTE);
    await user.type(await screen.findByLabelText(/^Nome/), 'Bia');
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Informe um nome válido.')).toBeInTheDocument();
    expect(screen.queryByText(/Too big/)).not.toBeInTheDocument();
  });

  it('cadastro fechado exibe mensagem propria', async () => {
    const fake = setupHappyPath();
    fake.on('POST /api/auth/invites/accept', errorResponse(403, 'SIGNUP_CLOSED'));
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cadastro não está disponível');
  });

  it('apos criar a conta a sessao fica ativa e a rota protegida abre', async () => {
    setupHappyPath();
    const { user } = renderApp(INVITE_ROUTE);
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    await screen.findByRole('heading', { level: 1, name: 'Início' });
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });
});

describe('versao da politica de consentimento', () => {
  it('usa o padrao quando a variavel de ambiente falta ou e invalida', () => {
    expect(resolvePolicyVersion(undefined)).toBe(PROFILE_POLICY_VERSION);
    expect(resolvePolicyVersion('com espaco')).toBe(PROFILE_POLICY_VERSION);
    expect(resolvePolicyVersion('2027-01.2')).toBe('2027-01.2');
  });
});
