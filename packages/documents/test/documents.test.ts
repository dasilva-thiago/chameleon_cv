import { chromium } from 'playwright-core';
import {
  RESUME_EXPORT_TEMPLATES,
  resumeContentSchema,
  type ResumeContent,
} from '@chameleon/contracts';
import JSZip from 'jszip';
import { extractText, getDocumentProxy } from 'unpdf';
import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import {
  displayPhone,
  escapeHtml,
  exportFileName,
  renderDocx,
  renderHtml,
  renderPdf,
  renderResume,
  textLinesOf,
  toRenderModel,
} from '../src';

const id = (n: number): string => `0190a8f0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const HOSTILE = 'Criou <script>alert("x")</script> APIs & "painéis" <b>fortes</b> em Node.js.';

const bullets = (prefix: string, texts: string[], firstSource: number) =>
  texts.map((text, n) => ({
    id: `${prefix}-b${String(n + 1)}`,
    text,
    sourceIds: [id(firstSource + n)],
    origin: 'generated' as const,
  }));

function sample(language = 'pt-BR'): ResumeContent {
  return resumeContentSchema.parse({
    schemaVersion: 1,
    language,
    header: {
      name: 'Ana Souza Teste',
      headline: 'Pessoa desenvolvedora backend',
      location: 'Curitiba',
      contacts: [
        { kind: 'email', value: 'ana@example.test', label: null, sourceId: id(1) },
        { kind: 'link', value: 'https://github.com/ana-teste', label: null, sourceId: id(2) },
        { kind: 'link', value: 'javascript:alert(1)', label: null, sourceId: id(3) },
        { kind: 'phone', value: '+55 41 99999-0000', label: null, sourceId: id(4) },
      ],
    },
    sections: [
      {
        id: 'summary',
        kind: 'summary',
        title: 'Resumo',
        entries: [
          {
            id: 'summary-1',
            heading: 'Resumo',
            subheading: null,
            period: null,
            bullets: bullets('summary-1', ['Backend com foco em APIs.'], 10),
            sourceIds: [id(10)],
          },
        ],
      },
      {
        id: 'competencies',
        kind: 'competencies',
        title: 'Principais competências',
        entries: [
          {
            id: 'competencies-1',
            heading: 'Principais competências',
            subheading: null,
            period: null,
            bullets: bullets('competencies-1', ['Node.js', 'PostgreSQL'], 20),
            sourceIds: [id(20)],
          },
        ],
      },
      {
        id: 'experience',
        kind: 'experience',
        title: 'Experiência profissional',
        entries: [
          {
            id: 'experience-1',
            heading: 'Desenvolvedora Backend',
            subheading: 'Acme Ltda.',
            period: '03/2022 – Atual',
            detail: 'Curitiba - PR',
            bullets: [
              { id: 'experience-1-b1', text: HOSTILE, sourceIds: [id(30)], origin: 'edited' },
              {
                id: 'experience-1-b2',
                text: 'Manteve rotinas de deploy.',
                sourceIds: [id(31)],
                origin: 'generated',
              },
            ],
            sourceIds: [id(30)],
          },
        ],
      },
      {
        id: 'projects',
        kind: 'projects',
        title: 'Projetos',
        entries: [
          {
            id: 'project-1',
            heading: 'Painel de métricas',
            subheading: null,
            period: null,
            detail: 'TypeScript, Node.js, PostgreSQL',
            url: 'https://example.test/painel',
            bullets: bullets('project-1', ['Painel de métricas de equipamentos.'], 50),
            sourceIds: [id(50)],
          },
        ],
      },
      {
        id: 'education',
        kind: 'education',
        title: 'Formação acadêmica',
        entries: [
          {
            id: 'education-1',
            heading: 'Sistemas de Informação',
            subheading: 'UFPR',
            period: '2019 – 2023',
            detail: 'Curitiba, PR',
            bullets: [],
            sourceIds: [id(40)],
          },
        ],
      },
      {
        id: 'certifications',
        kind: 'certifications',
        title: 'Certificações e cursos',
        entries: [
          {
            id: 'certification-1',
            heading: 'AWS Cloud Practitioner',
            subheading: 'AWS',
            period: '2024',
            bullets: [],
            sourceIds: [id(60)],
          },
        ],
      },
      {
        id: 'skills',
        kind: 'skills',
        title: 'Habilidades',
        entries: [
          {
            id: 'skills-1',
            heading: 'Linguagens',
            subheading: null,
            period: null,
            bullets: bullets('skills-1', ['Python', 'Ação & Reação'], 70),
            sourceIds: [id(70)],
          },
        ],
      },
      {
        id: 'languages',
        kind: 'languages',
        title: 'Idiomas',
        entries: [
          {
            id: 'language-1',
            heading: 'Inglês',
            subheading: 'avançado',
            period: null,
            bullets: [],
            sourceIds: [id(80)],
          },
        ],
      },
    ],
  });
}

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Asserts that `lines` appear in `text` in this order (whitespace-insensitive). */
function expectInOrder(text: string, lines: readonly string[], ignoreCase = false): void {
  const fold = (value: string): string => (ignoreCase ? value.toLowerCase() : value);
  const haystack = fold(squash(text));
  let from = 0;
  for (const line of lines) {
    const at = haystack.indexOf(fold(squash(line)), from);
    expect(at, `missing or out of order: "${line}"`).toBeGreaterThanOrEqual(from);
    from = at + squash(line).length;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function docxParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
  const core = await zip.file('docProps/core.xml')!.async('string');
  const paragraphs = xml
    .split('</w:p>')
    .map((chunk) =>
      [...chunk.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((m) => decodeXml(m[1] ?? ''))
        .join(''),
    )
    .filter((text) => text !== '');
  return { zip, xml, rels, core, text: paragraphs.join('\n') };
}

const TEMPLATES = RESUME_EXPORT_TEMPLATES;

describe('render model', () => {
  it('keeps the content; summary is running text, key skills are tags, skills are groups', () => {
    const model = toRenderModel(sample());
    expect(model.paper).toBe('A4');
    expect(model.sections[0]?.paragraphs).toEqual(['Backend com foco em APIs.']);
    expect(model.sections[1]?.tags).toEqual(['Node.js', 'PostgreSQL']);
    const skills = model.sections.find((section) => section.kind === 'skills');
    expect(skills?.groups).toEqual([{ label: 'Linguagens', items: ['Python', 'Ação & Reação'] }]);
    const project = model.sections.find((section) => section.kind === 'projects')?.entries[0];
    expect(project).toMatchObject({
      detail: 'TypeScript, Node.js, PostgreSQL',
      url: 'https://example.test/painel',
    });
    expect(toRenderModel(sample('en-US')).paper).toBe('Letter');
  });

  it('reads in a template-specific order (classic keeps the original; modern puts the company first)', () => {
    const model = toRenderModel(sample());
    const classic = textLinesOf(model, 'classic');
    expect(classic.slice(0, 3)).toEqual([
      'Ana Souza Teste',
      'Pessoa desenvolvedora backend',
      'Curitiba',
    ]);
    const modern = textLinesOf(model, 'modern');
    expect(modern.slice(0, 2)).toEqual(['Ana Souza Teste', 'Pessoa desenvolvedora backend']);
    expect(modern[modern.indexOf('Experiência profissional') + 1]).toBe('Acme Ltda.');
    expect(modern).toContain('Linguagens: Python, Ação & Reação');
  });

  it('only turns safe values into links, and shortens link text only for the modern template', () => {
    const contacts = toRenderModel(sample()).contacts;
    expect(contacts.map((c) => c.href)).toEqual([
      'mailto:ana@example.test',
      'https://github.com/ana-teste',
      null,
      'tel:+5541999990000',
    ]);
    expect(contacts[1]).toMatchObject({
      text: 'https://github.com/ana-teste',
      display: 'github.com/ana-teste',
    });
  });

  it('refuses an entry url that is not http(s) at the contract level', () => {
    const content = sample();
    const project = content.sections.find((section) => section.kind === 'projects')?.entries[0];
    if (project) project.url = 'javascript:alert(1)';
    expect(() => resumeContentSchema.parse(content)).toThrow();
  });

  it('formats Brazilian numbers stored as bare digits and leaves the rest alone', () => {
    expect(displayPhone('11987654321')).toBe('(11) 98765-4321');
    expect(displayPhone('1133334444')).toBe('(11) 3333-4444');
    expect(displayPhone('+5511987654321')).toBe('+55 (11) 98765-4321');
    expect(displayPhone('+351912345678')).toBe('+351912345678');
    expect(displayPhone('(11) 98765-4321')).toBe('(11) 98765-4321');
  });
});

describe('HTML', () => {
  it.each(TEMPLATES)(
    '%s: escapes every dynamic value, with no script and no javascript: link',
    (template) => {
      const html = renderHtml(toRenderModel(sample()), template);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<b>');
      expect(html).not.toMatch(/href="javascript:/i);
      expect(html).toContain(escapeHtml(HOSTILE));
      expect(html).toContain('Content-Security-Policy');
      expect(html).not.toMatch(/<iframe|<img |<link /i);
      expect(html).toContain('lang="pt-BR"');
    },
  );

  it('classic is the original single column of semantic elements', () => {
    const html = renderHtml(toRenderModel(sample()), 'classic');
    expect(html).toContain('<h1>Ana Souza Teste</h1>');
    expect(html).toContain('<h2>Experiência profissional</h2>');
    expect(html).not.toContain('competency-tag');
  });

  it('modern has the accent header, key-skill tags, project link and short contact text', () => {
    const html = renderHtml(toRenderModel(sample()), 'modern');
    expect(html).toContain('class="header-gradient"');
    expect(html).toContain('<div class="header-title">Pessoa desenvolvedora backend</div>');
    expect(html).toContain('<span class="competency-tag">Node.js</span>');
    expect(html).toContain('<a href="https://example.test/painel">Painel de métricas</a>');
    expect(html).toContain('>github.com/ana-teste</a>');
    expect(html).toContain('<div class="project-tech">TypeScript, Node.js, PostgreSQL</div>');
    expect(html).toContain('<span class="job-company">Acme Ltda.</span>');
    expect(html).toContain('<div class="job-role">Desenvolvedora Backend</div>');
    expect(html).toContain('<div class="job-location">Curitiba - PR</div>');
  });

  it('defaults to the modern template', () => {
    const model = toRenderModel(sample());
    expect(renderHtml(model)).toBe(renderHtml(model, 'modern'));
  });
});

describe('DOCX', () => {
  it.each(TEMPLATES)(
    '%s: is a valid editable document with the model text in order, real links and no tables or images',
    async (template) => {
      const model = toRenderModel(sample());
      const bytes = await renderDocx(model, template);
      expect(bytes.length).toBeGreaterThan(2_000);
      const { xml, rels, core, text, zip } = await docxParts(bytes);
      expectInOrder(text, textLinesOf(model, template));
      expect(text).toContain(HOSTILE); // literal text, not markup
      expect(xml).not.toContain('<w:tbl>');
      expect(xml).not.toContain('<w:drawing');
      expect(Object.keys(zip.files).some((name) => name.startsWith('word/media/'))).toBe(false);
      expect(rels).toContain('mailto:ana@example.test');
      expect(rels).toContain('https://github.com/ana-teste');
      expect(rels).not.toContain('javascript:');
      expect(xml).toContain('w:numPr'); // real bullet list
      expect(core).toContain('Ana Souza Teste');
      expect(core).not.toContain('99999');
    },
  );

  it('modern links the public project and uses the accent colors', async () => {
    const { xml, rels } = await docxParts(await renderDocx(toRenderModel(sample()), 'modern'));
    expect(rels).toContain('https://example.test/painel');
    expect(xml).toContain('w:val="15808E"');
    expect(xml).toContain('w:fill="EDF6F7"'); // key-skill tags
  });

  it('uses Letter pages for en-US', async () => {
    const { xml } = await docxParts(await renderDocx(toRenderModel(sample('en-US'))));
    expect(xml).toContain('w:w="12240"');
  });
});

let browserAvailable = false;
beforeAll(async () => {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    browserAvailable = true;
  } catch {
    browserAvailable = false;
  }
}, 60_000);

describe('PDF', () => {
  for (const template of TEMPLATES) {
    it(`${template}: prints selectable text in the model order, within two pages, with link annotations`, async (context: TestContext) => {
      if (!browserAvailable) context.skip();
      const model = toRenderModel(sample());
      const bytes = await renderPdf(model, { template });
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      expect(totalPages).toBeLessThanOrEqual(2);
      // The modern template prints the headline and section titles in capitals (CSS), as the reference CVs do.
      expectInOrder(text, textLinesOf(model, template), template === 'modern');
      expect(text).toContain('<script>alert("x")</script>'); // literal, never executed or dropped
      const page = await pdf.getPage(1);
      const annotations = (await page.getAnnotations()) as { subtype: string; url?: string }[];
      const urls = annotations.filter((a) => a.subtype === 'Link').map((a) => a.url ?? '');
      expect(urls).toEqual(
        expect.arrayContaining(['mailto:ana@example.test', 'https://github.com/ana-teste']),
      );
      expect(urls.some((url) => url.startsWith('javascript:'))).toBe(false);
    }, 60_000);
  }

  it('does not leak script execution or the network into the file', async (context) => {
    if (!browserAvailable) context.skip();
    const content = sample();
    content.header.name = '<img src="https://example.invalid/x.png"> Ana';
    const bytes = await renderPdf(toRenderModel(content));
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), {
      mergePages: true,
    });
    expect(text).toContain('<img src="https://example.invalid/x.png"> Ana');
  }, 60_000);
});

describe('renderResume', () => {
  it('html returns the document as UTF-8 text, in the chosen template (modern by default)', async () => {
    const content = sample();
    const modern = new TextDecoder().decode(await renderResume(content, 'html'));
    expect(modern).toContain('class="header-gradient"');
    const classic = new TextDecoder().decode(
      await renderResume(content, 'html', { template: 'classic' }),
    );
    expect(classic).toContain('<h1>Ana Souza Teste</h1>');
  });

  it('docx is a zip in both templates', async () => {
    for (const template of TEMPLATES) {
      const bytes = await renderResume(sample(), 'docx', { template });
      expect(new TextDecoder().decode(bytes.slice(0, 2))).toBe('PK');
    }
  });
});

describe('file name', () => {
  const date = new Date('2026-11-05T12:00:00.000Z');
  it('is ASCII, safe and skips absent parts instead of inventing them', () => {
    expect(
      exportFileName(
        { name: 'Ana Souza Teste', title: 'Dev Backend', company: 'Acme Ltda.', date },
        'pdf',
      ),
    ).toBe('Ana-Souza-Teste_Dev-Backend_Acme-Ltda_20261105.pdf');
    expect(exportFileName({ name: 'João "O Grande" ../../x', date }, 'docx')).toBe(
      'Joao-O-Grande-x_20261105.docx',
    );
    expect(exportFileName({ name: '???', date }, 'pdf')).toBe('curriculo_20261105.pdf');
    expect(exportFileName({ name: 'Ana', date }, 'html')).toBe('Ana_20261105.html');
    expect(exportFileName({ name: 'x'.repeat(200), date }, 'pdf').length).toBeLessThan(60);
  });
});
