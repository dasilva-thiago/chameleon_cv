import type {
  AnalysisResult,
  EvidenceTier,
  JobAnalysis,
  MatchLevel,
  Recommendation,
  RequirementImportance,
} from '@chameleon/contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { isApiError, messageForError } from '../../lib/api';
import { AiPanel } from '../ai/AiPanel';
import { useAnalysis, useRunAnalysis } from './queries';

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const RECOMMENDATION: Record<Recommendation, { label: string; tone: Tone }> = {
  apply: { label: 'Vale se candidatar', tone: 'good' },
  consider: { label: 'Só com um bom motivo', tone: 'warn' },
  skip: { label: 'Não recomendado', tone: 'bad' },
};

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

const MATCH: Record<MatchLevel, { label: string; tone: Tone }> = {
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

const CONTRACT: Record<AnalysisResult['extraction']['role']['contract'], string> = {
  clt: 'CLT',
  pj: 'PJ',
  internship: 'Estágio',
  temporary: 'Temporário',
  other: 'Outro regime',
  unknown: 'Regime não informado',
};

const PERIOD = { monthly: 'mês', yearly: 'ano', hourly: 'hora' } as const;

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

const money = (value: number, currency: string): string => {
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

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-base font-semibold text-slate-900">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Verdict({ result }: { result: AnalysisResult }) {
  const rec = RECOMMENDATION[result.verdict.recommendation];
  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-3xl font-semibold text-slate-900">
          {result.score.toFixed(1)}
          <span className="text-base font-normal text-slate-700">/5</span>
        </p>
        <Badge tone={rec.tone}>{rec.label}</Badge>
        <Badge tone="info">
          {result.archetype.label} · {FIT[result.archetype.fit]}
        </Badge>
      </div>
      <p className="text-base text-slate-900">{result.verdict.headline}</p>
      {result.verdict.reasons.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-slate-800">
          {result.verdict.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {result.archetype.note ? (
        <p className="text-sm text-slate-700">{result.archetype.note}</p>
      ) : null}
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
    <div className="flex flex-col gap-1">
      {role.tldr ? <p className="text-sm text-slate-800">{role.tldr}</p> : null}
      <p className="text-sm text-slate-700">{parts.join(' · ')}</p>
    </div>
  );
}

function Requirements({ result }: { result: AnalysisResult }) {
  const byId = new Map(result.extraction.requirements.map((req) => [req.id, req]));
  const matchOf = new Map(result.matches.map((match) => [match.requirementId, match]));
  return (
    <ul className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-300 bg-white">
      {result.order.map((id) => {
        const req = byId.get(id);
        const match = matchOf.get(id);
        if (req === undefined || match === undefined) return null;
        const m = MATCH[match.match];
        return (
          <li key={id} className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={m.tone}>{m.label}</Badge>
              <span className="text-xs text-slate-700">
                {IMPORTANCE[req.importance]} ({TIER[req.tier]})
              </span>
            </div>
            <p className="text-sm text-slate-900">{req.text}</p>
            {req.jdSignal && req.tier === 'stated' ? (
              <p className="text-xs text-slate-700">Na vaga: “{req.jdSignal}”</p>
            ) : null}
            {match.evidence ? (
              <p className="text-xs text-slate-800">
                {match.evidenceVerified
                  ? 'Na sua base: '
                  : 'Evidência citada (não encontrada na base): '}
                “{match.evidence}”
              </p>
            ) : null}
            {match.gap && match.match !== 'strong' ? (
              <p className="text-xs text-slate-700">Falta: {match.gap}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function AnalysisView({ analysis }: { analysis: JobAnalysis }) {
  const { result } = analysis;
  const reqText = new Map(result.extraction.requirements.map((req) => [req.id, req.text]));
  return (
    <div className="flex flex-col gap-6">
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
      <RoleSummary result={result} />

      <Block id="analysis-scores" title="Notas por dimensão">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          {DIMENSIONS.map(({ key, label }) => (
            <div key={key} className="rounded-md border border-slate-300 bg-white p-3">
              <dt className="text-xs text-slate-700">{label}</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {result.scores[key] === null ? '—' : result.scores[key].toFixed(1)}
              </dd>
            </div>
          ))}
        </dl>
      </Block>

      <Block id="analysis-requirements" title="Requisitos × sua base">
        <Requirements result={result} />
      </Block>

      {result.gaps.length > 0 ? (
        <Block id="analysis-gaps" title="Lacunas e como contornar">
          <ul className="flex flex-col gap-3">
            {result.gaps.map((gap) => (
              <li
                key={gap.requirementId}
                className="rounded-md border border-slate-300 bg-white p-3 text-sm"
              >
                <p className="font-medium text-slate-900">
                  {reqText.get(gap.requirementId) ?? gap.requirementId}
                  {gap.blocker ? ' (eliminatório)' : ''}
                </p>
                <p className="text-slate-800">Risco: {gap.risk}</p>
                <p className="text-slate-800">Como contornar: {gap.mitigation}</p>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {result.salary ? (
        <Block id="analysis-salary" title="Pretensão salarial sugerida">
          <div className="flex flex-col gap-1 rounded-md border border-slate-300 bg-white p-3 text-sm">
            <p className="text-base font-semibold text-slate-900">
              {money(result.salary.min, result.salary.currency)} –{' '}
              {money(result.salary.max, result.salary.currency)}/{PERIOD[result.salary.period]} ·{' '}
              {CONTRACT[result.salary.contract]}
            </p>
            <p className="text-slate-800">{result.salary.text}</p>
            {result.salary.sources.length > 0 ? (
              <p className="text-slate-700">Base: {result.salary.sources.join('; ')}</p>
            ) : null}
            {result.salary.warning ? (
              <p className="text-amber-900">{result.salary.warning}</p>
            ) : null}
          </div>
        </Block>
      ) : null}

      <Block id="analysis-keywords" title="Palavras-chave da vaga">
        <ul className="flex flex-wrap gap-2">
          {result.extraction.keywords.map((keyword) => (
            <li key={keyword}>
              <Badge tone="neutral">{keyword}</Badge>
            </li>
          ))}
        </ul>
      </Block>

      {result.customization.length > 0 ? (
        <Block id="analysis-plan" title="Plano de adaptação do currículo">
          <ul className="list-disc pl-5 text-sm text-slate-800">
            {result.customization.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Block>
      ) : null}

      {result.warnings.length > 0 ? (
        <Alert tone="info" title="Observações do programa">
          <ul className="list-disc pl-5">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <p className="text-xs text-slate-700">
        Avaliado com IA ({result.ai.provider}, {result.ai.model}) em{' '}
        {new Date(analysis.createdAt).toLocaleString('pt-BR')}. Citações e evidências foram
        conferidas pelo programa contra a vaga e a sua base.
      </p>
    </div>
  );
}

/** Avaliação da vaga no formato do career-ops: nota, veredito, requisitos × base, lacunas, salário e plano. */
export function AnalysisSection({ jobId }: { jobId: string }) {
  const query = useAnalysis(jobId);
  const run = useRunAnalysis();
  const analysis = query.isSuccess ? query.data.analysis : null;

  return (
    <Section
      id="job-analysis"
      title="Avaliação da vaga"
      description="A IA lê a vaga e compara com a sua base; o programa confere as citações e decide a recomendação pela nota."
      actions={
        query.isSuccess ? (
          <Button
            variant={analysis === null ? 'primary' : 'secondary'}
            disabled={run.isPending}
            onClick={() => {
              run.mutate({ id: jobId, force: analysis !== null && !query.data.stale });
            }}
          >
            {run.isPending ? 'Avaliando…' : analysis === null ? 'Avaliar vaga' : 'Avaliar de novo'}
          </Button>
        ) : undefined
      }
    >
      <AiPanel />

      {query.isPending ? <LoadingStatus label="Carregando a avaliação…" /> : null}
      {run.isPending ? (
        <LoadingStatus label="Avaliando a vaga com IA (pode levar até um minuto)…" />
      ) : null}
      {query.isError ? (
        <Alert tone="error" title="Não foi possível carregar a avaliação">
          {messageForError(query.error)}
        </Alert>
      ) : null}

      {analysis !== null && query.isSuccess && query.data.stale ? (
        <Alert tone="info" title="Avaliação desatualizada">
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
              <Link to="/perfil" className="font-medium underline">
                Preencher a base
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}

      <div role="status" aria-live="polite" className="text-sm text-slate-700">
        {run.isSuccess && run.data.reused
          ? 'Nada mudou desde a última avaliação: ela foi mantida.'
          : ''}
      </div>

      {analysis !== null ? (
        <AnalysisView key={analysis.id + analysis.createdAt} analysis={analysis} />
      ) : null}
    </Section>
  );
}
