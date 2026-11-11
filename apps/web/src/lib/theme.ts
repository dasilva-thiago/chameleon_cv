import { useSyncExternalStore } from 'react';

/**
 * Theme: light, dark or follow the system (default). The choice is saved in localStorage; public/theme-init.js applies
 * it before the first paint, and this module keeps `<html data-theme>` in sync afterwards (including when the system
 * preference changes while "system" is selected).
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'chameleon.theme';
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemDark() ? 'dark' : 'light';
  return choice;
}

function apply(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(choice));
}

let current: ThemeChoice = readChoice();

export function getThemeChoice(): ThemeChoice {
  return current;
}

export function setThemeChoice(choice: ThemeChoice): void {
  current = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage blocked: keep it for this tab */
  }
  const commit = (): void => {
    apply(choice);
    for (const listener of listeners) listener();
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof doc.startViewTransition === 'function' && !reduced) doc.startViewTransition(commit);
  else commit();
}

/** Cycles light -> dark -> system (keyboard shortcut). */
export function cycleTheme(): void {
  const order: ThemeChoice[] = ['light', 'dark', 'system'];
  setThemeChoice(order[(order.indexOf(current) + 1) % order.length] ?? 'system');
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current !== 'system') return;
    apply('system');
    for (const listener of listeners) listener();
  });
  apply(current);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
} {
  const choice = useSyncExternalStore(subscribe, getThemeChoice, (): ThemeChoice => 'system');
  return { choice, resolved: resolveTheme(choice), setChoice: setThemeChoice };
}
