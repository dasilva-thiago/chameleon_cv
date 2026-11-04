import type { AuthUser } from '@chameleon/contracts';
import { NavLink, Outlet } from 'react-router';
import { useLogout } from '../../features/auth/session';
import { messageForError } from '../../lib/api';
import { APP_NAME } from '../../lib/config';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { ShellFrame } from './ShellFrame';

const NAV_ITEMS = [
  { to: '/', label: 'Início', end: true },
  { to: '/conta', label: 'Conta', end: false },
] as const;

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  `rounded-md px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
    isActive ? 'bg-slate-200 font-semibold text-slate-900' : 'text-slate-800 hover:bg-slate-100'
  }`;

/** Layout das rotas protegidas: navegacao principal, usuario e saida. */
export function AuthenticatedLayout({ user }: { user: AuthUser }) {
  const logout = useLogout();
  const name = user.displayName ?? user.email;

  return (
    <ShellFrame
      header={
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="text-lg font-semibold tracking-tight">{APP_NAME}</p>
            <nav aria-label="Principal">
              <ul className="flex gap-1">
                {NAV_ITEMS.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} className={linkClass}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="max-w-48 truncate text-sm text-slate-700" title={name}>
              {name}
            </span>
            <Button
              variant="secondary"
              disabled={logout.isPending}
              onClick={() => {
                logout.mutate();
              }}
            >
              {logout.isPending ? 'Saindo…' : 'Sair'}
            </Button>
          </div>
        </div>
      }
    >
      {logout.isError ? (
        <div className="mb-6">
          <Alert tone="error" title="Não foi possível sair">
            {messageForError(logout.error)}
          </Alert>
        </div>
      ) : null}
      <Outlet />
    </ShellFrame>
  );
}
