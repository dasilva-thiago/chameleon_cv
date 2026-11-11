import type { ReactNode } from 'react';
import type { JobEvaluationSummary, Recommendation } from '@chameleon/contracts';
import { Badge, type BadgeTone } from './Badge';
import { AlertIcon, CheckCircleIcon, StopIcon } from './icons';
import { cx } from './styles';

/**
 * Signature elements of the evaluation (plan §2): the Score, the recommendation and the Evidence rail. They show only
 * what the program already checked (a "strong" whose evidence was not found in the base arrives as "partial").
 */

export const RECOMMENDATION: Record<Recommendation, { label: string; tone: BadgeTone }> = {
  apply: { label: 'Vale se candidatar', tone: 'good' },
  consider: { label: 'Só com um bom motivo', tone: 'warn' },
  skip: { label: 'Não recomendado', tone: 'bad' },
};

const RECOMMENDATION_ICON: Record<Recommendation, ReactNode> = {
  apply: <CheckCircleIcon />,
  consider: <AlertIcon />,
  skip: <StopIcon />,
};

export function RecommendationBadge({ recommendation }: { recommendation: Recommendation }) {
  const { label, tone } = RECOMMENDATION[recommendation];
  return (
    <Badge tone={tone} icon={RECOMMENDATION_ICON[recommendation]}>
      {label}
    </Badge>
  );
}

const scoreColor = (score: number): string =>
  score >= 4 ? 'text-evid' : score >= 3.5 ? 'text-attn-text' : 'text-risk-text';

/** The 1-5 score in mono. `hero` is the big one of the job panel, `inline` fits a list row. */
export function Score({ score, size = 'inline' }: { score: number; size?: 'inline' | 'hero' }) {
  return (
    <span className="inline-flex items-baseline gap-0.5 font-mono tabular-nums">
      <span
        className={cx(
          'font-semibold',
          scoreColor(score),
          size === 'hero' ? 'text-score tracking-tight' : 'text-section',
        )}
      >
        {score.toFixed(1)}
      </span>
      <span className={cx('text-ink-3', size === 'hero' ? 'text-body' : 'text-meta')}>/5</span>
    </span>
  );
}

type Rail = JobEvaluationSummary['rail'];

const SEGMENTS: readonly { key: keyof Rail; label: string; className: string }[] = [
  { key: 'strong', label: 'forte', className: 'bg-evid' },
  { key: 'partial', label: 'parcial', className: 'bg-evid-partial/70' },
  { key: 'missing', label: 'faltando', className: 'border border-line-strong bg-surface' },
  { key: 'na', label: 'não se aplica', className: 'bg-line' },
];

export function railLabel(rail: Rail): string {
  return SEGMENTS.filter((s) => rail[s.key] > 0)
    .map((s) => `${String(rail[s.key])} ${s.label}`)
    .join(', ');
}

/**
 * Composition of the requirements as a segmented bar. `mini` is the list version (the counts go in the accessible
 * name); `full` adds a numeric legend under the bar.
 */
export function EvidenceRail({ rail, size = 'mini' }: { rail: Rail; size?: 'mini' | 'full' }) {
  const total = rail.strong + rail.partial + rail.missing + rail.na;
  if (total === 0) return null;
  const label = `Requisitos: ${railLabel(rail)}`;
  return (
    <div className={cx('flex flex-col gap-2', size === 'mini' ? 'w-28' : 'w-full')}>
      <div
        role="img"
        aria-label={label}
        title={size === 'mini' ? label : undefined}
        className={cx(
          'flex w-full gap-0.5 overflow-hidden rounded-full',
          size === 'mini' ? 'h-1.5' : 'h-2.5',
        )}
      >
        {SEGMENTS.map((segment) =>
          rail[segment.key] > 0 ? (
            <span
              key={segment.key}
              className={cx('h-full rounded-[2px]', segment.className)}
              style={{ flexGrow: rail[segment.key] }}
            />
          ) : null,
        )}
      </div>
      {size === 'full' ? (
        <ul aria-hidden="true" className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-ink-2">
          {SEGMENTS.filter((s) => rail[s.key] > 0).map((segment) => (
            <li key={segment.key} className="inline-flex items-center gap-1.5">
              <span className={cx('size-2.5 rounded-[2px]', segment.className)} />
              <span className="font-mono tabular-nums text-ink-1">{rail[segment.key]}</span>{' '}
              {segment.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
