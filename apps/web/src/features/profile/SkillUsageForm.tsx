import {
  PROFILE_RECORD_SCHEMAS,
  SELF_ASSESSED_LEVEL_VALUES,
  SKILL_USAGE_SOURCE_FIELDS,
  USAGE_CONTEXT_SOURCES,
  type RecordKind,
  type UsageContext,
} from '@chameleon/contracts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  FormProvider,
  useController,
  useForm,
  useFormContext,
  useWatch,
  type FieldValues,
} from 'react-hook-form';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { messageForError } from '../../lib/api';
import { useProfileData } from './context';
import { describeRecord, type Json } from './document';
import type { FormSpec } from './field-defs';
import { FieldRenderer, FormEnvProvider } from './form/FieldRenderer';
import { FieldStatesPanel } from './form/FieldStatesPanel';
import {
  contractResolver,
  errorMessageAt,
  getPath,
  pruneRecord,
  toFormValues,
} from './form/form-utils';
import { GovernanceFields, NEW_FACT_META } from './form/GovernanceFields';
import {
  RECORD_KIND_LABELS,
  SELF_LEVEL_LABELS,
  USAGE_CONTEXT_HELP,
  USAGE_CONTEXT_LABELS,
  optionsOf,
} from './labels';
import { useCreateRecord, useReplaceRecord } from './queries';

type SourceField = (typeof SKILL_USAGE_SOURCE_FIELDS)[number];

const SOURCE_KIND: Record<SourceField, RecordKind> = {
  experience_id: 'experience',
  project_id: 'project',
  education_id: 'education',
  course_id: 'course',
  certification_id: 'certification',
  volunteering_id: 'volunteering',
};

/** Agrupamento que deixa clara a diferenca de forca entre os contextos (ADR-0007). */
const CONTEXT_GROUPS: readonly {
  id: string;
  title: string;
  note: string;
  contexts: readonly UsageContext[];
}[] = [
  {
    id: 'practice',
    title: 'Usei na prática',
    note: 'Uso real, ligado a um trabalho, projeto ou atividade.',
    contexts: ['professional_experience', 'project_experience', 'volunteer_experience'],
  },
  {
    id: 'study',
    title: 'Estudei',
    note: 'Aprendizado formal, sem que isso conte como experiência profissional.',
    contexts: ['coursework', 'certification'],
  },
  {
    id: 'declared',
    title: 'Declaro, sem apontar onde usei',
    note: 'Informação sua, sem comprovação por enquanto.',
    contexts: ['self_declared_knowledge', 'conceptual_familiarity', 'unverified'],
  },
];

const NEW_SKILL = '__new__';
/** Id valido so para o resolver validar o registro enquanto a competencia ainda sera criada. */
const PLACEHOLDER_SKILL_ID = 'NEW-SKILL';

const DETAIL_SPEC: FormSpec = {
  groups: [
    {
      id: 'details',
      title: 'Detalhes do uso',
      fields: [
        {
          kind: 'text',
          name: 'facet',
          label: 'Frente ou aspecto',
          hint: 'Ex.: frontend, gestão de estoque.',
        },
        { kind: 'textarea', name: 'usage_description', label: 'Como você usou' },
        { kind: 'textarea', name: 'personal_implementation', label: 'O que foi feito por você' },
        {
          kind: 'select',
          name: 'level_in_context',
          label: 'Seu nível neste contexto',
          options: optionsOf(SELF_ASSESSED_LEVEL_VALUES, SELF_LEVEL_LABELS),
        },
        {
          kind: 'date',
          name: 'start_date',
          label: 'Início',
          hint: 'Use AAAA, AAAA-MM ou AAAA-MM-DD.',
        },
        {
          kind: 'date',
          name: 'end_date',
          label: 'Fim',
          allowPresent: true,
          hint: 'Use AAAA, AAAA-MM ou AAAA-MM-DD. Marque "Atual" se ainda usa.',
        },
        { kind: 'list', name: 'tasks', label: 'Tarefas realizadas', hint: 'Um item por linha.' },
      ],
    },
  ],
};

