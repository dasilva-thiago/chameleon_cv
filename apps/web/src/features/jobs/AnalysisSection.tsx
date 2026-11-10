import type {
  AnalysisReview,
  JobAnalysis,
  JobRequirement,
  MatchStrength,
  RequirementImportance,
  RequirementMatch,
} from '@chameleon/contracts';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CheckboxField } from '../../components/ui/CheckboxField';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { isApiError, messageForError } from '../../lib/api';
import { AiPanel } from '../ai/AiPanel';
import { useAiStatus } from '../ai/queries';
import { RECORD_KIND_LABELS } from '../profile/labels';
import { slugForKind } from '../profile/sections';
import { useAnalysis, useRunAnalysis, useSaveReview } from './queries';

const STRENGTH_LABELS: Record<MatchStrength, string> = {
  direct: 'Evidência direta',
  partial: 'Evidência parcial',
  transferable: 'Transferível',
  pending: 'Aguardando confirmação',
  absent: 'Sem evidência',
};

const STRENGTH_TONES = {
  direct: 'good',
  partial: 'info',
  transferable: 'info',
  pending: 'warn',
  absent: 'bad',
} as const;

const STRENGTH_HELP: Record<MatchStrength, string> = {
  direct: 'Registro confirmado de experiência profissional.',
  partial: 'Registro confirmado de projeto, estudo ou conhecimento declarado.',
  transferable: 'Tecnologia parecida confirmada no perfil (sugestão automática; revise).',
  pending: 'Existe no perfil, mas ainda não foi confirmado.',
  absent: 'Nada no perfil sustenta este requisito.',
};

const STRENGTH_ORDER: readonly MatchStrength[] = [
  'direct',
  'partial',
  'transferable',
  'pending',
  'absent',
];

const IMPORTANCE_GROUPS: readonly { id: RequirementImportance; title: string }[] = [
  { id: 'mandatory', title: 'Requisitos obrigatórios' },
  { id: 'desirable', title: 'Diferenciais' },
  { id: 'responsibility', title: 'Responsabilidades' },
];

const STALE_TEXT = {
  job_text: 'o texto da vaga mudou',
  profile: 'o seu perfil mudou',
} as const;

function reviewSnapshot(review: AnalysisReview): AnalysisReview {
  return {
    excludedRecordIds: [...review.excludedRecordIds],
    pinnedRecordIds: [...review.pinnedRecordIds],
    notes: { ...review.notes },
  };
}

/** Seção recolhida por padrão: o título (com um resumo curto) abre e fecha o conteúdo, sem perder o que foi digitado. */
function Collapsible({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-md border border-slate-400 bg-white">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="text-slate-700 transition-transform group-open:rotate-90"
        >
          ▸
        </span>
        <h3 id={id} className="text-base font-semibold">
          {title}
        </h3>
        {hint !== undefined ? <span className="text-sm text-slate-700">{hint}</span> : null}
      </summary>
      <div className="flex flex-col gap-3 border-t border-slate-300 p-4">{children}</div>
    </details>
  );
}

function RequirementItem({
  requirement,
  match,
  note,
  onNote,
}: {
  requirement: JobRequirement;
  match: RequirementMatch;
  note: string;
  onNote: (value: string) => void;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-4">
      <p className="text-base font-medium text-slate-900">{requirement.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STRENGTH_TONES[match.strength]}>{STRENGTH_LABELS[match.strength]}</Badge>
        {requirement.yearsRequired !== null ? (
          <Badge prefix="Pede">{String(requirement.yearsRequired)} ano(s)</Badge>
        ) : null}
        <span className="text-sm text-slate-700">{match.rationale}</span>
      </div>
      {match.evidence.length > 0 ? (
        <ul aria-label={`Evidências de: ${requirement.text}`} className="flex flex-col gap-1">
          {match.evidence.map((evidence) => {
            const slug = slugForKind(evidence.kind);
            const text = `${RECORD_KIND_LABELS[evidence.kind]}: ${evidence.label}`;
            return (
              <li key={evidence.recordId} className="text-sm text-slate-800">
                {slug !== undefined ? (
                  <Link
                    to={`/perfil/${slug}`}
                    className="text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  >
                    {text}
                  </Link>
                ) : (
                  text
                )}
                {evidence.status !== 'confirmed' ? ' (aguardando confirmação)' : ''}
              </li>
            );
          })}
        </ul>
      ) : null}
      {match.gap !== null ? <p className="text-sm text-slate-800">{match.gap}</p> : null}
      {match.cautions.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-amber-950">
          {match.cautions.map((caution) => (
            <li key={caution}>{caution}</li>
          ))}
        </ul>
      ) : null}
      {match.experienceNote !== undefined ? (
        <details className="text-sm text-slate-700">
          <summary className="cursor-pointer text-slate-700 underline decoration-dotted">
            Sobre experiência
          </summary>
          <p className="mt-1">{match.experienceNote}</p>
        </details>
      ) : null}
      <TextAreaField
        label={`Sua anotação sobre este requisito (${requirement.id})`}
        rows={2}
        maxLength={500}
        value={note}
        onChange={(event) => {
          onNote(event.target.value);
        }}
      />
    </li>
  );
}

