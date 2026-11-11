import { useId, type ReactNode } from 'react';
import { useTheme, type ThemeChoice } from '../../lib/theme';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';
import { cx, focusRing, transition } from './styles';

const OPTIONS: readonly { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Claro', icon: <SunIcon /> },
  { value: 'dark', label: 'Escuro', icon: <MoonIcon /> },
  { value: 'system', label: 'Sistema', icon: <MonitorIcon /> },
];

/** Light / dark / follow the system, as a radio group (arrow keys move, like a native radio group). */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { choice, setChoice } = useTheme();
  const prefix = useId();
  const move = (delta: number): void => {
    const at = OPTIONS.findIndex((option) => option.value === choice);
    const next = OPTIONS[(at + delta + OPTIONS.length) % OPTIONS.length];
    if (next) {
      setChoice(next.value);
      document.getElementById(`${prefix}-${next.value}`)?.focus();
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cx(
        'inline-flex rounded-control border border-line bg-sunken p-0.5',
        compact ? 'flex-col' : '',
      )}
    >
      {OPTIONS.map((option) => {
        const checked = option.value === choice;
        return (
          <button
            key={option.value}
            id={`${prefix}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={`Tema: ${option.label}`}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              setChoice(option.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              }
            }}
            className={cx(
              'inline-flex h-7 w-8 cursor-pointer items-center justify-center rounded-[0.3rem] pointer-coarse:h-9 pointer-coarse:w-10',
              transition,
              focusRing,
              checked ? 'bg-surface text-brand shadow-xs' : 'text-ink-3 hover:text-ink-1',
            )}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
