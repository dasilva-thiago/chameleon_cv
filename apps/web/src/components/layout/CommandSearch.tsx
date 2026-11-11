import type { JobSummary } from '@chameleon/contracts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useJobs } from '../../features/jobs/queries';
import { Dialog } from '../ui/Dialog';
import { BriefcaseIcon, SearchIcon } from '../ui/icons';
import { cx, focusRing, transition } from '../ui/styles';

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const labelOf = (job: JobSummary): string =>
  [job.title ?? 'Vaga sem título', job.company].filter(Boolean).join(' — ');

/** Shortcut hint, Ctrl on Windows/Linux and ⌘ on macOS. */
export const modKey = (): string =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/** Trigger shown in the top bar; the shortcut Ctrl/⌘+K opens it from anywhere. */
export function CommandSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className={cx(
          'flex h-9 w-full max-w-80 cursor-pointer items-center gap-2 rounded-control border border-line bg-surface px-3 text-body text-ink-3 hover:border-line-strong hover:text-ink-2',
          transition,
          focusRing,
        )}
      >
        <SearchIcon />
        <span className="flex-1 text-left">Buscar vaga</span>
        <kbd className="hidden rounded border border-line bg-sunken px-1.5 font-mono text-[0.6875rem] text-ink-3 sm:inline">
          {modKey()} K
        </kbd>
      </button>
      {open ? (
        <SearchDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const jobs = useJobs({ status: 'all' });
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo(() => {
    const all = jobs.data?.jobs ?? [];
    const q = fold(query.trim());
    const matched =
      q === ''
        ? all
        : all.filter((job) => fold(`${labelOf(job)} ${job.location ?? ''}`).includes(q));
    return matched.slice(0, 8);
  }, [jobs.data, query]);

  const go = (job: JobSummary | undefined): void => {
    if (!job) return;
    onClose();
    void navigate(`/vagas/${job.id}`);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Buscar vaga"
      hideTitle
      placement="top"
      initialFocus={inputRef}
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <span className="text-ink-3">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Buscar vaga"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${String(active)}` : undefined}
          placeholder="Cargo, empresa ou local…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((n) => Math.min(n + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((n) => Math.max(n - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(results[active]);
            }
          }}
          className="h-12 flex-1 bg-transparent text-base text-ink-1 outline-none placeholder:text-ink-3"
        />
        <kbd className="rounded border border-line bg-sunken px-1.5 font-mono text-[0.6875rem] text-ink-3">
          Esc
        </kbd>
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Vagas encontradas"
        className="max-h-96 overflow-y-auto p-1.5"
      >
        {jobs.isPending ? (
          <li className="px-3 py-6 text-center text-ink-3">Carregando vagas…</li>
        ) : null}
        {jobs.isSuccess && results.length === 0 ? (
          <li className="px-3 py-6 text-center text-ink-3">Nenhuma vaga encontrada.</li>
        ) : null}
        {results.map((job, index) => (
          // Keyboard selection is handled by the combobox input (aria-activedescendant); a click is the mouse path.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <li
            key={job.id}
            id={`${listId}-${String(index)}`}
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => {
              setActive(index);
            }}
            onClick={() => {
              go(job);
            }}
            className={cx(
              'flex cursor-pointer items-center gap-3 rounded-control px-3 py-2.5',
              transition,
              index === active ? 'bg-brand-soft text-brand-text' : 'text-ink-1',
            )}
          >
            <span className={index === active ? 'text-brand' : 'text-ink-3'}>
              <BriefcaseIcon />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{labelOf(job)}</span>
            {job.location ? (
              <span className="shrink-0 text-meta text-ink-3">{job.location}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
