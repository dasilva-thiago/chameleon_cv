import type {
  AnalysisResult,
  EvidenceTier,
  JobAnalysis,
  MatchLevel,
  RequirementImportance,
} from '@chameleon/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Disclosure } from '../../components/ui/Disclosure';
import { CheckCircleIcon, InfoIcon, StopIcon } from '../../components/ui/icons';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { Spinner } from '../../components/ui/Spinner';
import { cx, focusRing, linkClass, panelClass, transition } from '../../components/ui/styles';
import { isApiError, messageForError } from '../../lib/api';
import { AiPanel } from '../ai/AiPanel';
import type { useAnalysis, useRunAnalysis } from './queries';

export type AnalysisQuery = ReturnType<typeof useAnalysis>;
export type RunAnalysis = ReturnType<typeof useRunAnalysis>;

const IMPORTANCE: Record<RequirementImportance, string> = {
  critical: 'Crítico',
  high: 'Alto',
  meaningful: 'Relevante',
  preferred: 'Diferencial',
  low_signal: 'Genérico',
};

const TIER: Record<EvidenceTier, string> = {
  stated: 'dito na vaga',
  structural: 'pela estrutura da vaga',
  inferred: 'inferido',
};

export const MATCH: Record<MatchLevel, { label: string; tone: BadgeTone }> = {
  strong: { label: 'Forte', tone: 'good' },
  partial: { label: 'Parcial', tone: 'warn' },
  missing: { label: 'Faltando', tone: 'bad' },
  na: { label: 'Não se aplica', tone: 'neutral' },
};

const FIT: Record<AnalysisResult['archetype']['fit'], string> = {
  primary: 'alvo principal',
  secondary: 'alvo secundário',
  adjacent: 'alvo adjacente',
  none: 'fora dos seus alvos',
};

const WORK_MODE: Record<AnalysisResult['extraction']['role']['workMode'], string> = {
  remote: 'Remoto',
  hybrid: 'Híbrido',
  onsite: 'Presencial',
  unknown: 'Modalidade não informada',
};

export const CONTRACT: Record<AnalysisResult['extraction']['role']['contract'], string> = {
  clt: 'CLT',
  pj: 'PJ',
  internship: 'Estágio',
  temporary: 'Temporário',
  other: 'Outro regime',
  unknown: 'Regime não informado',
};

export const PERIOD = { monthly: 'mês', yearly: 'ano', hourly: 'hora' } as const;

const DIMENSIONS: { key: keyof AnalysisResult['scores']; label: string }[] = [
  { key: 'cvMatch', label: 'Match com o CV' },
  { key: 'northStar', label: 'Alinhamento com seus alvos' },
  { key: 'comp', label: 'Remuneração' },
  { key: 'conditions', label: 'Modalidade e local' },
  { key: 'redFlags', label: 'Sinais de alerta (5 = nenhum)' },
];

const STALE_TEXT = {
  job_text: 'o texto da vaga mudou',
  profile: 'a sua base profissional mudou',
} as const;

