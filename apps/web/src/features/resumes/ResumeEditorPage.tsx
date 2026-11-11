import {
  resumeContentSchema,
  type ResumeSummary,
  type ResumeVersionDetail,
} from '@chameleon/contracts';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CheckboxField } from '../../components/ui/CheckboxField';
import { AlertIcon, CheckCircleIcon, StopIcon } from '../../components/ui/icons';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { buttonClasses, cx, panelClass } from '../../components/ui/styles';
import { useToast } from '../../components/ui/Toast';
import { isApiError, messageForError } from '../../lib/api';
import { useMediaQuery } from '../../lib/use-media-query';
import {
  bulletsById,
  errorsByPath,
  issueCounts,
  issuesByPath,
  locationLabel,
  warningSignature,
} from './content';
import { DownloadMenu } from './DownloadMenu';
import { VERSION_STATUS_LABELS, countsText, editorPath, formatDateTime } from './labels';
import {
  useApproveVersion,
  useNewVersion,
  useResume,
  useResumeVersion,
  useSaveVersion,
} from './queries';
import { ResumeForm } from './ResumeForm';
import { ResumePreview } from './ResumePreview';

type Mode = 'edit' | 'preview';

/** From this width the form and the A4 sheet sit side by side (plan §4, "Dividido"). */
const SPLIT_QUERY = '(min-width: 1280px)';

const backLinkClass = buttonClasses('secondary');

/** Keyword coverage of the job in this version: bar + percent, with the missing keywords listed. */
function CoverageMeter({ coverage }: { coverage: NonNullable<ResumeVersionDetail['coverage']> }) {
  const tone = coverage.percent >= 70 ? 'bg-evid' : coverage.percent >= 40 ? 'bg-attn' : 'bg-risk';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-3">
        <p className="text-meta text-ink-2">
          <span className="font-semibold text-ink-1">Palavras-chave da vaga cobertas:</span>{' '}
          <span className="font-mono tabular-nums">{String(coverage.percent)}%</span>
        </p>
        <div aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken">
          <div
            className={cx('h-full rounded-full', tone)}
            style={{ width: `${String(coverage.percent)}%` }}
          />
        </div>
      </div>
      {coverage.missing.length > 0 ? (
        <p className="text-meta text-ink-3">
          Ausentes: {coverage.missing.join(', ')}. Inclua só as que a sua base sustenta.
        </p>
      ) : null}
    </div>
  );
}

function ChecksSummary({
  counts,
  dirty,
}: {
  counts: { errors: number; warnings: number };
  dirty: boolean;
}) {
  const clean = counts.errors + counts.warnings === 0;
  const icon =
    counts.errors > 0 ? <StopIcon /> : counts.warnings > 0 ? <AlertIcon /> : <CheckCircleIcon />;
  const color =
    counts.errors > 0
      ? 'text-risk-text'
      : counts.warnings > 0
        ? 'text-attn-text'
        : 'text-evid-text';
  return (
    <div role="status" className={cx('flex items-center gap-1.5 text-meta', color)}>
      {icon}
      <span>
        Checagem contra a base: {clean ? 'nenhum problema encontrado' : countsText(counts)}
        {dirty ? ' (da última versão salva; salve para atualizar)' : ''}.
      </span>
    </div>
  );
}

function EditorHeader({
  resume,
  version,
}: {
  resume: ResumeSummary | undefined;
  version: ResumeVersionDetail;
}) {
  const approved = version.status === 'approved';
  return (
    <PageHeader
      back={
        resume
          ? { to: `/vagas/${resume.jobId}`, label: 'Voltar à vaga' }
          : { to: '/vagas', label: 'Voltar às vagas' }
      }
      title={resume?.name ?? 'Currículo'}
      meta={
        <div className="flex flex-wrap gap-2">
          <Badge tone="info">Versão {version.versionNumber}</Badge>
          <Badge tone={approved ? 'good' : 'warn'} prefix="Situação">
            {VERSION_STATUS_LABELS[version.status]}
          </Badge>
          {version.approvedAt !== null ? (
            <Badge prefix="Aprovada em">{formatDateTime(version.approvedAt)}</Badge>
          ) : null}
        </div>
      }
    />
  );
}

