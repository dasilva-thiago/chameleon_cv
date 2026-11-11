import { Outlet } from 'react-router';
import { Mark } from '../ui/Mark';
import { ThemeToggle } from '../ui/ThemeToggle';
import { ShellFrame } from './ShellFrame';

/** Barra simples das telas públicas e de sessão: marca à esquerda, tema à direita. */
export function PublicHeader() {
  return (
    <div className="mx-auto flex h-14 w-full max-w-[80rem] items-center justify-between px-4 sm:px-6 lg:px-8">
      <Mark />
      <ThemeToggle />
    </div>
  );
}

/** Layout das rotas publicas (login, aceite de convite, 404): sem navegacao autenticada. */
export function PublicLayout() {
  return (
    <ShellFrame header={<PublicHeader />} width="read">
      <Outlet />
    </ShellFrame>
  );
}
