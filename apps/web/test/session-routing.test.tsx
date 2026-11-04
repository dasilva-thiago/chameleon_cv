import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { createAppQueryClient, SESSION_KEY } from '../src/features/auth/session';
import { ApiError } from '../src/lib/api/errors';
import { FakeApi, errorResponse, logoutResponse, makeSession } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

describe('rotas protegidas', () => {
  it('redireciona para /login quando nao ha sessao e mostra o carregamento antes disso', async () => {
    const fake = new FakeApi().install();
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(fake.requestsTo('GET /api/auth/me')).toHaveLength(1);
  });

  it('abre a pagina inicial com o nome do usuario quando ha sessao', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession({ displayName: null, email: 'sem.nome@example.com' });
    renderApp('/');
    expect(await screen.findByText('Olá, sem.nome@example.com.')).toBeInTheDocument();
  });

  it('rotas desconhecidas mostram pagina nao encontrada', async () => {
    new FakeApi().install();
    renderApp('/nao-existe');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeInTheDocument();
  });

  it('navega entre Inicio e Conta e marca a pagina atual', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    const { user } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Início' });
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: 'Conta' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Conta' });
    expect(screen.getByRole('link', { name: 'Conta' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('ana.teste@example.com')).toBeInTheDocument();
    // O foco vai para o titulo da nova pagina (anuncio da navegacao a leitores de tela).
    expect(heading).toHaveFocus();
    expect(document.title).toBe('Conta · ChameleonCV');
  });
});

describe('401 global', () => {
  it('uma mutacao que recebe UNAUTHENTICATED descarta a sessao e volta ao login com aviso', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    fake.on('POST /api/auth/logout-all', errorResponse(401, 'UNAUTHENTICATED'));
    const { user, queryClient } = renderApp('/conta');
    await screen.findByRole('heading', { level: 1, name: 'Conta' });

    await user.click(screen.getByRole('button', { name: 'Sair de todos os dispositivos' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar e sair de tudo' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sua sessão expirou');
    expect(queryClient.getQueryData(SESSION_KEY)).toBeNull();
  });

  it('depois do 401 e do novo login, o usuario volta a pagina em que estava', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    fake.on('POST /api/auth/logout-all', errorResponse(401, 'UNAUTHENTICATED'));
    const { user } = renderApp('/conta');
    await screen.findByRole('heading', { level: 1, name: 'Conta' });
    await user.click(screen.getByRole('button', { name: 'Sair de todos os dispositivos' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar e sair de tudo' }));
    await screen.findByRole('heading', { level: 1, name: 'Entrar' });

    fake.on('POST /api/auth/login', () => {
      fake.session = makeSession();
      return new Response(JSON.stringify(makeSession()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await user.type(screen.getByLabelText(/^E-mail/), 'ana.teste@example.com');
    await user.type(screen.getByLabelText(/^Senha/), 'uma-senha-bem-longa-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Conta' })).toBeInTheDocument();
  });

  it('uma consulta (query) que recebe UNAUTHENTICATED tambem encerra a sessao local', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(SESSION_KEY, makeSession());

    function Probe() {
      const query = useQuery({
        queryKey: ['dados', 'privados'],
        queryFn: () => Promise.reject(new ApiError({ code: 'UNAUTHENTICATED', status: 401 })),
      });
      return <p>{query.isError ? 'falhou' : 'carregando'}</p>;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
    await screen.findByText('falhou');
    await waitFor(() => {
      expect(queryClient.getQueryData(SESSION_KEY)).toBeNull();
    });
    expect(fake.requests).toHaveLength(0);
  });

  it('erros que nao sao 401 mantem a sessao', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    fake.on('POST /api/auth/logout-all', errorResponse(500, 'INTERNAL_ERROR'));
    const { user } = renderApp('/conta');
    await screen.findByRole('heading', { level: 1, name: 'Conta' });
    await user.click(screen.getByRole('button', { name: 'Sair de todos os dispositivos' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar e sair de tudo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado');
    expect(screen.getByRole('heading', { level: 1, name: 'Conta' })).toBeInTheDocument();
  });
});

describe('logout', () => {
  it('Sair revoga a sessao com CSRF, limpa o cache e volta ao login', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    const { user, queryClient } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Início' });
    queryClient.setQueryData(['dados', 'do-usuario-anterior'], { segredo: 1 });

    await user.click(screen.getByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Você saiu da sua conta.');
    const [logout] = fake.requestsTo('POST /api/auth/logout');
    expect(logout?.headers.get('X-CSRF-Token')).toMatch(/^Q{43}$/);
    expect(queryClient.getQueryData(['dados', 'do-usuario-anterior'])).toBeUndefined();
    expect(queryClient.getQueryData(SESSION_KEY)).toBeNull();
  });

  it('depois de sair, uma rota protegida nao reabre sem novo login', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    const { user } = renderApp('/conta');
    await screen.findByRole('heading', { level: 1, name: 'Conta' });
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await screen.findByRole('heading', { level: 1, name: 'Entrar' });
    expect(fake.session).toBeNull();
    expect(screen.queryByText('ana.teste@example.com')).not.toBeInTheDocument();
  });

  it('falha ao sair mantem o usuario na tela com mensagem e permite tentar de novo', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    fake.on('POST /api/auth/logout', () => Promise.reject(new TypeError('offline')));
    const { user } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Início' });
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar');
    expect(screen.getByRole('button', { name: 'Sair' })).toBeEnabled();
  });

  it('Sair de todos os dispositivos pede confirmacao e informa quantas sessoes foram encerradas', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    fake.on('POST /api/auth/logout-all', () => {
      fake.session = null;
      return logoutResponse(3);
    });
    const { user } = renderApp('/conta');
    await screen.findByRole('heading', { level: 1, name: 'Conta' });

    await user.click(screen.getByRole('button', { name: 'Sair de todos os dispositivos' }));
    expect(fake.requestsTo('POST /api/auth/logout-all')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(
      screen.getByRole('button', { name: 'Sair de todos os dispositivos' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sair de todos os dispositivos' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar e sair de tudo' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3 sessões encerradas');
    expect(fake.requestsTo('POST /api/auth/logout-all')[0]?.headers.get('X-CSRF-Token')).toMatch(
      /^Q{43}$/,
    );
  });
});
