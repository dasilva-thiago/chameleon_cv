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
      className="flex flex-col gap-5 bg-paper p-8 font-sans text-[0.9375rem] leading-relaxed text-paper-ink shadow-md ring-1 ring-paper-line print:p-0 print:shadow-none print:ring-0 sm:p-10"
    >
      <header className="flex flex-col gap-1 border-b border-paper-line pb-3">
        <h2 className="text-[1.625rem] font-bold leading-tight">{header.name}</h2>
        {header.headline !== null ? <p className="text-[1.0625rem]">{header.headline}</p> : null}
        {header.location !== null ? <p>{header.location}</p> : null}
        {contactLine.length > 0 ? <p>{contactLine.join(' · ')}</p> : null}
      </header>
      {content.sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-3 break-inside-avoid">
          <h3 className="border-b border-paper-line pb-0.5 text-[0.9375rem] font-semibold uppercase tracking-wider">
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
                  {entry.period !== null ? (
                    <p className="text-[0.8125rem] text-paper-muted">{entry.period}</p>
                  ) : null}
                </div>
              )}
              {entry.detail !== null && entry.detail !== undefined ? (
                <p className="text-[0.8125rem] text-paper-muted">{entry.detail}</p>
              ) : null}
              {section.kind === 'competencies' ? (
                <ul className="flex flex-wrap gap-2">
                  {entry.bullets.map((bullet) => (
                    <li
                      key={bullet.id}
                      className="rounded border border-paper-line bg-paper-chip px-2 py-0.5 text-[0.8125rem]"
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
