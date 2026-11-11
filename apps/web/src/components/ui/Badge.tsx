import type { ReactNode } from 'react';
import { cx } from './styles';

/**
 * good = comprovado/recomendado/aprovado (verde, plano §2); warn = precisa de atenção; bad = bloqueia; info = destaque de
 * marca (tipo de vaga, item atual); neutral = situação sem juízo (situação da vaga, contagens).
 */
export type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-sunken text-ink-2',
  good: 'border-evid/25 bg-evid-soft text-evid-text',
  warn: 'border-attn/30 bg-attn-soft text-attn-text',
  bad: 'border-risk/25 bg-risk-soft text-risk-text',
  info: 'border-brand/25 bg-brand-soft text-brand-text',
};

/**
 * Selo informativo. O significado esta sempre no TEXTO (a cor apenas reforca), entao o selo
 * continua legivel sem distinguir cores. Prefixo opcional descreve a dimensao ("Status: ...").
 */
export function Badge({
  tone = 'neutral',
  prefix,
  icon,
  children,
}: {
  tone?: BadgeTone;
  prefix?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-meta font-medium',
        TONES[tone],
      )}
    >
      {icon}
      {prefix !== undefined ? <span className="font-normal opacity-80">{prefix}:</span> : null}
      {children}
    </span>
  );
}
