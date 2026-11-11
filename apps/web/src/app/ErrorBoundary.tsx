import { Component, type ErrorInfo, type ReactNode } from 'react';
import { buttonClasses } from '../components/ui/styles';

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
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-canvas px-4 text-ink-1">
        <h1 className="text-title font-semibold">Algo deu errado</h1>
        <p className="text-body text-ink-2">
          Ocorreu um erro inesperado ao exibir esta página. Recarregue para tentar novamente.
        </p>
        <div>
          <button
            type="button"
            className={buttonClasses('primary')}
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