const FULL_SPEC: FormSpec = {
  groups: [
    {
      id: 'main',
      title: 'Uso',
      fields: [
        { kind: 'text', name: 'skill_id', label: 'Competência' },
        { kind: 'text', name: 'usage_context', label: 'Onde você usou isso?' },
        ...SKILL_USAGE_SOURCE_FIELDS.map((name) => ({
          kind: 'text' as const,
          name,
          label: 'Origem',
        })),
      ],
    },
    ...DETAIL_SPEC.groups,
  ],
};

/** Origem fixa quando o formulario abre dentro de uma experiencia, projeto etc. */
export interface FixedSource {
  field: SourceField;
  id: string;
  context: UsageContext;
}

export interface SkillUsageFormProps {
  usage?: Json | undefined;
  usageId?: string | undefined;
  /** Competencia ja escolhida (aberto a partir de uma competencia). */
  fixedSkillId?: string | undefined;
  fixedSource?: FixedSource | undefined;
  onSaved: () => void;
  onCancel: () => void;
}

function sourceChoiceOf(usage: Json | undefined): string {
  if (usage === undefined) return '';
  for (const field of SKILL_USAGE_SOURCE_FIELDS) {
    const value = usage[field];
    if (typeof value === 'string') return `${field}:${value.toLowerCase()}`;
  }
  return '';
}

