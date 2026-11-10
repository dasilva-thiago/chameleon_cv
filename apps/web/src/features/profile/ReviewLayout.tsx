import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { useProfileData } from './context';

const tabClass = ({ isActive }: { isActive: boolean }): string =>
  `-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-700 ${
    isActive
      ? 'border-blue-700 font-semibold text-slate-900'
      : 'border-transparent text-slate-700 hover:border-slate-400 hover:text-slate-900'
  }`;

function Count({ value, attention = false }: { value: number; attention?: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        attention && value > 0 ? 'bg-amber-100 text-amber-950' : 'bg-slate-200 text-slate-800'
      }`}
    >
      {String(value)}
    </span>
  );
}

/**
 * "Revisar": as três listas de trabalho do perfil (itens a confirmar, pendências e evidências) numa só tela com
 * abas, cada aba com a sua contagem. As rotas continuam as mesmas de antes.
 */
export function ReviewLayout() {
  const { summary } = useProfileData();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Revisar" />
      <nav aria-label="Revisar" className="border-b border-slate-300">
        <ul className="flex flex-wrap gap-1">
          <li>
            <NavLink to="/perfil/confirmar" className={tabClass}>
              Para confirmar <Count value={summary.byStatus.needs_review} attention />
            </NavLink>
          </li>
          <li>
            <NavLink to="/perfil/pendencias" className={tabClass}>
              Pendências <Count value={summary.pending.open} attention />
            </NavLink>
          </li>
          <li>
            <NavLink to="/perfil/evidencias" className={tabClass}>
              Evidências <Count value={summary.evidenceCount} />
            </NavLink>
          </li>
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
