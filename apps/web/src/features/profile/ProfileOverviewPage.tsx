import { Link } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { usePageTitle } from '../../components/layout/PageHeading';
import { useProfileData } from './context';
import { ExportMenu } from './ExportMenu';

const secondaryLinkClass =
  'inline-flex min-h-11 items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const primaryLinkClass =
  'inline-flex min-h-11 items-center rounded-md border border-transparent bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const textLinkClass =
  'text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

/**
 * Visão geral: o que pede atenção e os atalhos de entrada e backup. As seções ficam só no menu lateral (sem repetir
 * a lista aqui). Perfil vazio nunca é tratado como falha da pessoa.
 */
export function ProfileOverviewPage() {
  usePageTitle('Perfil profissional');
  const { summary, exists } = useProfileData();
  const empty = !exists || summary.recordCount === 0;
  const toReview = summary.byStatus.needs_review;
  const openPending = summary.pending.open;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Perfil profissional"
        meta={
          empty ? undefined : (
            <p className="text-base text-slate-800">
              {String(summary.recordCount)} itens cadastrados
            </p>
          )
        }
        actions={
          <>
            <Link to="/perfil/importar" className={secondaryLinkClass}>
              Importar arquivo
            </Link>
            <ExportMenu disabled={!exists} />
          </>
        }
      />

      {empty ? (
        <section
          aria-labelledby="comecar"
          className="flex flex-col gap-3 rounded-md border border-blue-700 bg-blue-50 p-4"
        >
          <h2 id="comecar" className="text-lg font-semibold text-blue-950">
            Por onde começar
          </h2>
          <p className="text-sm text-blue-950">
            Nenhuma seção é obrigatória: comece por qualquer uma ou traga o que já tem de um
            arquivo.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/perfil/identidade" className={primaryLinkClass}>
              Preencher identidade
            </Link>
            <Link to="/perfil/importar" className={secondaryLinkClass}>
              Importar um arquivo
            </Link>
          </div>
        </section>
      ) : toReview > 0 || openPending > 0 ? (
        <section aria-labelledby="atencao" className="flex flex-col gap-2">
          <h2 id="atencao" className="text-lg font-semibold">
            Precisa de atenção
          </h2>
          <ul className="flex flex-col gap-1 text-base">
            {toReview > 0 ? (
              <li>
                <Link to="/perfil/confirmar" className={textLinkClass}>
                  {String(toReview)} item(ns) aguardando a sua confirmação
                </Link>
              </li>
            ) : null}
            {openPending > 0 ? (
              <li>
                <Link to="/perfil/pendencias" className={textLinkClass}>
                  {String(openPending)} pendência(s) aberta(s)
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : (
        <p className="text-base text-slate-800">
          Tudo confirmado. Escolha uma seção no menu para editar o seu perfil.
        </p>
      )}
    </div>
  );
}
