import type { ReactNode } from 'react';
import { AlertIcon, CheckCircleIcon, InfoIcon, StopIcon } from './icons';
import { cx } from './styles';

/** `info` is neutral (information is not a brand or evidence color); `attention` asks the person to act. */
type Tone = 'error' | 'attention' | 'success' | 'info';

const TONES: Record<Tone, { box: string; icon: ReactNode }> = {
  error: { box: 'border-risk/40 bg-risk-soft text-risk-text', icon: <StopIcon /> },
  attention: { box: 'border-attn/40 bg-attn-soft text-attn-text', icon: <AlertIcon /> },
  success: { box: 'border-evid/30 bg-evid-soft text-evid-text', icon: <CheckCircleIcon /> },
  info: { box: 'border-line bg-sunken text-ink-1', icon: <InfoIcon /> },
};

export interface AlertProps {
  tone: Tone;
  children: ReactNode;
  /** Titulo curto (negrito). Evita depender apenas da cor para transmitir o tipo. */
  title?: string;
}

/** Erros usam role="alert" (anunciado de imediato); demais avisos usam role="status". */
export function Alert({ tone, title, children }: AlertProps) {
  const { box, icon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex animate-enter gap-3 rounded-panel border px-4 py-3 text-body', box)}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title !== undefined ? <p className="font-semibold">{title}</p> : null}
        <div className={title !== undefined ? 'text-ink-2 [&_a]:text-current' : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
