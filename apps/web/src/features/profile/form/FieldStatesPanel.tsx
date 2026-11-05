import { FIELD_STATE_VALUES } from '@chameleon/contracts';
import { useController, useFormContext } from 'react-hook-form';
import { SelectField } from '../../../components/ui/SelectField';
import { leafFields, type FormSpec } from '../field-defs';
import { FIELD_STATE_HELP, FIELD_STATE_LABELS } from '../labels';

/**
 * Estados que a pessoa pode marcar. `not_provided` e o padrao (campo sem marca), por isso nao e
 * uma opcao: a marca so existe quando ha uma decisao explicita.
 */
const MARKABLE = FIELD_STATE_VALUES.filter((state) => state !== 'not_provided');

const VALUELESS = new Set(['not_applicable', 'declined', 'not_assessed']);

/**
 * Estados explicitos por campo (ADR-0005). `not_applicable` e `declined` suprimem novas perguntas;
 * `needs_confirmation` impede afirmar o valor. Ficam recolhidos para nao poluir o formulario.
 */
export function FieldStatesPanel({ spec, statesPath }: { spec: FormSpec; statesPath: string }) {
  const { field } = useController({ name: statesPath });
  const { setValue } = useFormContext();
  const states =
    typeof field.value === 'object' && field.value !== null
      ? (field.value as Record<string, string>)
      : {};
  const fields = leafFields(spec).filter((leaf) => !leaf.required);

  const choose = (fieldName: string, state: string): void => {
    const next = { ...states };
    if (state === '') delete next[fieldName];
    else next[fieldName] = state;
    field.onChange(Object.keys(next).length > 0 ? next : null);
    // O contrato nao aceita "nao se aplica" com valor preenchido: limpamos o valor.
    if (VALUELESS.has(state)) setValue(fieldName, null, { shouldDirty: true });
  };

  return (
    <details className="rounded-md border border-slate-300 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-base font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700">
        Estados dos campos (não se aplica, prefiro não informar…)
      </summary>
      <div className="flex flex-col gap-4 border-t border-slate-300 p-4">
        <p className="text-sm text-slate-700">
          Deixar um campo em branco quer dizer apenas &quot;ainda não informado&quot;. Use estas
          marcas quando já tiver uma decisão: campos marcados como &quot;não se aplica&quot; ou
          &quot;prefiro não informar&quot; deixam de ser perguntados.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((leaf) => {
            const current = states[leaf.name] ?? '';
            return (
              <SelectField
                key={leaf.name}
                label={`Estado de ${leaf.label}`}
                options={MARKABLE.map((state) => ({
                  value: state,
                  label: FIELD_STATE_LABELS[state],
                }))}
                placeholder="Sem marca"
                hint={
                  current !== '' && current in FIELD_STATE_HELP
                    ? FIELD_STATE_HELP[current as keyof typeof FIELD_STATE_HELP]
                    : undefined
                }
                value={current}
                onChange={(event) => {
                  choose(leaf.name, event.target.value);
                }}
              />
            );
          })}
        </div>
      </div>
    </details>
  );
}
