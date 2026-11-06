import type { ResumeExportTemplate } from '@chameleon/contracts';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TabStopPosition,
  TabStopType,
  TextRun,
  type ParagraphChild,
} from 'docx';
import { skillGroupLine, type RenderContact, type RenderModel } from './render-model';

const FONT = 'Arial';
const BULLETS = 'resume-bullets';

// Colors of the modern template (the same hues as the HTML/PDF).
const ACCENT = '15808E';
const SECONDARY = '7322C3';
const TAG_COLOR = '13707C';
const TAG_BG = 'EDF6F7';
const DARK = '1A1A2E';
const TEXT = '333333';
const GREY = '555555';
const LIGHT = '888888';
const RULE = 'E2E2E2';
/** Non-breaking space, so a tag keeps its shaded padding (built from the code point: no invisible character in the source). */
const NBSP = String.fromCharCode(0x00a0);

const TAB = [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }];

const run = (text: string, style: Record<string, unknown> = {}): TextRun =>
  new TextRun({ text, ...style });

function paragraphs(model: RenderModel, modern: boolean): Paragraph[] {
  return modern ? modernParagraphs(model) : classicParagraphs(model);
}

// ---------------------------------------------------------------------------------------------------------
// Classic

function classicContactRuns(contacts: readonly RenderContact[]): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  contacts.forEach((contact, position) => {
    if (position > 0) runs.push(run(' · '));
    runs.push(
      contact.href === null
        ? run(contact.text)
        : new ExternalHyperlink({
            link: contact.href,
            children: [run(contact.text, { style: 'Hyperlink' })],
          }),
    );
  });
  return runs;
}

function classicParagraphs(model: RenderModel): Paragraph[] {
  const children: Paragraph[] = [];
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [run(model.name)] }));
  if (model.headline !== null) {
    children.push(new Paragraph({ children: [run(model.headline, { size: 23 })] }));
  }
  const meta: ParagraphChild[] = [];
  if (model.location !== null) meta.push(run(model.location));
  if (model.location !== null && model.contacts.length > 0) meta.push(run(' · '));
  meta.push(...classicContactRuns(model.contacts));
  if (meta.length > 0) children.push(new Paragraph({ spacing: { after: 120 }, children: meta }));

  for (const section of model.sections) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(section.title)] }),
    );
    for (const paragraph of section.paragraphs) {
      children.push(new Paragraph({ children: [run(paragraph)] }));
    }
    if (section.tags.length > 0) {
      children.push(new Paragraph({ children: [run(section.tags.join(' · '))] }));
    }
    for (const group of section.groups) {
      children.push(new Paragraph({ children: [run(skillGroupLine(group))] }));
    }
    for (const entry of section.entries) {
      const head: ParagraphChild[] = [run(entry.heading, { bold: true })];
      if (entry.period !== null) head.push(run(`\t${entry.period}`));
      children.push(new Paragraph({ keepNext: true, tabStops: TAB, children: head }));
      if (entry.subheading !== null)
        children.push(new Paragraph({ children: [run(entry.subheading)] }));
      if (entry.detail !== null) children.push(new Paragraph({ children: [run(entry.detail)] }));
      for (const bullet of entry.bullets) {
        children.push(
          new Paragraph({ numbering: { reference: BULLETS, level: 0 }, children: [run(bullet)] }),
        );
      }
    }
  }
  return children;
}

// ---------------------------------------------------------------------------------------------------------
// Modern

function modernContactRuns(model: RenderModel): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  const separator = (): void => {
    runs.push(run('   |   ', { color: 'CCCCCC', size: 19 }));
  };
  model.contacts.forEach((contact, position) => {
    if (position > 0) separator();
    runs.push(
      contact.href === null
        ? run(contact.display, { color: GREY, size: 19 })
        : new ExternalHyperlink({
            link: contact.href,
            children: [run(contact.display, { color: GREY, size: 19 })],
          }),
    );
  });
  if (model.location !== null) {
    if (model.contacts.length > 0) separator();
    runs.push(run(model.location, { color: GREY, size: 19 }));
  }
  return runs;
}