function ContextChooser() {
  const { field } = useController({ name: 'usage_context' });
  const {
    formState: { errors },
  } = useFormContext();
  const error = errorMessageAt(errors, 'usage_context');
  const groupId = useId();
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-base font-semibold text-slate-900">
        Onde você usou isso?{' '}
        <span aria-hidden="true" className="text-red-700">
          *
        </span>
      </legend>
      <p className="text-sm text-slate-700">
        A resposta muda como esta competência pode ser apresentada: experiência profissional,
        projeto, estudo e conhecimento declarado são tratados de forma diferente.
      </p>
      {CONTEXT_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-slate-900">
            {group.title}
            <span className="font-normal text-slate-700"> — {group.note}</span>
          </p>
          <div className="flex flex-col gap-2">
            {group.contexts.map((context) => {
              const id = `${groupId}-${context}`;
              return (
                <div key={context} className="flex items-start gap-3">
                  <input
                    id={id}
                    type="radio"
                    name={`${groupId}-context`}
                    value={context}
                    checked={field.value === context}
                    onChange={() => {
                      field.onChange(context);
                    }}
                    onBlur={field.onBlur}
                    aria-describedby={`${id}-help`}
                    className="mt-1 size-5 shrink-0 accent-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  />
                  <div className="flex flex-col">
                    <label htmlFor={id} className="text-base font-medium text-slate-900">
                      {USAGE_CONTEXT_LABELS[context]}
                    </label>
                    <span id={`${id}-help`} className="text-sm text-slate-700">
                      {USAGE_CONTEXT_HELP[context]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {error !== undefined ? <p className="text-sm font-medium text-red-800">{error}</p> : null}
    </fieldset>
  );
}

/**
 * Formulario "Onde voce usou isso?" (ADR-0007): escolhe a competencia (ou cria uma nova), o contexto
 * de uso e a origem (experiencia, projeto, formacao...). O contexto e estrutural: experiencia
 * profissional exige uma experiencia, projeto exige um projeto, e assim por diante. A origem so
 * oferece registros do tipo certo, entao "so estudei" nunca vira "experiencia profissional".
 */
export function SkillUsageForm({
  usage,
  usageId,
  fixedSkillId,
  fixedSource,
  onSaved,
  onCancel,
}: SkillUsageFormProps) {
  const editing = usage !== undefined && usageId !== undefined;
  const { index } = useProfileData();
  const create = useCreateRecord();
  const replace = useReplaceRecord();
  const [apiError, setApiError] = useState<string | undefined>();
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillError, setNewSkillError] = useState<string | undefined>();
  const [sourceError, setSourceError] = useState<string | undefined>();
  const [sourceChoice, setSourceChoice] = useState(sourceChoiceOf(usage));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  const skills = index.ofKind('skill');
  const baseResolver = useMemo(
    () => contractResolver(PROFILE_RECORD_SCHEMAS.skill_usage, FULL_SPEC),
    [],
  );
  const defaultValues = useMemo<FieldValues>(() => {
    if (editing) return toFormValues(usage);
    const values: FieldValues = { meta: { ...NEW_FACT_META } };
    if (fixedSkillId !== undefined) values.skill_id = fixedSkillId;
    if (fixedSource !== undefined) {
      values.usage_context = fixedSource.context;
      values[fixedSource.field] = fixedSource.id;
    }
    return values;
  }, [editing, usage, fixedSkillId, fixedSource]);

  const form = useForm<FieldValues>({
    defaultValues,
    resolver: (values, context, options) =>
      baseResolver(
        values.skill_id === NEW_SKILL ? { ...values, skill_id: PLACEHOLDER_SKILL_ID } : values,
        context,
        options,
      ),
  });
  const { setValue, control } = form;
  const context = useWatch({ control, name: 'usage_context' }) as UsageContext | undefined;
  const skillId = useWatch({ control, name: 'skill_id' }) as string | undefined;
  const rule = context !== undefined ? USAGE_CONTEXT_SOURCES[context] : undefined;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Origens que o contexto escolhido aceita, como opcoes "tipo: titulo".
  const sourceOptions = useMemo(() => {
    if (!rule?.required) return [];
    return rule.allowed.flatMap((field) =>
      index.ofKind(SOURCE_KIND[field]).map((record) => ({
        value: `${field}:${record.id}`,
        label: `${RECORD_KIND_LABELS[SOURCE_KIND[field]]}: ${describeRecord(SOURCE_KIND[field], record.value, index).title}`,
      })),
    );
  }, [rule, index]);

  const applySource = (choice: string): void => {
    setSourceChoice(choice);
    setSourceError(undefined);
    for (const field of SKILL_USAGE_SOURCE_FIELDS) setValue(field, null);
    const [field, id] = choice.split(':');
    if (field && id && (SKILL_USAGE_SOURCE_FIELDS as readonly string[]).includes(field)) {
      setValue(field, id);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setApiError(undefined);
    setNewSkillError(undefined);
    setSourceError(undefined);
    const wantsNewSkill = values.skill_id === NEW_SKILL;
    if (wantsNewSkill && newSkillName.trim() === '') {
      setNewSkillError('Informe o nome da nova competência.');
      return;
    }
    const currentContext = values.usage_context as UsageContext;
    const currentRule = USAGE_CONTEXT_SOURCES[currentContext];
    const hasSource = SKILL_USAGE_SOURCE_FIELDS.some((field) => {
      const value = getPath(values, field);
      return typeof value === 'string' && value !== '';
    });
    if (currentRule?.required === true && !hasSource) {
      setSourceError(
        `Para "${USAGE_CONTEXT_LABELS[currentContext]}", escolha a origem. Se não souber, use "Sem contexto verificado".`,
      );
      return;
    }
    // Contextos sem origem obrigatoria nao carregam origem solta vinda de uma escolha anterior.
    const record = pruneRecord(values);
    if (currentRule?.required !== true && !editing) {
      for (const field of SKILL_USAGE_SOURCE_FIELDS) delete record[field];
    }
    try {
      if (wantsNewSkill) {
        const meta = { ...(record.meta as Json | undefined) };
        const skill = await create.mutateAsync({
          kind: 'skill',
          record: { name: newSkillName.trim(), meta },
        });
        const createdId = skill.record.id;
        if (typeof createdId !== 'string') throw new Error('missing-skill-id');
        record.skill_id = createdId;
      }
      if (editing) await replace.mutateAsync({ id: usageId, record });
      else await create.mutateAsync({ kind: 'skill_usage', record });
      onSaved();
    } catch (error) {
      setApiError(messageForError(error));
    }
  });

  const skillFieldError = errorMessageAt(form.formState.errors, 'skill_id');
  const lockContext = fixedSource !== undefined;

  return (
    <FormProvider {...form}>
      <FormEnvProvider value={{ statesPath: 'meta.field_states' }}>
        <form
          aria-labelledby={titleId}
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
          className="flex flex-col gap-5 rounded-md border border-slate-400 bg-white p-4 sm:p-5"
        >
          <h4
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-slate-900 focus:outline-none"
          >
            {editing
              ? 'Editar onde a competência foi usada'
              : 'Registrar onde a competência foi usada'}
          </h4>

          {apiError !== undefined ? (
            <Alert tone="error" title="Não foi possível salvar">
              {apiError}
            </Alert>
          ) : null}

          {fixedSkillId === undefined ? (
            <div className="flex flex-col gap-3">
              <SelectField
                label="Competência"
                required
                placeholder="Escolha uma competência"
                options={[
                  ...skills.map((skill) => ({
                    value: skill.id,
                    label: describeRecord('skill', skill.value, index).title,
                  })),
                  { value: NEW_SKILL, label: 'Nova competência…' },
                ]}
                error={skillFieldError}
                value={typeof skillId === 'string' ? skillId.toLowerCase() : ''}
                onChange={(event) => {
                  setValue('skill_id', event.target.value || null, { shouldValidate: false });
                  setNewSkillError(undefined);
                }}
              />
              {skillId === NEW_SKILL ? (
                <TextField
                  label="Nome da nova competência"
                  required
                  value={newSkillName}
                  error={newSkillError}
                  onChange={(event) => {
                    setNewSkillName(event.target.value);
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {lockContext ? (
            <p className="text-sm text-slate-800">
              <span className="font-medium">Onde você usou isso:</span>{' '}
              {USAGE_CONTEXT_LABELS[fixedSource.context]} —{' '}
              {(() => {
                const record = index.byId.get(fixedSource.id.toLowerCase());
                return record
                  ? describeRecord(record.kind, record.value, index).title
                  : 'item selecionado';
              })()}
            </p>
          ) : (
            <ContextChooser />
          )}

          {!lockContext && rule?.required === true ? (
            <SelectField
              label="Origem"
              required
              placeholder="Escolha a origem"
              options={sourceOptions}
              value={sourceChoice}
              error={sourceError}
              hint={
                sourceOptions.length === 0
                  ? 'Você ainda não cadastrou itens deste tipo. Cadastre primeiro na seção correspondente ou escolha outro contexto.'
                  : 'O item em que você usou esta competência.'
              }
              onChange={(event) => {
                applySource(event.target.value);
              }}
            />
          ) : null}

          <details className="rounded-md border border-slate-300 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-base font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700">
              Detalhes do uso <span className="font-normal text-slate-700">(opcional)</span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-slate-300 p-4">
              {DETAIL_SPEC.groups.flatMap((group) =>
                group.fields.map((field) => <FieldRenderer key={field.name} def={field} />),
              )}
            </div>
          </details>

          <FieldStatesPanel spec={DETAIL_SPEC} statesPath="meta.field_states" />

          {!editing ? (
            <fieldset className="flex flex-col gap-3 rounded-md border border-slate-300 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-900">
                Situação e uso deste registro
              </legend>
              <GovernanceFields />
            </fieldset>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={create.isPending || replace.isPending}>
              {create.isPending || replace.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button
              variant="secondary"
              disabled={create.isPending || replace.isPending}
              onClick={onCancel}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </FormEnvProvider>
    </FormProvider>
  );
}