export const money = (value: number, currency: string): string => {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${String(value)}`;
  }
};

function Block({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="text-item font-semibold text-ink-1">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Verdict({ result }: { result: AnalysisResult }) {
  return (
    <div className={cx(panelClass, 'flex flex-col gap-3 p-5')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">
          {result.archetype.label} · {FIT[result.archetype.fit]}
        </Badge>
      </div>
      <p className="text-section font-medium text-ink-1">{result.verdict.headline}</p>
      {result.verdict.reasons.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-body text-ink-2">
          {result.verdict.reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span
                aria-hidden="true"
                className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong"
              />
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
      {result.archetype.note ? (
        <p className="text-meta text-ink-3">{result.archetype.note}</p>
      ) : null}
      <RoleSummary result={result} />
    </div>
  );
}

function RoleSummary({ result }: { result: AnalysisResult }) {
  const role = result.extraction.role;
  const salary = role.salary;
  const parts = [
    role.seniority,
    WORK_MODE[role.workMode],
    role.location,
    CONTRACT[role.contract],
    salary?.currency
      ? `${[salary.min, salary.max]
          .filter((v): v is number => v !== null)
          .map((v) => money(v, salary.currency ?? 'BRL'))
          .join(' – ')}${salary.period ? `/${PERIOD[salary.period]}` : ''}`
      : 'Salário não informado',
  ].filter((part): part is string => part !== null && part !== '');
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      {role.tldr ? <p className="text-body text-ink-2">{role.tldr}</p> : null}
      <p className="text-meta text-ink-3">{parts.join(' · ')}</p>
    </div>
  );
}

const MATCH_BAR: Record<MatchLevel, string> = {
  strong: 'bg-evid',
  partial: 'bg-evid-partial/70',
  missing: 'bg-line-strong',
  na: 'bg-line',
};

/** Matrix requirement × importance × match × evidence, in the order the program computed. */
function Requirements({ result }: { result: AnalysisResult }) {
  const [onlyGaps, setOnlyGaps] = useState(false);
  const byId = new Map(result.extraction.requirements.map((req) => [req.id, req]));
  const matchOf = new Map(result.matches.map((match) => [match.requirementId, match]));
  const rows = result.order
    .map((id) => ({ id, req: byId.get(id), match: matchOf.get(id) }))
    .filter((row) => row.req !== undefined && row.match !== undefined)
    .filter((row) => !onlyGaps || row.match?.match === 'missing' || row.match?.match === 'partial');

  return (
    <Block
      id="analysis-requirements"
      title="Requisitos × sua base"
      aside={
        <button
          type="button"
          aria-pressed={onlyGaps}
          onClick={() => {
            setOnlyGaps((value) => !value);
          }}
          className={cx(
            'inline-flex h-7 cursor-pointer items-center rounded-full border px-3 text-meta font-medium',
            transition,
            focusRing,
            onlyGaps
              ? 'border-brand bg-brand-soft text-brand-text'
              : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink-1',
          )}
        >
          Só lacunas
        </button>
      }
    >
      <ul className={cx(panelClass, 'divide-y divide-line overflow-hidden')}>
        {rows.length === 0 ? (
          <li className="px-4 py-6 text-center text-body text-ink-3">
            Nenhuma lacuna: todos os requisitos estão cobertos.
          </li>
        ) : null}
        {rows.map(({ id, req, match }) => {
          if (req === undefined || match === undefined) return null;
          const m = MATCH[match.match];
          return (
            <li
              key={id}
              className="relative grid gap-x-4 gap-y-2 py-3 pl-5 pr-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            >
              <span
                aria-hidden="true"
                className={cx('absolute inset-y-3 left-0 w-1 rounded-r', MATCH_BAR[match.match])}
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={m.tone}>{m.label}</Badge>
                  <span className="text-meta text-ink-3">
                    {IMPORTANCE[req.importance]} ({TIER[req.tier]})
                  </span>
                </div>
                <p className="text-body text-ink-1">{req.text}</p>
                {req.jdSignal && req.tier === 'stated' ? (
                  <p className="text-meta text-ink-3">Na vaga: “{req.jdSignal}”</p>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5 text-meta">
                {match.evidence ? (
                  <p
                    className={cx(
                      'flex gap-1.5',
                      match.evidenceVerified ? 'text-ink-2' : 'text-attn-text',
                    )}
                  >
                    <span
                      className={cx('mt-px shrink-0', match.evidenceVerified ? 'text-evid' : '')}
                    >
                      {match.evidenceVerified ? <CheckCircleIcon /> : <InfoIcon />}
                    </span>
                    <span>
                      {match.evidenceVerified
                        ? 'Na sua base: '
                        : 'Evidência citada (não encontrada na base): '}
                      “{match.evidence}”
                    </span>
                  </p>
                ) : null}
                {match.gap && match.match !== 'strong' ? (
                  <p className="text-ink-2">Falta: {match.gap}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

function AnalysisView({ analysis }: { analysis: JobAnalysis }) {
  const { result } = analysis;
  const reqText = new Map(result.extraction.requirements.map((req) => [req.id, req.text]));
  return (
    <div className="flex flex-col gap-8">
      {result.dealbreakers.length > 0 ? (
        <Alert tone="error" title="Esta vaga quebra uma regra sua">
          <ul className="list-disc pl-5">
            {result.dealbreakers.map((item) => (
              <li key={item.rule + item.jdQuote}>
                {item.rule} — a vaga diz: “{item.jdQuote}”
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Verdict result={result} />

      <Requirements result={result} />

      {result.gaps.length > 0 ? (
        <Block id="analysis-gaps" title="Lacunas e como contornar">
          <ul className="grid gap-3 md:grid-cols-2">
            {result.gaps.map((gap) => (
              <li
                key={gap.requirementId}
                className={cx(panelClass, 'flex flex-col gap-1.5 p-4 text-body')}
              >
                <p className="flex items-start gap-2 font-medium text-ink-1">
                  {gap.blocker ? (
                    <span className="mt-0.5 text-risk-text">
                      <StopIcon />
                    </span>
                  ) : null}
                  <span>
                    {reqText.get(gap.requirementId) ?? gap.requirementId}
                    {gap.blocker ? ' (eliminatório)' : ''}
                  </span>
                </p>
                <p className="text-ink-2">Risco: {gap.risk}</p>
                <p className="text-ink-2">Como contornar: {gap.mitigation}</p>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {result.salary ? (
        <Block id="analysis-salary" title="Pretensão salarial sugerida">
          <div className={cx(panelClass, 'flex flex-col gap-1.5 p-4 text-body')}>
            <p className="font-mono text-section font-semibold tabular-nums text-ink-1">
              {money(result.salary.min, result.salary.currency)} –{' '}
              {money(result.salary.max, result.salary.currency)}
              <span className="font-sans text-body font-normal text-ink-3">
                /{PERIOD[result.salary.period]} · {CONTRACT[result.salary.contract]}
              </span>
            </p>
            <p className="text-ink-2">{result.salary.text}</p>
            {result.salary.sources.length > 0 ? (
              <p className="text-meta text-ink-3">Base: {result.salary.sources.join('; ')}</p>
            ) : null}
            {result.salary.warning ? (
              <p className="text-meta text-attn-text">{result.salary.warning}</p>
            ) : null}
          </div>
        </Block>
      ) : null}

      <Block id="analysis-keywords" title="Palavras-chave da vaga">
        <ul className="flex flex-wrap gap-1.5">
          {result.extraction.keywords.map((keyword) => (
            <li key={keyword}>
              <Badge tone="neutral">{keyword}</Badge>
            </li>
          ))}
        </ul>
      </Block>

      {result.customization.length > 0 ? (
        <Block id="analysis-plan" title="Plano de adaptação do currículo">
          <ol className={cx(panelClass, 'flex flex-col gap-2 p-4 text-body text-ink-2')}>
            {result.customization.map((item, index) => (
              <li key={item} className="flex gap-3">
                <span className="font-mono text-meta tabular-nums text-brand">{index + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      <Disclosure summary="Como a nota foi formada">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {DIMENSIONS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1 rounded-control bg-sunken p-3">
              <dt className="text-meta text-ink-3">{label}</dt>
              <dd className="font-mono text-section font-semibold tabular-nums text-ink-1">
                {result.scores[key] === null ? '—' : result.scores[key].toFixed(1)}
              </dd>
            </div>
          ))}
        </dl>
      </Disclosure>

      <footer className="flex flex-col gap-2 border-t border-line pt-4 text-meta text-ink-3">
        {result.warnings.length > 0 ? (
          <div>
            <p className="font-medium text-ink-2">Observações do programa</p>
            <ul className="mt-1 list-disc pl-5">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p>
          Avaliado com IA ({result.ai.provider}, {result.ai.model}) em{' '}
          {new Date(analysis.createdAt).toLocaleString('pt-BR')}. Citações e evidências foram
          conferidas pelo programa contra a vaga e a sua base.
        </p>
      </footer>
    </div>
  );
}

/** Honest progress of the AI call: what is happening and how long it has been running (no fake steps). */
function EvaluatingPanel() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return (
    <div role="status" className={cx(panelClass, 'flex flex-col gap-3 p-5')}>
      <div className="flex items-center gap-3">
        <Spinner className="text-brand" />
        <p className="font-medium text-ink-1">
          Avaliando a vaga com IA (pode levar até um minuto)…
        </p>
        <span className="ml-auto font-mono text-meta tabular-nums text-ink-3">{seconds}s</span>
      </div>
      <p className="text-meta text-ink-3">
        Primeiro a IA lê só a vaga (requisitos e importância); depois compara com a sua base. O
        programa confere as citações antes de mostrar.
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-sunken">
        <div className="h-full w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-full bg-brand/60" />
      </div>
    </div>
  );
}

/**
 * Avaliação da vaga no formato do career-ops: veredito, matriz requisitos × base, lacunas, salário e plano. A nota,
 * a recomendação e o botão de avaliar ficam no painel da vaga (o mesmo `query` e o mesmo `run`).
 */
export function AnalysisSection({ query, run }: { query: AnalysisQuery; run: RunAnalysis }) {
  const analysis = query.isSuccess ? query.data.analysis : null;

  return (
    <Section
      id="job-analysis"
      title="Avaliação da vaga"
      description="A IA lê a vaga e compara com a sua base; o programa confere as citações e decide a recomendação pela nota."
    >
      <AiPanel />

      {query.isPending ? <SkeletonBlock label="Carregando a avaliação…" lines={5} /> : null}
      {run.isPending ? <EvaluatingPanel /> : null}
      {query.isError ? (
        <Alert tone="error" title="Não foi possível carregar a avaliação">
          {messageForError(query.error)}
        </Alert>
      ) : null}

      {analysis !== null && query.isSuccess && query.data.stale ? (
        <Alert tone="attention" title="Avaliação desatualizada">
          {query.data.staleBecause.map((reason) => STALE_TEXT[reason]).join(' e ')} desde a última
          avaliação. Avalie de novo para atualizar.
        </Alert>
      ) : null}

      {run.isError ? (
        <Alert tone="error" title="Não foi possível avaliar">
          {messageForError(run.error)}
          {isApiError(run.error, 'PROFILE_REQUIRED') ? (
            <>
              {' '}
              <Link to="/perfil" className={linkClass}>
                Preencher a base
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}

      <div role="status" aria-live="polite" className="text-meta text-ink-3 empty:hidden">
        {run.isSuccess && run.data.reused
          ? 'Nada mudou desde a última avaliação: ela foi mantida.'
          : ''}
      </div>

      {query.isSuccess && analysis === null && !run.isPending ? (
        <p className="rounded-panel border border-dashed border-line-strong bg-surface px-5 py-8 text-center text-body text-ink-2">
          Esta vaga ainda não foi avaliada. Use <strong className="text-ink-1">Avaliar vaga</strong>{' '}
          no painel da vaga.
        </p>
      ) : null}

      {analysis !== null ? (
        <AnalysisView key={analysis.id + analysis.createdAt} analysis={analysis} />
      ) : null}
    </Section>
  );
}