function modernParagraphs(model: RenderModel): Paragraph[] {
  const children: Paragraph[] = [];
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [run(model.name)] }));
  if (model.headline !== null) {
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          run(model.headline, {
            bold: true,
            allCaps: true,
            color: ACCENT,
            size: 26,
            characterSpacing: 20,
          }),
        ],
      }),
    );
  }
  children.push(
    new Paragraph({
      spacing: { after: 100 },
      border: { bottom: { style: 'single', size: 12, color: ACCENT, space: 1 } },
      children: [],
    }),
  );
  const meta = modernContactRuns(model);
  if (meta.length > 0) children.push(new Paragraph({ spacing: { after: 200 }, children: meta }));

  const bullet = (text: string): Paragraph =>
    new Paragraph({
      numbering: { reference: BULLETS, level: 0 },
      spacing: { after: 40 },
      children: [run(text, { color: TEXT })],
    });
  const grey = (text: string, size = 18): Paragraph =>
    new Paragraph({ children: [run(text, { color: LIGHT, size })] });

  for (const section of model.sections) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(section.title)] }),
    );

    for (const paragraph of section.paragraphs) {
      children.push(
        new Paragraph({
          spacing: { line: 340, after: 80 },
          children: [run(paragraph, { color: '2F2F2F' })],
        }),
      );
    }

    if (section.tags.length > 0) {
      const tagRuns: ParagraphChild[] = [];
      section.tags.forEach((tag, position) => {
        if (position > 0) tagRuns.push(run('  '));
        tagRuns.push(
          run(`${NBSP}${tag}${NBSP}`, {
            color: TAG_COLOR,
            size: 19,
            shading: { type: ShadingType.CLEAR, fill: TAG_BG, color: 'auto' },
          }),
        );
      });
      children.push(new Paragraph({ spacing: { line: 400 }, children: tagRuns }));
    }

    for (const group of section.groups) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            run(`${group.label}: `, { bold: true, color: TEXT }),
            run(group.items.join(', '), { color: GREY }),
          ],
        }),
      );
    }

    for (const entry of section.entries) {
      if (section.kind === 'experience') {
        const company = entry.subheading ?? entry.heading;
        const head: ParagraphChild[] = [run(company, { bold: true, color: SECONDARY, size: 24 })];
        if (entry.period !== null) head.push(run(`\t${entry.period}`, { color: LIGHT, size: 20 }));
        children.push(
          new Paragraph({
            keepNext: true,
            tabStops: TAB,
            spacing: { before: 120 },
            children: head,
          }),
        );
        if (entry.subheading !== null) {
          children.push(
            new Paragraph({
              keepNext: true,
              children: [run(entry.heading, { bold: true, color: TEXT })],
            }),
          );
        }
        if (entry.detail !== null) children.push(grey(entry.detail));
        for (const text of entry.bullets) children.push(bullet(text));
      } else if (section.kind === 'projects') {
        const title: ParagraphChild =
          entry.url !== null
            ? new ExternalHyperlink({
                link: entry.url,
                children: [run(entry.heading, { bold: true, color: SECONDARY, size: 22 })],
              })
            : run(entry.heading, { bold: true, color: SECONDARY, size: 22 });
        const head: ParagraphChild[] = [title];
        if (entry.subheading !== null)
          head.push(run(`  ${entry.subheading}`, { color: ACCENT, size: 18 }));
        children.push(new Paragraph({ keepNext: true, spacing: { before: 120 }, children: head }));
        for (const text of entry.bullets) children.push(bullet(text));
        if (entry.detail !== null) children.push(grey(entry.detail));
      } else if (section.kind === 'education') {
        const head: ParagraphChild[] = [run(entry.heading, { bold: true, color: TEXT })];
        if (entry.subheading !== null)
          head.push(run(` ${entry.subheading}`, { bold: true, color: SECONDARY }));
        if (entry.period !== null) head.push(run(`\t${entry.period}`, { color: LIGHT, size: 19 }));
        children.push(
          new Paragraph({ keepNext: true, tabStops: TAB, spacing: { before: 80 }, children: head }),
        );
        if (entry.detail !== null) children.push(grey(entry.detail, 19));
      } else if (section.kind === 'certifications') {
        const head: ParagraphChild[] = [run(entry.heading, { color: TEXT })];
        if (entry.subheading !== null)
          head.push(run(`   ${entry.subheading}`, { color: SECONDARY }));
        if (entry.period !== null) head.push(run(`\t${entry.period}`, { color: LIGHT, size: 19 }));
        children.push(new Paragraph({ tabStops: TAB, spacing: { after: 40 }, children: head }));
      } else if (section.kind === 'languages') {
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            children:
              entry.subheading !== null
                ? [
                    run(`${entry.heading}: `, { bold: true, color: TEXT }),
                    run(entry.subheading, { color: GREY }),
                  ]
                : [run(entry.heading, { bold: true, color: TEXT })],
          }),
        );
      }
    }
  }
  return children;
}

/**
 * Editable DOCX: native styles (title, headings, bullet list), one column, no tables, no text boxes, no
 * images, real hyperlinks. The paragraphs follow `textLinesOf` order for the same template, which is also the
 * PDF order.
 */
export async function renderDocx(
  model: RenderModel,
  template: ResumeExportTemplate = 'modern',
): Promise<Uint8Array> {
  const modern = template === 'modern';
  const document = new Document({
    creator: model.name,
    title: model.name,
    description: 'Currículo',
    styles: {
      default: { document: { run: { font: FONT, size: modern ? 20 : 21 } } },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          run: modern
            ? { font: FONT, size: 52, bold: true, color: DARK }
            : { font: FONT, size: 40, bold: true },
          paragraph: { spacing: { after: modern ? 60 : 40 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: modern
            ? {
                font: FONT,
                size: 22,
                bold: true,
                allCaps: true,
                color: ACCENT,
                characterSpacing: 12,
              }
            : { font: FONT, size: 24, bold: true },
          paragraph: {
            spacing: { before: modern ? 280 : 240, after: modern ? 120 : 80 },
            border: {
              bottom: modern
                ? { style: 'single', size: 8, color: RULE, space: 2 }
                : { style: 'single', size: 6, color: '444444', space: 1 },
            },
            keepNext: true,
          },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size:
              model.paper === 'Letter'
                ? { width: 12240, height: 15840 }
                : { width: 11906, height: 16838 },
            margin: modern
              ? { top: 864, bottom: 864, left: 864, right: 864 }
              : { top: 907, bottom: 907, left: 907, right: 907 },
          },
        },
        children: paragraphs(model, modern),
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
