import { Outlet } from 'react-router';
import { APP_NAME } from '../../lib/config';
import { ShellFrame } from './ShellFrame';

/** Layout das rotas publicas (login, aceite de convite, 404): sem navegacao autenticada. */
export function PublicLayout() {
  return (
    <ShellFrame
      header={
        <div className="mx-auto flex w-full max-w-3xl items-center px-4 py-3 sm:px-6">
          <p className="text-lg font-semibold tracking-tight">{APP_NAME}</p>
        </div>
      }
    >
      <Outlet />
    </ShellFrame>
  );
}
