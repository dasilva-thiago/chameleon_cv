import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { isApiError, messageForError } from '../../lib/api';
import { ConsentRequired } from './ConsentRequired';
import { ProfileDataProvider, useProfileData } from './context';
import { useProfileState } from './queries';
import { SECTIONS, SECTION_GROUPS, completionOf } from './sections';

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `flex flex-col rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
    isActive ? 'bg-slate-200 font-semibold text-slate-900' : 'text-slate-800 hover:bg-slate-100'
  }`;

function ProfileNav() {
  const { document, summary } = useProfileData();
  const [open, setOpen] = useState(false);
  const toReview = summary.byStatus.needs_review;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="profile-nav"
        onClick={() => {
          setOpen(!open);
        }}
        className="min-h-11 rounded-md border border-slate-400 bg-white px-4 py-2 text-left text-base font-medium lg:hidden"
      >
        {open ? 'Ocultar seções do perfil' : 'Mostrar seções do perfil'}
      </button>
      <nav
        id="profile-nav"
        aria-label="Seções do perfil"
        className={`${open ? 'flex' : 'hidden'} flex-col gap-5 lg:flex`}
      >
        <ul className="flex flex-col gap-1">
          <li>
            <NavLink to="/perfil" end className={navLinkClass}>
              Visão geral
            </NavLink>
          </li>
          <li>
            <NavLink to="/perfil/importar" className={navLinkClass}>
              Importar arquivo
            </NavLink>
          </li>
        </ul>
        <div className="flex flex-col gap-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-700">
            Revisar e organizar
          </p>
          <ul className="flex flex-col gap-1">
            <li>
              <NavLink to="/perfil/confirmar" className={navLinkClass}>
                <span>Para confirmar</span>
                <span className="text-xs font-normal text-slate-700">
                  {toReview === 0 ? 'Nenhum item aguardando' : `${String(toReview)} aguardando`}
                </span>
              </NavLink>
            </li>
            <li>
              <NavLink to="/perfil/pendencias" className={navLinkClass}>
                <span>Pendências</span>
                <span className="text-xs font-normal text-slate-700">
                  {summary.pending.open === 0
                    ? 'Nenhuma aberta'
                    : `${String(summary.pending.open)} aberta(s)`}
                </span>
              </NavLink>
            </li>
            <li>
              <NavLink to="/perfil/evidencias" className={navLinkClass}>
                <span>Evidências</span>
                <span className="text-xs font-normal text-slate-700">
                  {summary.evidenceCount === 0
                    ? 'Nenhuma cadastrada'
                    : `${String(summary.evidenceCount)} cadastrada(s)`}
                </span>
              </NavLink>
            </li>
          </ul>
        </div>
        {SECTION_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-1">
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-700">
              {group.label}
            </p>
            <ul className="flex flex-col gap-1">
              {SECTIONS.filter((section) => section.group === group.id).map((section) => {
                const completion = completionOf(section, document);
                return (
                  <li key={section.slug}>
                    <NavLink to={`/perfil/${section.slug}`} className={navLinkClass}>
                      <span>{section.label}</span>
                      <span className="text-xs font-normal text-slate-700">{completion.text}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

/**
 * Area do perfil: carrega o estado uma vez, trata o portao de consentimento e monta a navegacao
 * lateral por secoes. As telas internas leem o documento pelo contexto.
 */
export function ProfileLayout() {
  usePageTitle('Perfil profissional');
  const state = useProfileState();

  if (state.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading>Perfil profissional</PageHeading>
        <LoadingStatus label="Carregando seu perfil…" />
      </div>
    );
  }
  if (state.isError) {
    if (isApiError(state.error, 'CONSENT_REQUIRED_FOR_PROFILE')) return <ConsentRequired />;
    return (
      <div className="flex flex-col items-start gap-4">
        <PageHeading>Perfil profissional</PageHeading>
        <Alert tone="error" title="Não foi possível carregar o perfil">
          {messageForError(state.error)}
        </Alert>
        <Button
          onClick={() => {
            void state.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { document, summary, exists } = state.data;
  return (
    <ProfileDataProvider document={document} summary={summary} exists={exists}>
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside aria-label="Navegação do perfil">
          <ProfileNav />
        </aside>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </ProfileDataProvider>
  );
}
