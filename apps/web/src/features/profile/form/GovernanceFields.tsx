import { useFormContext, useWatch } from 'react-hook-form';
import { SelectField } from '../../../components/ui/SelectField';
import {
  RESUME_USE_HELP,
  RESUME_USE_LABELS,
  STATUS_HELP,
  VISIBILITY_HELP,
  VISIBILITY_LABELS,
} from '../labels';
import type { FactStatus, ResumeUse, Visibility } from '@chameleon/contracts';

/** Valores de governanca de um registro novo (ADR-0005: cadastro pelo formulario = `form_entry`). */
export const NEW_FACT_META = {
  source: 'form_entry',
  status: 'needs_review',
  visibility: 'public',
  resume_use: 'allowed',
} as const;

/**
 * Governanca de um registro NOVO: a pessoa decide ja no cadastro se confirma agora (ADR-0005),
 * quem pode ver e se pode ir a currículos. Em registros existentes, estes controles ficam no
 * cartao do item (`GovernanceEditor`) e usam a rota de metadados.
 */
export function GovernanceFields() {
  const { register, control } = useFormContext();
  const status = useWatch({ control, name: 'meta.status' }) as FactStatus | undefined;
  const visibility = useWatch({ control, name: 'meta.visibility' }) as Visibility | undefined;
  const resumeUse = useWatch({ control, name: 'meta.resume_use' }) as ResumeUse | undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label="Situação do item"
        placeholder={null}
        options={[
          { value: 'needs_review', label: 'Salvar para revisar depois' },
          { value: 'confirmed', label: 'Já confirmo estas informações' },
        ]}
        hint={status !== undefined ? STATUS_HELP[status] : undefined}
        {...register('meta.status')}
      />
      <SelectField
        label="Quem pode ver"
        placeholder={null}
        options={Object.entries(VISIBILITY_LABELS).map(([value, label]) => ({ value, label }))}
        hint={visibility !== undefined ? VISIBILITY_HELP[visibility] : undefined}
        {...register('meta.visibility')}
      />
      <SelectField
        label="Uso em currículos"
        placeholder={null}
        options={Object.entries(RESUME_USE_LABELS).map(([value, label]) => ({ value, label }))}
        hint={resumeUse !== undefined ? RESUME_USE_HELP[resumeUse] : undefined}
        {...register('meta.resume_use')}
      />
    </div>
  );
}
