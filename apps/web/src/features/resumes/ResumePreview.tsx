import type { ResumeContent } from '@chameleon/contracts';

/**
 * Pre-visualizacao do documento: so o conteudo (nome, contatos, secoes), sem avisos.
 * E o que o arquivo exportado contem. HTML semantico e estilos de impressao simples.
 */
export function ResumePreview({ content }: { content: ResumeContent }) {
  const { header } = content;
  const contactLine = header.contacts.map((contact) => contact.value);
  return (
    <article
      aria-label="Pré-visualização do currículo"
      lang={content.language}
      className="flex flex-col gap-5 rounded-md border border-slate-400 bg-white p-6 text-slate-900 print:border-0 print:p-0"
    >
      <header className="flex flex-col gap-1 border-b border-slate-300 pb-3">
        <h2 className="text-2xl font-bold">{header.name}</h2>
        {header.headline !== null ? <p className="text-lg">{header.headline}</p> : null}
        {header.location !== null ? <p>{header.location}</p> : null}
        {contactLine.length > 0 ? <p>{contactLine.join(' · ')}</p> : null}
      </header>
      {content.sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-3 break-inside-avoid">
          <h3 className="border-b border-slate-300 text-lg font-semibold uppercase tracking-wide">
            {section.title}
          </h3>
          {section.entries.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-1">
              {entry.heading === section.title &&
              entry.subheading === null &&
              entry.period === null ? null : (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <h4 className="font-semibold">
                    {entry.heading}
                    {entry.subheading !== null ? (
                      <span className="font-normal"> — {entry.subheading}</span>
                    ) : null}
                  </h4>
                  {entry.period !== null ? <p className="text-sm">{entry.period}</p> : null}
                </div>
              )}
              {entry.detail !== null && entry.detail !== undefined ? (
                <p className="text-sm text-slate-600">{entry.detail}</p>
              ) : null}
              {section.kind === 'competencies' ? (
                <ul className="flex flex-wrap gap-2">
                  {entry.bullets.map((bullet) => (
                    <li
                      key={bullet.id}
                      className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-sm text-teal-900"
                    >
                      {bullet.text}
                    </li>
                  ))}
                </ul>
              ) : section.kind === 'skills' ? (
                <p>{entry.bullets.map((bullet) => bullet.text).join(', ')}</p>
              ) : entry.bullets.length > 0 ? (
                <ul className="list-disc pl-5">
                  {entry.bullets.map((bullet) => (
                    <li key={bullet.id}>{bullet.text}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
