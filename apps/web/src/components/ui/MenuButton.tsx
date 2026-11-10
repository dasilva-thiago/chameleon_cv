import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { ChevronDownIcon } from './icons';

export type MenuEntry =
  | { kind: 'item'; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { kind: 'radio'; label: string; checked: boolean; onSelect: () => void }
  | { kind: 'heading'; label: string }
  | { kind: 'separator' };

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]';
const itemClass =
  'flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Botão que abre um menu de opções (ícone com texto opcional). Teclado: Enter/Espaço/↓ abrem; ↑ ↓ Home End movem;
 * Esc fecha e devolve o foco ao botão; Tab ou clique fora fecham. Sem `text`, o botão é só o ícone e `label` é o
 * nome acessível.
 */
export function MenuButton({
  label,
  icon,
  text,
  entries,
  variant = 'secondary',
  disabled = false,
}: {
  /** Nome acessível do botão (obrigatório, mesmo com texto visível mais curto). */
  label: string;
  icon: ReactNode;
  text?: string;
  entries: readonly MenuEntry[];
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number): void => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        variant={variant}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={text === undefined ? 'min-w-11 px-2' : 'gap-2'}
        onClick={() => {
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        {text !== undefined ? (
          <>
            <span>{text}</span>
            <ChevronDownIcon />
          </>
        ) : null}
      </Button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-20 mt-1 flex min-w-56 flex-col rounded-md border border-slate-400 bg-white p-1 shadow-lg"
        >
          {entries.map((entry, index) => {
            if (entry.kind === 'separator') {
              return <hr key={`sep-${String(index)}`} className="my-1 border-slate-300" />;
            }
            if (entry.kind === 'heading') {
              return (
                <p
                  key={entry.label}
                  role="presentation"
                  className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  {entry.label}
                </p>
              );
            }
            if (entry.kind === 'radio') {
              return (
                <button
                  key={entry.label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={entry.checked}
                  className={itemClass}
                  onClick={() => {
                    entry.onSelect();
                    close(true);
                  }}
                >
                  <span aria-hidden="true" className="w-4 text-blue-800">
                    {entry.checked ? '✓' : ''}
                  </span>
                  {entry.label}
                </button>
              );
            }
            return (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                className={`${itemClass} ${entry.danger === true ? 'text-red-800' : 'text-slate-900'}`}
                onClick={() => {
                  close(false);
                  entry.onSelect();
                }}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
