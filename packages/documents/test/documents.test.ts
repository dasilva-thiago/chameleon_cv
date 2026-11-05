import { chromium } from 'playwright-core';
import { resumeContentSchema, type ResumeContent } from '@chameleon/contracts';
import JSZip from 'jszip';
import { extractText, getDocumentProxy } from 'unpdf';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  escapeHtml,
  exportFileName,
  renderDocx,
  renderHtml,
  renderPdf,
  textLinesOf,
  toRenderModel,
} from '../src';

const id = (n: number): string => `0190a8f0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const HOSTILE = 'Criou <script>alert("x")</script> APIs & "painéis" <b>fortes</b> em Node.js.';

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
            bullets: [
              {
                id: 'summary-1-b1',
                text: 'Backend com foco em APIs.',
                sourceIds: [id(10)],
                origin: 'generated',
              },
            ],
            sourceIds: [id(10)],
          },
        ],
      },
      {
        id: 'skills',
        kind: 'skills',
        title: 'Competências',
        entries: [
          {
            id: 'skills-1',
            heading: 'Tecnologias e competências',
            subheading: null,
            period: null,
            bullets: ['Node.js', 'PostgreSQL', 'Ação & Reação'].map((text, n) => ({
              id: `skills-1-b${String(n + 1)}`,
              text,
              sourceIds: [id(20 + n)],
              origin: 'generated' as const,
            })),
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
        id: 'education',
        kind: 'education',
        title: 'Formação acadêmica',
        entries: [
          {
            id: 'education-1',
            heading: 'Sistemas de Informação',
            subheading: 'UFPR',
            period: '2019 – 2023',
            bullets: [],
            sourceIds: [id(40)],
          },
        ],
      },
    ],
  });
}

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Asserts that `lines` appear in `text` in this order (whitespace-insensitive). */
function expectInOrder(text: string, lines: readonly string[]): void {
  const haystack = squash(text);
  let from = 0;
  for (const line of lines) {
    const at = haystack.indexOf(squash(line), from);
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

describe('render model', () => {
  it('keeps the content and reading order; skills and summary are running text', () => {
    const model = toRenderModel(sample());
    expect(model.paper).toBe('A4');
    const lines = textLinesOf(model);
    expect(lines.slice(0, 3)).toEqual([
      'Ana Souza Teste',
      'Pessoa desenvolvedora backend',
      'Curitiba',
    ]);
    expect(model.sections[1]?.paragraphs).toEqual(['Node.js · PostgreSQL · Ação & Reação']);
    expect(model.sections[0]?.paragraphs).toEqual(['Backend com foco em APIs.']);
    expect(toRenderModel(sample('en-US')).paper).toBe('Letter');
  });

  it('only turns safe values into links', () => {
    const contacts = toRenderModel(sample()).contacts;
    expect(contacts.map((c) => c.href)).toEqual([
      'mailto:ana@example.test',
      'https://github.com/ana-teste',
      null,
      'tel:+5541999990000',
    ]);
  });
});

describe('HTML', () => {
  const html = renderHtml(toRenderModel(sample()));

  it('escapes every dynamic value: no script, no injected markup, no javascript: link', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain(escapeHtml(HOSTILE));
    expect(html).toContain('Content-Security-Policy');
  });

  it('is a single column of semantic elements without layout tables', () => {
    expect(html).not.toMatch(/<table|<img|<iframe|<link /i);
    expect(html).toContain('<h1>Ana Souza Teste</h1>');
    expect(html).toContain('<h2>Experiência profissional</h2>');
    expect(html).toContain('lang="pt-BR"');
  });
});

describe('DOCX', () => {
  it('is a valid editable document with the model text in order, real links and no tables or images', async () => {
    const model = toRenderModel(sample());
    const bytes = await renderDocx(model);
    expect(bytes.length).toBeGreaterThan(2_000);
    const { xml, rels, core, text, zip } = await docxParts(bytes);
    expectInOrder(text, textLinesOf(model));
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
  it('prints selectable text in the model order, within two pages, with link annotations', async (context) => {
    if (!browserAvailable) context.skip();
    const model = toRenderModel(sample());
    const bytes = await renderPdf(model);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    expect(totalPages).toBeLessThanOrEqual(2);
    expectInOrder(text, textLinesOf(model));
    expect(text).toContain('<script>alert("x")</script>'); // literal, never executed or dropped
    const page = await pdf.getPage(1);
    const annotations = (await page.getAnnotations()) as { subtype: string; url?: string }[];
    const urls = annotations.filter((a) => a.subtype === 'Link').map((a) => a.url ?? '');
    expect(urls).toEqual(
      expect.arrayContaining(['mailto:ana@example.test', 'https://github.com/ana-teste']),
    );
    expect(urls.some((url) => url.startsWith('javascript:'))).toBe(false);
  }, 60_000);

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
    expect(exportFileName({ name: 'x'.repeat(200), date }, 'pdf').length).toBeLessThan(60);
  });
});
