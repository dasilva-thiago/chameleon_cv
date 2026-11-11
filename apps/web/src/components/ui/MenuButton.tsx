import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { CheckIcon, ChevronDownIcon } from './icons';
import { cx, transition } from './styles';

export type MenuEntry =
  | { kind: 'item'; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { kind: 'radio'; label: string; checked: boolean; onSelect: () => void }
  | { kind: 'heading'; label: string }
  | { kind: 'separator' };

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]';
const itemClass = cx(
  'flex h-9 w-full cursor-pointer items-center gap-2 rounded-[0.3rem] px-2.5 text-left text-body pointer-coarse:h-11',
  'hover:bg-sunken focus:bg-sunken focus:outline-none active:bg-line disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
  transition,
);

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
  variant?: 'primary' | 'secondary' | 'ghost';
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
        className={text === undefined ? 'w-9 px-0 pointer-coarse:w-11' : undefined}
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
          className="absolute right-0 z-30 mt-1.5 flex min-w-56 animate-enter flex-col rounded-panel border border-line bg-raised p-1 text-ink-1 shadow-md"
        >
          {entries.map((entry, index) => {
            if (entry.kind === 'separator') {
              return <hr key={`sep-${String(index)}`} className="my-1 border-line" />;
            }
            if (entry.kind === 'heading') {
              return (
                <p
                  key={entry.label}
                  role="presentation"
                  className="px-2.5 pb-1 pt-2 text-overline font-semibold uppercase tracking-wider text-ink-3"
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
                  <span aria-hidden="true" className="flex w-4 text-brand">
                    {entry.checked ? <CheckIcon /> : null}
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
                className={`${itemClass} ${entry.danger === true ? 'text-risk-text hover:bg-risk-soft focus:bg-risk-soft' : 'text-ink-1'}`}
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
