import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
  type ParagraphChild,
} from 'docx';
import type { RenderContact, RenderModel } from './render-model';

const FONT = 'Arial';
const BODY = 21; // half-points: 10.5 pt
const BULLETS = 'resume-bullets';

function contactRuns(contacts: readonly RenderContact[]): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  contacts.forEach((contact, position) => {
    if (position > 0) runs.push(new TextRun({ text: ' · ' }));
    runs.push(
      contact.href === null
        ? new TextRun({ text: contact.text })
        : new ExternalHyperlink({
            link: contact.href,
            children: [new TextRun({ text: contact.text, style: 'Hyperlink' })],
          }),
    );
  });
  return runs;
}

/**
 * Editable DOCX: native styles (title, headings, bullet list), one column, no tables, no text boxes, no
 * images, real hyperlinks. The paragraphs follow `textLinesOf` order, which is also the PDF order.
 */
export async function renderDocx(model: RenderModel): Promise<Uint8Array> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: model.name })] }),
  );
  if (model.headline !== null) {
    children.push(new Paragraph({ children: [new TextRun({ text: model.headline, size: 23 })] }));
  }
  const meta: ParagraphChild[] = [];
  if (model.location !== null) meta.push(new TextRun({ text: model.location }));
  if (model.location !== null && model.contacts.length > 0) meta.push(new TextRun({ text: ' · ' }));
  meta.push(...contactRuns(model.contacts));
  if (meta.length > 0) children.push(new Paragraph({ spacing: { after: 120 }, children: meta }));

  for (const section of model.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: section.title })],
      }),
    );
    for (const paragraph of section.paragraphs) {
      children.push(new Paragraph({ children: [new TextRun({ text: paragraph })] }));
    }
    for (const entry of section.entries) {
      const head: ParagraphChild[] = [new TextRun({ text: entry.heading, bold: true })];
      if (entry.period !== null) head.push(new TextRun({ text: `\t${entry.period}` }));
      children.push(
        new Paragraph({
          keepNext: true,
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: head,
        }),
      );
      if (entry.subheading !== null) {
        children.push(new Paragraph({ children: [new TextRun({ text: entry.subheading })] }));
      }
      for (const bullet of entry.bullets) {
        children.push(
          new Paragraph({
            numbering: { reference: BULLETS, level: 0 },
            children: [new TextRun({ text: bullet })],
          }),
        );
      }
    }
  }

  const document = new Document({
    creator: model.name,
    title: model.name,
    description: 'Currículo',
    styles: {
      default: { document: { run: { font: FONT, size: BODY } } },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT, size: 40, bold: true },
          paragraph: { spacing: { after: 40 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: 24, bold: true },
          paragraph: {
            spacing: { before: 240, after: 80 },
            border: { bottom: { style: 'single', size: 6, color: '444444', space: 1 } },
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
            margin: { top: 907, bottom: 907, left: 907, right: 907 },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
