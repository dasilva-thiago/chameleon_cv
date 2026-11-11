import type { AuthUser } from '@chameleon/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useLogout } from '../../features/auth/session';
import { useAiStatus } from '../../features/ai/queries';
import { messageForError } from '../../lib/api';
import { cycleTheme } from '../../lib/theme';
import { Alert } from '../ui/Alert';
import { Button, IconButton, LinkButton } from '../ui/Button';
import {
  BriefcaseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DocumentIcon,
  HomeIcon,
  LogoutIcon,
  MenuIcon,
  PlusIcon,
  UserIcon,
} from '../ui/icons';
import { Mark } from '../ui/Mark';
import { cx, focusRing, transition } from '../ui/styles';
import { ThemeToggle } from '../ui/ThemeToggle';
import { ToastProvider } from '../ui/Toast';
import { CommandSearch } from './CommandSearch';
import { ShellFrame, type ShellWidth } from './ShellFrame';

/** Navegação na ordem do fluxo (Início → Vagas → Base); Conta fica no rodapé da barra. */
const FLOW_ITEMS = [
  { to: '/', label: 'Início', end: true, icon: <HomeIcon /> },
  { to: '/vagas', label: 'Vagas', end: false, icon: <BriefcaseIcon /> },
  { to: '/perfil', label: 'Base', end: false, icon: <DocumentIcon /> },
] as const;
const ACCOUNT_ITEM = { to: '/conta', label: 'Conta', end: false, icon: <UserIcon /> } as const;

const COLLAPSED_KEY = 'chameleon.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Largura do conteúdo por rota (plano §3.5). */
function widthFor(pathname: string): ShellWidth {
  if (pathname.startsWith('/perfil') || pathname.startsWith('/curriculos')) return 'full';
  if (pathname === '/conta' || pathname === '/vagas/nova' || pathname.endsWith('/editar'))
    return 'read';
  return 'work';
}

