import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/** Ultima barreira contra falhas de renderizacao: mensagem generica, sem detalhes tecnicos. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Sem registro no console: a mensagem de um erro de renderizacao pode conter dados do usuario.
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold">Algo deu errado</h1>
        <p className="text-base text-slate-700">
          Ocorreu um erro inesperado ao exibir esta página. Recarregue para tentar novamente.
        </p>
        <div>
          <button
            type="button"
            className="min-h-11 rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            onClick={() => {
              window.location.reload();
            }}
          >
            Recarregar página
          </button>
        </div>
      </main>
    );
  }
}
