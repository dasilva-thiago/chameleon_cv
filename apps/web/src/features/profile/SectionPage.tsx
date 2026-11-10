import { useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { useProfileData } from './context';
import { blockOf, childrenOf, collectionOf, type Json } from './document';
import { BLOCK_FORMS } from './field-defs';
import { BlockForm } from './form/BlockForm';
import { RecordCollection } from './RecordCollection';
import { completionOf, sectionBySlug, type SectionDef } from './sections';
import { SkillUsagesPanel, experienceSource, projectSource } from './SkillUsagesPanel';

/** Sinaliza em TEXTO as secoes privadas por construcao. */
const PRIVATE_SECTIONS = new Set(['availability_preferences', 'career_preferences']);

function ExperienceDetail({ id, record }: { id: string; record: Json }) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Itens da experiência" className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          Responsabilidades, conquistas e entregas
        </h3>
        <RecordCollection
          kind="experience_item"
          parentId={id}
          records={childrenOf(record, 'items')}
          level={4}
          listLabel="Itens da experiência"
          emptyText="Nenhum item cadastrado nesta experiência ainda."
          addLabel="Adicionar item"
        />
      </section>
      <section aria-label="Competências desta experiência" className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-slate-900">Competências usadas aqui</h3>
        <SkillUsagesPanel
          source={experienceSource(id)}
          emptyText="Nenhuma competência registrada para esta experiência ainda."
          addLabel="Registrar competência usada aqui"
        />
      </section>
    </div>
  );
}

function ProjectDetail({ id, record }: { id: string; record: Json }) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Itens do projeto" className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-slate-900">Entregas e resultados</h3>
        <RecordCollection
          kind="project_item"
          parentId={id}
          records={childrenOf(record, 'items')}
          level={4}
          listLabel="Itens do projeto"
          emptyText="Nenhum item cadastrado neste projeto ainda."
          addLabel="Adicionar item"
        />
      </section>
      <section aria-label="Colaboradores do projeto" className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-slate-900">Colaboradores</h3>
        <RecordCollection
          kind="collaborator"
          parentId={id}
          records={childrenOf(record, 'collaborators')}
          level={4}
          listLabel="Colaboradores do projeto"
          emptyText="Nenhum colaborador cadastrado neste projeto ainda."
          addLabel="Adicionar colaborador"
        />
      </section>
      <section aria-label="Competências deste projeto" className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-slate-900">Competências usadas aqui</h3>
        <SkillUsagesPanel
          source={projectSource(id)}
          emptyText="Nenhuma competência registrada para este projeto ainda."
          addLabel="Registrar competência usada aqui"
        />
      </section>
    </div>
  );
}

function SkillDetail({ id }: { id: string }) {
  return (
    <SkillUsagesPanel
      skillId={id}
      emptyText="Ainda não há registro de onde você usou esta competência."
      addLabel="Onde você usou isso?"
    />
  );
}

function CollectionSection({ def }: { def: SectionDef }) {
  const { document } = useProfileData();
  const kind = def.recordKind;
  if (kind === undefined) return null;
  let records: Json[];
  if (def.section === 'usage_rules') {
    const rules = blockOf(document, 'usage_rules');
    records = Array.isArray(rules?.restrictions) ? (rules.restrictions as Json[]) : [];
  } else {
    records = collectionOf(document, def.section);
  }

  const extrasFor = (record: Json, id: string) => {
    if (kind === 'experience') {
      return {
        summary: 'Itens e competências desta experiência',
        content: <ExperienceDetail id={id} record={record} />,
      };
    }
    if (kind === 'project') {
      return {
        summary: 'Itens, colaboradores e competências deste projeto',
        content: <ProjectDetail id={id} record={record} />,
      };
    }
    if (kind === 'skill') {
      return { summary: 'Onde você usou isso?', content: <SkillDetail id={id} /> };
    }
    return undefined;
  };

  const intro =
    kind === 'skill' ? (
      <p className="text-sm text-slate-700">
        Cadastre a competência aqui e registre, em cada uma, <strong>onde você a usou</strong>:
        experiência profissional, projeto, curso, certificação ou apenas conhecimento declarado.
        Também dá para registrar o uso dentro de cada experiência ou projeto.
      </p>
    ) : kind === 'restriction' ? (
      <p className="text-sm text-slate-700">
        Restrições valem para qualquer currículo gerado. Esta seção é privada.
      </p>
    ) : undefined;

  return (
    <RecordCollection
      kind={kind}
      records={records}
      emptyText={def.emptyText}
      addLabel={def.addLabel ?? 'Adicionar'}
      listLabel={def.label}
      extrasFor={extrasFor}
      deleteHint={
        kind === 'skill'
          ? 'Se a competência tiver usos registrados, exclua os usos antes.'
          : kind === 'experience' || kind === 'project'
            ? 'Os itens internos também serão excluídos.'
            : undefined
      }
      intro={intro}
    />
  );
}

function BlockSection({ def }: { def: SectionDef }) {
  const { document } = useProfileData();
  const [saved, setSaved] = useState(false);
  const spec = BLOCK_FORMS[def.section];
  if (!spec) return null;
  return (
    <div className="flex flex-col gap-4">
      {saved ? (
        <div role="status">
          <Alert tone="success">Seção salva.</Alert>
        </div>
      ) : null}
      <BlockForm
        section={def.section}
        spec={spec}
        value={blockOf(document, def.section)}
        title={`Dados de ${def.label.toLowerCase()}`}
        onSaved={() => {
          setSaved(true);
        }}
      />
    </div>
  );
}

export function SectionPage() {
  const { slug } = useParams();
  const def = sectionBySlug(slug);
  const { document } = useProfileData();
  usePageTitle(def?.label ?? 'Perfil');
  if (def === undefined) return <Navigate to="/perfil" replace />;
  const completion = completionOf(def, document);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={def.label}
        meta={
          <div className="flex flex-col gap-2">
            <p className="text-base text-slate-800">{def.description}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone={completion.state === 'to_review' ? 'warn' : 'neutral'}>
                {completion.text}
              </Badge>
              {PRIVATE_SECTIONS.has(def.section) ? (
                <Badge tone="info">Privada: nunca vai a currículos</Badge>
              ) : null}
            </div>
          </div>
        }
      />
      {def.type === 'block' ? (
        <BlockSection key={def.slug} def={def} />
      ) : (
        <CollectionSection key={def.slug} def={def} />
      )}
    </div>
  );
}