/** The A4 sheet in a frame: always white (it is the exported file), with zoom to fit or 100%. */
function PreviewFrame({
  content,
  note,
}: {
  content: ResumeVersionDetail['content'];
  note?: string | undefined;
}) {
  const [fit, setFit] = useState(true);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-overline font-semibold uppercase tracking-wider text-ink-3">
          Pré-visualização (A4)
        </p>
        <div role="group" aria-label="Zoom da pré-visualização" className="flex gap-1">
          <Button
            variant={fit ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={fit}
            onClick={() => {
              setFit(true);
            }}
          >
            Ajustar
          </Button>
          <Button
            variant={!fit ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={!fit}
            onClick={() => {
              setFit(false);
            }}
          >
            100%
          </Button>
        </div>
      </div>
      {note !== undefined ? <p className="text-meta text-ink-3">{note}</p> : null}
      <div className="overflow-auto rounded-panel bg-sunken p-4 ring-1 ring-line sm:p-6">
        <div className={cx('mx-auto', fit ? 'w-full max-w-[52rem]' : 'w-[52rem]')}>
          <ResumePreview content={content} />
        </div>
      </div>
    </div>
  );
}

function EditorView({
  resume,
  version,
}: {
  resume: ResumeSummary | undefined;
  version: ResumeVersionDetail;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const save = useSaveVersion();
  const approve = useApproveVersion();
  const newVersion = useNewVersion();
  const split = useMediaQuery(SPLIT_QUERY);
  const [content, setContent] = useState(version.content);
  const previewContent = useDeferredValue(content);
  const [mode, setMode] = useState<Mode>('edit');
  const [attempted, setAttempted] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const approved = version.status === 'approved';
  const dirty = JSON.stringify(content) !== JSON.stringify(version.content);
  const issues = useMemo(() => issuesByPath(version.issues), [version.issues]);
  const saved = useMemo(() => bulletsById(version.content), [version.content]);
  const counts = issueCounts(version.issues);
  const validation = useMemo(() => resumeContentSchema.safeParse(content), [content]);
  const errors = useMemo(
    () =>
      attempted && !validation.success
        ? errorsByPath(validation.error.issues)
        : new Map<string, string>(),
    [attempted, validation],
  );
  const hasErrors = attempted && !validation.success;
  const busy = save.isPending || approve.isPending;

  const saveContent = async (): Promise<ResumeVersionDetail | undefined> => {
    setAttempted(true);
    if (!validation.success) return undefined;
    const response = await save.mutateAsync({
      resumeId: version.resumeId,
      versionId: version.id,
      content: validation.data,
    });
    setContent(response.version.content);
    return response.version;
  };

  // Ctrl/Cmd+S saves the draft from anywhere on the page.
  const saveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    saveRef.current = () => {
      if (!approved && dirty && !busy) void saveContent().catch(() => undefined);
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Leaving the page with unsaved changes asks first (browser dialog).
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  const approveVersion = async (): Promise<void> => {
    setNotice(null);
    try {
      if (dirty) {
        const savedVersion = await saveContent();
        if (savedVersion === undefined) return;
        const warnings = issueCounts(savedVersion.issues).warnings;
        if (
          warnings > 0 &&
          warningSignature(savedVersion.issues) !== warningSignature(version.issues)
        ) {
          setReviewed(false);
          setNotice(
            'Salvamos as suas alterações e há avisos novos. Revise os avisos e marque "Revisei os avisos" para aprovar.',
          );
          return;
        }
      }
      await approve.mutateAsync({ resumeId: version.resumeId, versionId: version.id });
      toast.show({ tone: 'success', message: 'Versão aprovada.' });
    } catch {
      // O motivo fica em save.error / approve.error e e mostrado abaixo.
    }
  };

  if (approved) {
    return (
      <div className="flex flex-col gap-6">
        <EditorHeader resume={resume} version={version} />
        <Alert tone="success" title="Versão aprovada">
          Esta versão foi aprovada e não pode ser alterada. Para fazer mudanças, crie uma nova
          versão (um rascunho copiado desta). Os arquivos DOCX e PDF são gerados desta versão.
        </Alert>
        <div className="flex flex-wrap items-center gap-3">
          <DownloadMenu
            resumeId={version.resumeId}
            versionId={version.id}
            context={`versão ${String(version.versionNumber)}`}
          />
          <Button
            variant="secondary"
            loading={newVersion.isPending}
            onClick={() => {
              newVersion.mutate(
                { resumeId: version.resumeId, fromVersionId: version.id },
                {
                  onSuccess: (response) => {
                    void navigate(editorPath(response.version.resumeId, response.version.id));
                  },
                },
              );
            }}
          >
            {newVersion.isPending ? 'Criando…' : 'Criar nova versão para editar'}
          </Button>
          <p role="status" className="text-meta text-ink-3">
            Checagem contra a base: {countsText(counts)}.
          </p>
        </div>
        {newVersion.isError ? (
          <Alert tone="error" title="Não foi possível criar a nova versão">
            {messageForError(newVersion.error)}
          </Alert>
        ) : null}
        <PreviewFrame content={version.content} />
      </div>
    );
  }

  const sectionIssues = issues.get('sections') ?? [];
  const unsavedNote = dirty
    ? 'A prévia inclui alterações ainda não salvas. O arquivo só pode ser gerado depois de salvar e aprovar.'
    : undefined;

  const form = (
    <ResumeForm
      content={content}
      change={(next, announce) => {
        setContent(next);
        setNotice(null);
        if (announce !== undefined) setAnnouncement(announce);
      }}
      errors={errors}
      issues={issues}
      saved={saved}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <EditorHeader resume={resume} version={version} />

      {/* Fixed toolbar: what the checks say, keyword coverage and the two actions. */}
      <div
        className={cx(
          panelClass,
          'sticky top-[3.75rem] z-20 flex flex-col gap-3 p-4 shadow-md lg:flex-row lg:items-center lg:justify-between',
        )}
      >
        <div className="flex min-w-0 flex-col gap-2">
          {version.coverage !== null ? <CoverageMeter coverage={version.coverage} /> : null}
          <ChecksSummary counts={counts} dirty={dirty} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-meta text-ink-3">
            {dirty ? 'Há alterações não salvas.' : save.isSuccess ? 'Rascunho salvo.' : ''}
          </span>
          <Button
            variant={dirty ? 'primary' : 'secondary'}
            disabled={!dirty || busy}
            loading={save.isPending && !approve.isPending}
            title="Ctrl+S"
            onClick={() => {
              void saveContent().catch(() => undefined);
            }}
          >
            {save.isPending && !approve.isPending ? 'Salvando…' : 'Salvar rascunho'}
          </Button>
          <Button
            variant={dirty ? 'secondary' : 'primary'}
            disabled={busy || (counts.warnings > 0 && !reviewed)}
            loading={approve.isPending}
            onClick={() => {
              void approveVersion();
            }}
          >
            {approve.isPending ? 'Aprovando…' : 'Aprovar versão'}
          </Button>
        </div>
      </div>

      {sectionIssues.length > 0 ? (
        <ul className="flex flex-col gap-1 text-body">
          {sectionIssues.map((issue) => (
            <li
              key={issue.message}
              className={issue.severity === 'error' ? 'text-risk-text' : 'text-attn-text'}
            >
              <span className="font-semibold">
                {issue.severity === 'error' ? 'Erro:' : 'Aviso:'}
              </span>{' '}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {counts.warnings > 0 ? (
        <CheckboxField
          label="Revisei os avisos"
          description="Os avisos não impedem a aprovação, mas indicam texto que não aparece nos registros de origem. Confira cada um antes de aprovar."
          checked={reviewed}
          onChange={(event) => {
            setReviewed(event.target.checked);
          }}
        />
      ) : null}

      {hasErrors ? (
        <Alert tone="error" title="Corrija os campos antes de salvar">
          Há campos inválidos no currículo. Eles estão indicados no formulário.
        </Alert>
      ) : null}
      {notice !== null ? <Alert tone="attention">{notice}</Alert> : null}
      {save.isError ? (
        <Alert tone="error" title="Não foi possível salvar">
          {messageForError(save.error)}
        </Alert>
      ) : null}
      {approve.isError ? (
        <Alert tone="error" title="Não foi possível aprovar">
          {messageForError(approve.error)}
          {isApiError(approve.error, 'RESUME_INVALID') && approve.error.details.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {approve.error.details.map((detail) => (
                <li key={`${detail.path}-${detail.message}`}>
                  <span className="font-semibold">
                    {locationLabel(version.content, detail.path)}:
                  </span>{' '}
                  {detail.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <div role="status" className="sr-only">
        {announcement}
      </div>

      {split ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
          <div className="min-w-0">{form}</div>
          <div className="sticky top-[12rem] max-h-[calc(100vh-13rem)] min-w-0 overflow-y-auto">
            <PreviewFrame content={previewContent} note={unsavedNote} />
          </div>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Modo de exibição" className="flex flex-wrap gap-1">
            <Button
              variant={mode === 'edit' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'edit'}
              onClick={() => {
                setMode('edit');
              }}
            >
              Editar
            </Button>
            <Button
              variant={mode === 'preview' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'preview'}
              onClick={() => {
                setMode('preview');
              }}
            >
              Pré-visualizar
            </Button>
          </div>
          {mode === 'edit' ? form : <PreviewFrame content={content} note={unsavedNote} />}
        </>
      )}
    </div>
  );
}

/** Editor de uma versao de curriculo: editar o rascunho, pre-visualizar, aprovar ou baixar. */
export function ResumeEditorPage() {
  const { resumeId, versionId } = useParams();
  const versionQuery = useResumeVersion(resumeId, versionId);
  const resumeQuery = useResume(resumeId);
  usePageTitle(resumeQuery.data?.resume.name ?? 'Currículo');

  if (versionQuery.isPending) return <SkeletonBlock label="Carregando o currículo…" lines={8} />;
  if (versionQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <PageHeading>Currículo</PageHeading>
        <Alert tone="error" title="Não foi possível abrir o currículo">
          {isApiError(versionQuery.error, 'NOT_FOUND')
            ? 'Esta versão não foi encontrada. O currículo pode ter sido excluído.'
            : messageForError(versionQuery.error)}
        </Alert>
        <Link to="/vagas" className={backLinkClass}>
          Voltar às vagas
        </Link>
      </div>
    );
  }
  return (
    <EditorView
      key={versionQuery.data.version.id}
      resume={resumeQuery.data?.resume}
      version={versionQuery.data.version}
    />
  );
}
