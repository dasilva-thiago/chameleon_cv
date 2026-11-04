import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FakeApi,
  TEST_EMAIL,
  TEST_PASSWORD,
  errorResponse,
  makeSession,
  sessionResponse,
} from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

async function fillAndSubmit(
  user: ReturnType<typeof renderApp>['user'],
  email = TEST_EMAIL,
  password = TEST_PASSWORD,
) {
  await user.type(await screen.findByLabelText(/^E-mail/), email);
  await user.type(screen.getByLabelText(/^Senha/), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('tela de login', () => {
  it('entra com sucesso, envia o corpo do contrato com CSRF e abre o inicio', async () => {
    const fake = new FakeApi().install();
    fake.on('POST /api/auth/login', () => {
      fake.session = makeSession();
      return sessionResponse(makeSession());
    });
    const { user } = renderApp('/login');

    await fillAndSubmit(user, '  Ana.Teste@Example.com ');

    expect(await screen.findByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
    expect(screen.getByText('Olá, Ana Teste.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    const [login] = fake.requestsTo('POST /api/auth/login');
    expect(login?.body).toEqual({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(login?.headers.get('X-CSRF-Token')).toMatch(/^Q{43}$/);
    expect(document.title).toBe('Início · ChameleonCV');
  });

  it('volta para a rota que o usuario tentava abrir antes do login', async () => {
    const fake = new FakeApi().install();
    fake.on('POST /api/auth/login', () => {
      fake.session = makeSession();
      return sessionResponse(makeSession());
    });
    const { user } = renderApp('/conta');

    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    await fillAndSubmit(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Conta' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/conta');
  });

  it('ignora destino externo ou fora do app no estado de navegacao', async () => {
    const fake = new FakeApi().install();
    fake.session = null;
    fake.on('POST /api/auth/login', () => {
      fake.session = makeSession();
      return sessionResponse(makeSession());
    });
    const { user } = renderApp({ pathname: '/login', state: { from: '//evil.example/x' } });
    await fillAndSubmit(user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
  });

  it('mostra erro generico em 401 sem revelar se o e-mail existe e limpa a senha', async () => {
    const fake = new FakeApi().install();
    fake.on(
      'POST /api/auth/login',
      errorResponse(401, 'INVALID_CREDENTIALS', { message: 'E-mail ou senha incorretos.' }),
    );
    const { user } = renderApp('/login');

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('E-mail ou senha incorretos.');
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Senha/)).toHaveValue('');
    expect(screen.getByLabelText(/^Senha/)).toHaveFocus();
    expect(screen.getByLabelText(/^E-mail/)).toHaveValue(TEST_EMAIL);
  });

  it('mostra aviso de excesso de tentativas em 429 com o tempo de espera', async () => {
    const fake = new FakeApi().install();
    fake.on(
      'POST /api/auth/login',
      errorResponse(429, 'RATE_LIMITED', { headers: { 'Retry-After': '600' } }),
    );
    const { user } = renderApp('/login');

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Muitas tentativas');
    expect(alert).toHaveTextContent('cerca de 10 minutos');
    // A senha digitada nao e apagada em erro que nao seja de credenciais.
    expect(screen.getByLabelText(/^Senha/)).toHaveValue(TEST_PASSWORD);
  });

  it('mostra mensagem de rede sem detalhes tecnicos quando o servidor nao responde', async () => {
    const fake = new FakeApi().install();
    fake.on('POST /api/auth/login', () => Promise.reject(new TypeError('Failed to fetch')));
    const { user } = renderApp('/login');

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível conectar ao servidor');
    expect(alert).not.toHaveTextContent(/fetch|TypeError/i);
  });

  it('valida campos obrigatorios e formato de e-mail sem chamar a API', async () => {
    const fake = new FakeApi().install();
    const { user } = renderApp('/login');

    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe seu e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Informe sua senha.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^E-mail/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^E-mail/)).toHaveFocus();

    await user.type(screen.getByLabelText(/^E-mail/), 'sem-arroba');
    await user.type(screen.getByLabelText(/^Senha/), 'x');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument();
    expect(fake.requestsTo('POST /api/auth/login')).toHaveLength(0);
  });

  it('desabilita o botao durante o envio e evita envio duplicado', async () => {
    const fake = new FakeApi().install();
    let release: () => void = () => undefined;
    fake.on(
      'POST /api/auth/login',
      () =>
        new Promise((resolve) => {
          release = () => {
            fake.session = makeSession();
            resolve(sessionResponse(makeSession()));
          };
        }),
    );
    const { user } = renderApp('/login');
    await fillAndSubmit(user);

    const busy = await screen.findByRole('button', { name: 'Entrando…' });
    expect(busy).toBeDisabled();
    release();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
    });
    expect(fake.requestsTo('POST /api/auth/login')).toHaveLength(1);
  });

  it('usuario ja autenticado em /login vai direto ao inicio', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    renderApp('/login');
    expect(await screen.findByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
  });

  it('mostra falha ao carregar a sessao com opcao de tentar novamente (rota protegida)', async () => {
    const fake = new FakeApi().install();
    let attempts = 0;
    fake.on('GET /api/auth/me', () => {
      attempts += 1;
      if (attempts === 1) return errorResponse(500, 'INTERNAL_ERROR');
      fake.session = makeSession();
      return sessionResponse(makeSession());
    });
    const { user } = renderApp('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Não foi possível carregar' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Código de suporte: req-test-0001');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
  });
});