function NavItem({
  item,
  collapsed,
}: {
  item: { to: string; label: string; end: boolean; icon: ReactNode };
  collapsed: boolean;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cx(
          'group flex h-9 items-center gap-3 rounded-control px-2.5 text-body font-medium pointer-coarse:h-11',
          transition,
          focusRing,
          collapsed ? 'justify-center' : '',
          isActive
            ? 'bg-brand-soft text-brand-text'
            : 'text-ink-2 hover:bg-sunken hover:text-ink-1 active:bg-line',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={isActive ? 'text-brand' : 'text-ink-3 group-hover:text-ink-2'}>
            {item.icon}
          </span>
          <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Indicador de IA no rodapé da barra (não substitui o painel de consentimento na vaga). */
function AiIndicator({ collapsed }: { collapsed: boolean }) {
  const status = useAiStatus();
  if (!status.isSuccess) return null;
  const { configured, active } = status.data;
  const [label, dot] = !configured
    ? ['IA: sem chave configurada', 'bg-line-strong']
    : active
      ? ['IA: ligada', 'bg-evid']
      : ['IA: desligada', 'bg-attn'];
  return (
    <p
      className={cx(
        'flex items-center gap-2 px-2.5 text-meta text-ink-3',
        collapsed ? 'justify-center' : '',
      )}
      title={label}
    >
      <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', dot)} />
      <span className={collapsed ? 'sr-only' : ''}>{label}</span>
    </p>
  );
}

function Sidebar({
  user,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  user: AuthUser;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const logout = useLogout();
  const name = user.displayName ?? user.email;
  // Em telas estreitas a barra é uma gaveta: sempre expandida.
  const compact = collapsed && !mobileOpen;

  return (
    <>
      {mobileOpen ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-scrim lg:hidden"
          onClick={onCloseMobile}
        />
      ) : null}
      <aside
        aria-label="Barra lateral"
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface transition-[transform,visibility,width] duration-200 ease-out',
          'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          mobileOpen ? 'translate-x-0 shadow-lg' : 'max-lg:invisible -translate-x-full',
          compact ? 'w-16' : 'w-60',
        )}
      >
        <div
          className={cx(
            'flex h-14 shrink-0 items-center border-b border-line',
            compact ? 'justify-center' : 'justify-between px-4',
          )}
        >
          <Mark compact={compact} />
          {mobileOpen ? (
            <IconButton
              label="Fechar menu"
              icon={<CloseIcon />}
              size="sm"
              onClick={onCloseMobile}
              className="lg:hidden"
            />
          ) : null}
        </div>

        <div className={cx('flex flex-col gap-4 overflow-y-auto py-4', compact ? 'px-3' : 'px-3')}>
          <LinkButton
            to="/vagas/nova"
            variant="primary"
            icon={<PlusIcon />}
            title={compact ? 'Nova vaga' : undefined}
            className={compact ? 'w-10 px-0' : 'w-full'}
          >
            <span className={compact ? 'sr-only' : ''}>Nova vaga</span>
          </LinkButton>

          <nav aria-label="Principal" className="flex flex-1 flex-col">
            <ul className="flex flex-col gap-0.5">
              {FLOW_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavItem item={item} collapsed={compact} />
                </li>
              ))}
            </ul>
            <p
              className={cx(
                'mt-6 mb-1.5 px-2.5 text-overline font-semibold uppercase tracking-wider text-ink-3',
                compact ? 'sr-only' : '',
              )}
            >
              Configurações
            </p>
            <ul className="flex flex-col gap-0.5">
              <li>
                <NavItem item={ACCOUNT_ITEM} collapsed={compact} />
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-auto flex flex-col gap-3 border-t border-line px-3 py-3">
          <AiIndicator collapsed={compact} />
          <div
            className={cx('flex items-center gap-2', compact ? 'flex-col' : 'justify-between px-1')}
          >
            <ThemeToggle compact={compact} />
            <IconButton
              label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
              icon={collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              size="sm"
              onClick={onToggleCollapsed}
              className="hidden lg:inline-flex"
            />
          </div>
          <div className={cx('flex items-center gap-2', compact ? 'flex-col' : 'px-1')}>
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-meta font-semibold uppercase text-brand-text"
            >
              {name.slice(0, 1)}
            </span>
            <span
              className={cx(
                'min-w-0 flex-1 truncate text-meta text-ink-2',
                compact ? 'sr-only' : '',
              )}
              title={name}
            >
              {name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              loading={logout.isPending}
              icon={<LogoutIcon />}
              title="Sair"
              aria-label="Sair"
              onClick={() => {
                logout.mutate();
              }}
              className={compact ? 'w-8 px-0' : ''}
            >
              <span className={compact ? 'sr-only' : ''}>
                {logout.isPending ? 'Saindo…' : 'Sair'}
              </span>
            </Button>
          </div>
          {logout.isError ? (
            <Alert tone="error" title="Não foi possível sair">
              {messageForError(logout.error)}
            </Alert>
          ) : null}
        </div>
      </aside>
    </>
  );
}

/** Layout das rotas protegidas: barra lateral (navegação, tema, IA, usuário), barra superior com busca e conteúdo. */
export function AuthenticatedLayout({ user }: { user: AuthUser }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // The drawer remembers the page it was opened on, so navigating closes it without an effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const mobileOpen = openedAt === pathname;
  const setMobileOpen = (open: boolean): void => {
    setOpenedAt(open ? pathname : null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        cycleTheme();
      }
      if (event.key === 'Escape') setOpenedAt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const toggleCollapsed = (): void => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      } catch {
        /* storage blocked */
      }
      return !value;
    });
  };

  return (
    <ToastProvider>
      <ShellFrame
        width={widthFor(pathname)}
        sidebar={
          <Sidebar
            user={user}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            mobileOpen={mobileOpen}
            onCloseMobile={() => {
              setMobileOpen(false);
            }}
          />
        }
        header={
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <IconButton
              label="Abrir menu"
              icon={<MenuIcon />}
              className="lg:hidden"
              aria-expanded={mobileOpen}
              onClick={() => {
                setMobileOpen(true);
              }}
            />
            <div className="lg:hidden">
              <Mark compact />
            </div>
            <div className="flex flex-1 justify-end sm:justify-start">
              <CommandSearch />
            </div>
          </div>
        }
      >
        <Outlet />
      </ShellFrame>
    </ToastProvider>
  );
}
