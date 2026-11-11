import {
  createJobRequestSchema,
  type CreateJobRequest,
  type JobDetail,
  type JobStatus,
  type JobWorkMode,
} from '@chameleon/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/SelectField';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import { STATUS_OPTIONS, WORK_MODE_OPTIONS } from './labels';

type FieldName =
  | 'description'
  | 'title'
  | 'company'
  | 'url'
  | 'location'
  | 'workMode'
  | 'postedOn'
  | 'notes'
  | 'status';

interface Values {
  description: string;
  title: string;
  company: string;
  url: string;
  location: string;
  workMode: JobWorkMode | '';
  postedOn: string;
  notes: string;
  status: JobStatus;
}

function initialValues(job: JobDetail | undefined): Values {
  return {
    description: job?.description ?? '',
    title: job?.title ?? '',
    company: job?.company ?? '',
    url: job?.url ?? '',
    location: job?.location ?? '',
    workMode: job?.workMode ?? '',
    postedOn: job?.postedOn ?? '',
    notes: job?.notes ?? '',
    status: job?.status ?? 'saved',
  };
}

/** Corpo para a API: texto vazio vira `null` (o contrato normaliza); a descrição segue como colada. */
function toRequest(values: Values): CreateJobRequest {
  return {
    description: values.description,
    title: values.title,
    company: values.company,
    url: values.url,
    location: values.location,
    workMode: values.workMode === '' ? null : values.workMode,
    postedOn: values.postedOn === '' ? null : values.postedOn,
    notes: values.notes,
    status: values.status,
  };
}

/** Campos que não são o essencial para salvar a vaga: ficam em "Mais detalhes". */
const OPTIONAL_FIELDS = ['url', 'location', 'workMode', 'postedOn', 'status', 'notes'] as const;

export interface JobFormProps {
  job?: JobDetail;
  submitLabel: string;
  pending: boolean;
  apiError?: string | undefined;
  onSubmit: (request: CreateJobRequest) => void;
  onCancel: () => void;
}

/** Formulário de vaga (criar e editar). Valida com o contrato antes de enviar. */
export function JobForm({ job, submitLabel, pending, apiError, onSubmit, onCancel }: JobFormProps) {
  const [values, setValues] = useState<Values>(() => initialValues(job));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const hasOptional = OPTIONAL_FIELDS.some(
    (name) => values[name] !== '' && values[name] !== 'saved',
  );
  const [moreOpen, setMoreOpen] = useState(hasOptional);

  const set =
    <K extends FieldName>(name: K) =>
    (value: Values[K]): void => {
      setValues((current) => ({ ...current, [name]: value }));
    };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const request = toRequest(values);
    const parsed = createJobRequestSchema.safeParse(request);
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const name = issue.path[0];
        if (typeof name === 'string' && !(name in next)) next[name as FieldName] = issue.message;
      }
      setErrors(next);
      if (OPTIONAL_FIELDS.some((name) => name in next)) setMoreOpen(true);
      return;
    }
    setErrors({});
    onSubmit(request);
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {apiError !== undefined ? (
        <Alert tone="error" title="Não foi possível salvar">
          {apiError}
        </Alert>
      ) : null}
      <TextAreaField
        label="Descrição da vaga"
        required
        rows={14}
        spellCheck={false}
        hint="Cole o texto integral. Ele é guardado exatamente como colado."
        error={errors.description}
        value={values.description}
        maxLength={30000}
        onChange={(event) => {
          set('description')(event.target.value);
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Cargo"
          error={errors.title}
          value={values.title}
          maxLength={200}
          onChange={(event) => {
            set('title')(event.target.value);
          }}
        />
        <TextField
          label="Empresa"
          error={errors.company}
          value={values.company}
          maxLength={200}
          onChange={(event) => {
            set('company')(event.target.value);
          }}
        />
      </div>
      <details
        open={moreOpen}
        onToggle={(event) => {
          setMoreOpen(event.currentTarget.open);
        }}
        className="rounded-control border border-line-strong bg-surface"
      >
        <summary className="cursor-pointer px-4 py-3 text-body font-medium text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          Mais detalhes <span className="font-normal text-ink-2">(opcional)</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Endereço da vaga (URL)"
              type="url"
              inputMode="url"
              autoComplete="off"
              error={errors.url}
              value={values.url}
              maxLength={2048}
              onChange={(event) => {
                set('url')(event.target.value);
              }}
            />
            <TextField
              label="Local"
              error={errors.location}
              value={values.location}
              maxLength={200}
              onChange={(event) => {
                set('location')(event.target.value);
              }}
            />
            <SelectField
              label="Modalidade"
              options={WORK_MODE_OPTIONS}
              error={errors.workMode}
              value={values.workMode}
              onChange={(event) => {
                set('workMode')(event.target.value as JobWorkMode | '');
              }}
            />
            <TextField
              label="Data de publicação"
              type="date"
              error={errors.postedOn}
              value={values.postedOn}
              onChange={(event) => {
                set('postedOn')(event.target.value);
              }}
            />
            <SelectField
              label="Situação"
              placeholder={null}
              options={STATUS_OPTIONS}
              error={errors.status}
              value={values.status}
              onChange={(event) => {
                set('status')(event.target.value as JobStatus);
              }}
            />
          </div>
          <TextAreaField
            label="Anotações"
            rows={3}
            hint="Só para você; não faz parte do texto da vaga."
            error={errors.notes}
            value={values.notes}
            maxLength={5000}
            onChange={(event) => {
              set('notes')(event.target.value);
            }}
          />
        </div>
      </details>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : submitLabel}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
