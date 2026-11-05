import { useNavigate, useParams } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { isApiError, messageForError } from '../../lib/api';
import { JobForm } from './JobForm';
import { UNTITLED_JOB } from './labels';
import { useCreateJob, useJob, usePatchJob } from './queries';

export function NewJobPage() {
  usePageTitle('Adicionar vaga');
  const navigate = useNavigate();
  const create = useCreateJob();

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeading>Adicionar vaga</PageHeading>
      <JobForm
        submitLabel="Salvar vaga"
        pending={create.isPending}
        apiError={create.isError ? messageForError(create.error) : undefined}
        onSubmit={(request) => {
          create.mutate(request, {
            onSuccess: ({ job }) => {
              void navigate(`/vagas/${job.id}`);
            },
          });
        }}
        onCancel={() => {
          void navigate('/vagas');
        }}
      />
    </div>
  );
}

export function EditJobPage() {
  const { jobId } = useParams();
  const query = useJob(jobId);
  const navigate = useNavigate();
  const patch = usePatchJob();
  usePageTitle('Editar vaga');

  if (query.isPending) return <LoadingStatus label="Carregando a vaga…" />;
  if (query.isError) {
    return (
      <Alert tone="error" title="Não foi possível abrir a vaga">
        {isApiError(query.error, 'NOT_FOUND')
          ? 'Esta vaga não foi encontrada.'
          : messageForError(query.error)}
      </Alert>
    );
  }
  const { job } = query.data;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeading>Editar: {job.title ?? UNTITLED_JOB}</PageHeading>
      <JobForm
        job={job}
        submitLabel="Salvar alterações"
        pending={patch.isPending}
        apiError={patch.isError ? messageForError(patch.error) : undefined}
        onSubmit={(request) => {
          patch.mutate(
            { id: job.id, input: request },
            {
              onSuccess: () => {
                void navigate(`/vagas/${job.id}`);
              },
            },
          );
        }}
        onCancel={() => {
          void navigate(`/vagas/${job.id}`);
        }}
      />
    </div>
  );
}
