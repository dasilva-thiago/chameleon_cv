import { Link } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Badge } from '../../components/ui/Badge';
import { useProfileData } from './context';
import { ExportCard } from './ExportCard';
import { SECTION_GROUPS, SECTIONS, completionOf } from './sections';

function Stat({ label, value, to }: { label: string; value: string; to?: string }) {
  const content = (
    <>
      <span className="text-2xl font-semibold text-slate-900">{value}</span>
      <span className="text-sm text-slate-800">{label}</span>
    </>
  );
  const className =
    'flex flex-col gap-1 rounded-md border border-slate-400 bg-white p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
  return to !== undefined ? (
    <Link to={to} className={`${className} hover:bg-slate-50`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/**
 * Visao geral: orienta sem exigir nada. Mostra por onde seguir, o que aguarda revisao e o estado de
 * cada secao em texto. Perfil vazio nunca e tratado como falha da pessoa.
 */
export function ProfileOverviewPage() {
  usePageTitle('Perfil profissional');
  const { document, summary, exists } = useProfileData();
  const empty = !exists || summary.recordCount === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <PageHeading>Perfil profissional</PageHeading>
        <p className="text-base text-slate-800">
          Monte seu perfil no seu ritmo. Nenhuma seção é obrigatória: preencha o que souber agora e
          volte quando quiser. Deixar algo em branco significa apenas &quot;ainda não
          informado&quot;.
        </p>
      </div>

      {empty ? (
        <section
          aria-labelledby="comecar"
          className="flex flex-col gap-3 rounded-md border border-blue-700 bg-blue-50 p-4"
        >
          <h2 id="comecar" className="text-lg font-semibold text-blue-950">
            Por onde começar
          </h2>
          <p className="text-sm text-blue-950">
            Seu perfil ainda não tem itens cadastrados. Você pode começar por qualquer seção ou
            trazer o que já tem de um arquivo.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/perfil/identidade"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Preencher identidade
            </Link>
            <Link
              to="/perfil/importar"
              className="inline-flex min-h-11 items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Importar um arquivo
            </Link>
          </div>
        </section>
      ) : (
        <section aria-label="Resumo do perfil" className="grid gap-3 sm:grid-cols-3">
          <Stat label="itens cadastrados" value={String(summary.recordCount)} />
          <Stat
            label="aguardando sua confirmação"
            value={String(summary.byStatus.needs_review)}
            to="/perfil/confirmar"
          />
          <Stat
            label="pendências abertas"
            value={String(summary.pending.open)}
            to="/perfil/pendencias"
          />
        </section>
      )}

      <section aria-labelledby="secoes" className="flex flex-col gap-4">
        <h2 id="secoes" className="text-lg font-semibold">
          Seções do perfil
        </h2>
        {SECTION_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-slate-900">{group.label}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {SECTIONS.filter((section) => section.group === group.id).map((section) => {
                const completion = completionOf(section, document);
                return (
                  <li key={section.slug}>
                    <Link
                      to={`/perfil/${section.slug}`}
                      className="flex h-full flex-col gap-1 rounded-md border border-slate-400 bg-white p-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                    >
                      <span className="font-medium text-slate-900">{section.label}</span>
                      <span className="text-sm text-slate-700">{section.description}</span>
                      <span className="mt-1">
                        <Badge tone={completion.state === 'to_review' ? 'warn' : 'neutral'}>
                          {completion.text}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <ExportCard disabled={!exists} />
    </div>
  );
}
