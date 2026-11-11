import {
  resumeContentSchema,
  type ResumeSummary,
  type ResumeVersionDetail,
} from '@chameleon/contracts';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CheckboxField } from '../../components/ui/CheckboxField';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { isApiError, messageForError } from '../../lib/api';
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

const backLinkClass =
  'inline-flex min-h-11 items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

function EditorView({
  resume,
  version,
}: {
  resume: ResumeSummary | undefined;
  version: ResumeVersionDetail;
}) {
  const navigate = useNavigate();
  const save = useSaveVersion();
  const approve = useApproveVersion();
  const newVersion = useNewVersion();
  const [content, setContent] = useState(version.content);
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
    } catch {
      // O motivo fica em save.error / approve.error e e mostrado abaixo.
    }
  };

  const backLink = (
    <Link to={resume ? `/vagas/${resume.jobId}` : '/vagas'} className={backLinkClass}>
      {resume ? 'Voltar à vaga' : 'Voltar às vagas'}
    </Link>
  );

  const header = (
    <div className="flex flex-col gap-2">
      <PageHeading>{resume?.name ?? 'Currículo'}</PageHeading>
      <div className="flex flex-wrap gap-2">
        <Badge tone="info">Versão {version.versionNumber}</Badge>
        <Badge tone={approved ? 'good' : 'warn'} prefix="Situação">
          {VERSION_STATUS_LABELS[version.status]}
        </Badge>
        {version.approvedAt !== null ? (
          <Badge prefix="Aprovada em">{formatDateTime(version.approvedAt)}</Badge>
        ) : null}
      </div>
    </div>
  );

  if (approved) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div>{backLink}</div>
        <Alert tone="info" title="Versão aprovada">
          Esta versão foi aprovada e não pode ser alterada. Para fazer mudanças, crie uma nova
          versão (um rascunho copiado desta). Os arquivos DOCX e PDF são gerados desta versão.
        </Alert>
        <p role="status" className="text-sm text-slate-800">
          Checagem contra a base: {countsText(counts)}.
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <Button
            disabled={newVersion.isPending}
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
          <DownloadMenu
            resumeId={version.resumeId}
            versionId={version.id}
            context={`versão ${String(version.versionNumber)}`}
          />
        </div>
        {newVersion.isError ? (
          <Alert tone="error" title="Não foi possível criar a nova versão">
            {messageForError(newVersion.error)}
          </Alert>
        ) : null}
        <ResumePreview content={version.content} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <div>{backLink}</div>

      {version.coverage !== null ? (
        <div className="flex flex-col gap-1 text-sm text-slate-800">
          <p>
            <span className="font-semibold">Palavras-chave da vaga cobertas:</span>{' '}
            {String(version.coverage.percent)}%
          </p>
          {version.coverage.missing.length > 0 ? (
            <p className="text-slate-700">
              Ausentes: {version.coverage.missing.join(', ')}. Inclua só as que a sua base sustenta.
            </p>
          ) : null}
        </div>
      ) : null}

      <div role="status" className="text-sm text-slate-800">
        Checagem contra a base:{' '}
        {counts.errors + counts.warnings === 0 ? 'nenhum problema encontrado' : countsText(counts)}
        {dirty ? ' (da última versão salva; salve para atualizar)' : ''}.
      </div>
      {(issues.get('sections') ?? []).length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {(issues.get('sections') ?? []).map((issue) => (
            <li
              key={issue.message}
              className={issue.severity === 'error' ? 'text-red-800' : 'text-amber-900'}
            >
              <span className="font-semibold">
                {issue.severity === 'error' ? 'Erro:' : 'Aviso:'}
              </span>{' '}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div role="group" aria-label="Modo de exibição" className="flex flex-wrap gap-2">
        <Button
          variant={mode === 'edit' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'edit'}
          onClick={() => {
            setMode('edit');
          }}
        >
          Editar
        </Button>
        <Button
          variant={mode === 'preview' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'preview'}
          onClick={() => {
            setMode('preview');
          }}
        >
          Pré-visualizar
        </Button>
      </div>

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
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!dirty || busy}
          onClick={() => {
            void saveContent().catch(() => undefined);
          }}
        >
          {save.isPending && !approve.isPending ? 'Salvando…' : 'Salvar rascunho'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || (counts.warnings > 0 && !reviewed)}
          onClick={() => {
            void approveVersion();
          }}
        >
          {approve.isPending ? 'Aprovando…' : 'Aprovar versão'}
        </Button>
        <span role="status" className="text-sm text-slate-700">
          {dirty ? 'Há alterações não salvas.' : save.isSuccess ? 'Rascunho salvo.' : ''}
        </span>
      </div>

      {hasErrors ? (
        <Alert tone="error" title="Corrija os campos antes de salvar">
          Há campos inválidos no currículo. Eles estão indicados no modo Editar.
        </Alert>
      ) : null}
      {notice !== null ? <Alert tone="info">{notice}</Alert> : null}
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

      {mode === 'edit' ? (
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
      ) : (
        <div className="flex flex-col gap-3">
          {dirty ? (
            <p className="text-sm text-slate-800">
              A prévia inclui alterações ainda não salvas. O arquivo só pode ser gerado depois de
              salvar e aprovar.
            </p>
          ) : null}
          <ResumePreview content={content} />
        </div>
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

  if (versionQuery.isPending) return <LoadingStatus label="Carregando o currículo…" />;
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