function AnalysisView({ jobId, analysis }: { jobId: string; analysis: JobAnalysis }) {
  const save = useSaveReview();
  const [review, setReview] = useState<AnalysisReview>(() => reviewSnapshot(analysis.review));
  const [dirty, setDirty] = useState(false);
  const { result } = analysis;
  const matchOf = new Map(result.matches.map((match) => [match.requirementId, match]));
  const excluded = new Set(review.excludedRecordIds);

  const change = (next: AnalysisReview): void => {
    setReview(next);
    setDirty(true);
  };
  const toggle = (recordId: string, included: boolean): void => {
    const nextExcluded = new Set(excluded);
    if (included) nextExcluded.delete(recordId);
    else nextExcluded.add(recordId);
    change({ ...review, excludedRecordIds: [...nextExcluded] });
  };
  const setNote = (requirementId: string, value: string): void => {
    const notes = { ...review.notes };
    if (value.trim() === '') delete notes[requirementId];
    else notes[requirementId] = value;
    change({ ...review, notes });
  };

  const mandatory = result.summary.mandatoryByStrength;
  const supportedMandatory = mandatory.direct + mandatory.partial + mandatory.transferable;
  const totalMandatory = Object.values(mandatory).reduce((sum, n) => sum + n, 0);

  return (
    <div className="flex flex-col gap-5">
      {result.warnings.length > 0 ? (
        <Alert tone="info" title="Atenção">
          <ul className="list-disc pl-5">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Collapsible
        id="analysis-summary"
        title="Resumo"
        hint={`${String(result.summary.byStrength.direct)} diretas · ${String(result.summary.byStrength.partial)} parciais · ${String(result.summary.byStrength.absent)} sem evidência`}
      >
        <p className="text-sm text-slate-700">
          {result.engine === 'ai' && result.ai
            ? `Analisado com IA (${result.ai.provider}, ${result.ai.model}). A IA propõe os requisitos e os vínculos; a força de cada evidência vem das regras locais.`
            : 'Análise local, sem IA.'}
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {STRENGTH_ORDER.map((strength) => (
            <div key={strength} className="rounded-md border border-slate-400 bg-white p-3">
              <dt className="text-xs text-slate-700" title={STRENGTH_HELP[strength]}>
                {STRENGTH_LABELS[strength]}
              </dt>
              <dd className="text-xl font-semibold text-slate-900">
                {String(result.summary.byStrength[strength])}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-slate-800">
          Requisitos obrigatórios com alguma sustentação confirmada: {String(supportedMandatory)} de{' '}
          {String(totalMandatory)}.
        </p>
      </Collapsible>

      {IMPORTANCE_GROUPS.map((group) => {
        const items = result.requirements.filter((r) => r.importance === group.id);
        if (items.length === 0) return null;
        return (
          <Collapsible
            key={group.id}
            id={`analysis-${group.id}`}
            title={`${group.title} (${String(items.length)})`}
          >
            <ul className="flex flex-col gap-3">
              {items.map((requirement) => {
                const match = matchOf.get(requirement.id);
                if (match === undefined) return null;
                return (
                  <RequirementItem
                    key={requirement.id}
                    requirement={requirement}
                    match={match}
                    note={review.notes[requirement.id] ?? ''}
                    onNote={(value) => {
                      setNote(requirement.id, value);
                    }}
                  />
                );
              })}
            </ul>
          </Collapsible>
        );
      })}

      <Collapsible
        id="analysis-plan"
        title="Plano de adaptação"
        hint={`${String(result.prioritized.length)} itens`}
      >
        <p className="text-sm text-slate-800">
          Itens confirmados do seu perfil que mais sustentam esta vaga. Desmarque o que não quer
          destacar no currículo. Nada aqui altera o seu perfil.
        </p>
        {result.prioritized.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-400 bg-white p-4 text-sm">
            Nenhum item confirmado sustenta esta vaga ainda. Confirme itens do perfil ou registre o
            que falta.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {result.prioritized.map((record) => (
              <li key={record.recordId}>
                <CheckboxField
                  label={`${RECORD_KIND_LABELS[record.kind]}: ${record.label}`}
                  description={`${STRENGTH_LABELS[record.strength]} · sustenta ${record.requirementIds.join(', ')}`}
                  checked={!excluded.has(record.recordId)}
                  onChange={(event) => {
                    toggle(record.recordId, event.target.checked);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Collapsible>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => {
            save.mutate(
              { id: jobId, review },
              {
                onSuccess: () => {
                  setDirty(false);
                },
              },
            );
          }}
        >
          {save.isPending ? 'Salvando…' : 'Salvar revisão'}
        </Button>
        <span role="status" className="text-sm text-slate-700">
          {save.isSuccess && !dirty
            ? 'Revisão salva.'
            : analysis.reviewedAt !== null && !dirty
              ? `Revisada em ${new Date(analysis.reviewedAt).toLocaleString('pt-BR')}.`
              : ''}
        </span>
      </div>
      {save.isError ? (
        <Alert tone="error" title="Não foi possível salvar a revisão">
          {messageForError(save.error)}
        </Alert>
      ) : null}
    </div>
  );
}

/** Análise da vaga contra o perfil: requisitos, evidências, lacunas e plano revisável (local ou com IA). */
export function AnalysisSection({ jobId }: { jobId: string }) {
  const query = useAnalysis(jobId);
  const run = useRunAnalysis();
  const ai = useAiStatus();

  const analyze = (force: boolean): void => {
    run.mutate({ id: jobId, force });
  };

  const canAnalyze = query.isSuccess;
  return (
    <Section
      id="job-analysis"
      title="Análise da vaga"
      description={
        ai.data?.active === true
          ? 'Requisitos × perfil confirmado. Com a IA ligada, o texto da vaga e itens confirmados escolhidos vão ao provedor.'
          : 'Requisitos × perfil confirmado. Roda neste computador, sem enviar nada a serviços externos.'
      }
      actions={
        canAnalyze ? (
          <Button
            variant={query.data.analysis === null ? 'primary' : 'secondary'}
            disabled={run.isPending}
            onClick={() => {
              analyze(false);
            }}
          >
            {run.isPending
              ? 'Analisando…'
              : query.data.analysis === null
                ? 'Analisar vaga'
                : 'Analisar de novo'}
          </Button>
        ) : undefined
      }
    >
      <AiPanel />

      {query.isPending ? <LoadingStatus label="Carregando a análise…" /> : null}
      {query.isError ? (
        <Alert tone="error" title="Não foi possível carregar a análise">
          {messageForError(query.error)}
        </Alert>
      ) : null}

      {query.isSuccess && query.data.analysis !== null && query.data.stale ? (
        <Alert tone="info" title="Análise desatualizada">
          {query.data.staleBecause.map((reason) => STALE_TEXT[reason]).join(' e ')} desde a última
          análise. Analise de novo para atualizar.
        </Alert>
      ) : null}

      {run.isError ? (
        <Alert tone="error" title="Não foi possível analisar">
          {messageForError(run.error)}
          {isApiError(run.error, 'PROFILE_REQUIRED') ? (
            <>
              {' '}
              <Link to="/perfil/importar" className="font-medium underline">
                Importar perfil
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}

      <div role="status" aria-live="polite" className="text-sm text-slate-700">
        {run.isSuccess && run.data.reused
          ? 'Nada mudou desde a última análise: ela foi mantida.'
          : ''}
      </div>

      {query.isSuccess && query.data.analysis !== null ? (
        <AnalysisView
          key={query.data.analysis.id + String(query.data.analysis.reviewedAt)}
          jobId={jobId}
          analysis={query.data.analysis}
        />
      ) : null}
    </Section>
  );
}
