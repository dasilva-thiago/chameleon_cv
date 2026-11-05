import { SKILL_USAGE_SOURCE_FIELDS, type UsageContext } from '@chameleon/contracts';
import { useRef, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { useProfileData } from './context';
import { describeRecord, idOf, type Json } from './document';
import { RECORD_KIND_LABELS, SELF_LEVEL_LABELS, USAGE_CONTEXT_LABELS } from './labels';
import { RecordCard } from './RecordCard';
import { SkillUsageForm, type FixedSource } from './SkillUsageForm';

type Mode = { type: 'idle' } | { type: 'create' } | { type: 'edit'; id: string };

/**
 * Usos de competencia ("Onde voce usou isso?") de UMA competencia ou de UMA origem (experiencia,
 * projeto...). O mesmo painel serve a pagina de competencias e aos cartoes de experiencia e projeto.
 */
export function SkillUsagesPanel({
  skillId,
  source,
  emptyText,
  addLabel,
}: {
  skillId?: string;
  source?: FixedSource;
  emptyText: string;
  addLabel: string;
}) {
  const { index } = useProfileData();
  const [mode, setMode] = useState<Mode>({ type: 'idle' });
  const [notice, setNotice] = useState<string | undefined>();
  const addRef = useRef<HTMLButtonElement>(null);

  const usages = index.ofKind('skill_usage').filter((usage) => {
    if (skillId !== undefined) return String(usage.value.skill_id).toLowerCase() === skillId;
    if (source !== undefined) return String(usage.value[source.field]).toLowerCase() === source.id;
    return false;
  });

  const close = (message?: string): void => {
    setMode({ type: 'idle' });
    setNotice(message);
    requestAnimationFrame(() => addRef.current?.focus());
  };

  const labelsOf = (usage: Json): { title: string; subtitle: string } => {
    const context = usage.usage_context as UsageContext;
    const contextLabel = USAGE_CONTEXT_LABELS[context];
    const level =
      typeof usage.level_in_context === 'string' && usage.level_in_context in SELF_LEVEL_LABELS
        ? ` · nível: ${SELF_LEVEL_LABELS[usage.level_in_context as keyof typeof SELF_LEVEL_LABELS]}`
        : '';
    if (source !== undefined) {
      const skill = index.byId.get(String(usage.skill_id).toLowerCase());
      return {
        title: skill ? describeRecord('skill', skill.value, index).title : 'Competência',
        subtitle: `${contextLabel}${level}`,
      };
    }
    const field = SKILL_USAGE_SOURCE_FIELDS.find((name) => typeof usage[name] === 'string');
    const origin = field ? index.byId.get(String(usage[field]).toLowerCase()) : undefined;
    return {
      title: contextLabel,
      subtitle: `${
        origin
          ? `${RECORD_KIND_LABELS[origin.kind]}: ${describeRecord(origin.kind, origin.value, index).title}`
          : 'Sem origem indicada'
      }${level}`,
    };
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="status" aria-live="polite">
        {notice !== undefined ? <Alert tone="success">{notice}</Alert> : null}
      </div>
      {usages.length === 0 && mode.type !== 'create' ? (
        <p className="text-sm text-slate-800">{emptyText}</p>
      ) : null}
      {usages.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {usages.map((usage) => {
            const id = idOf(usage.value);
            if (id === undefined) return null;
            const editing = mode.type === 'edit' && mode.id === id;
            const labels = labelsOf(usage.value);
            return (
              <li key={id}>
                {editing ? (
                  <SkillUsageForm
                    usage={usage.value}
                    usageId={id}
                    fixedSkillId={skillId}
                    fixedSource={source}
                    onSaved={() => {
                      close('Uso da competência salvo.');
                    }}
                    onCancel={() => {
                      close();
                    }}
                  />
                ) : (
                  <RecordCard
                    kind="skill_usage"
                    id={id}
                    record={usage.value}
                    level={4}
                    titleOverride={labels.title}
                    subtitleOverride={labels.subtitle}
                    onEdit={() => {
                      setNotice(undefined);
                      setMode({ type: 'edit', id });
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {mode.type === 'create' ? (
        <SkillUsageForm
          fixedSkillId={skillId}
          fixedSource={source}
          onSaved={() => {
            close('Uso da competência registrado.');
          }}
          onCancel={() => {
            close();
          }}
        />
      ) : (
        <div>
          <Button
            ref={addRef}
            variant="secondary"
            onClick={() => {
              setNotice(undefined);
              setMode({ type: 'create' });
            }}
          >
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Origem fixa de uma experiencia (contexto profissional). */
export const experienceSource = (id: string): FixedSource => ({
  field: 'experience_id',
  id,
  context: 'professional_experience',
});

/** Origem fixa de um projeto (contexto de projeto). */
export const projectSource = (id: string): FixedSource => ({
  field: 'project_id',
  id,
  context: 'project_experience',
});
