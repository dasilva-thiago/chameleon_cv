import { chromium, type Browser } from 'playwright-core';
import { renderHtml } from './html';
import type { RenderModel } from './render-model';

/** The PDF could not be produced (no browser available, or it failed). The message never carries resume text. */
export class ExportUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExportUnavailableError';
  }
}

export interface PdfOptions {
  /** `bundled` (Playwright's Chromium, default) or `chrome` (the installed Google Chrome). `PDF_BROWSER` overrides. */
  browser?: 'bundled' | 'chrome';
  /** Absolute path to a Chromium/Chrome binary (`PDF_BROWSER_PATH` overrides). */
  executablePath?: string;
  timeoutMs?: number;
}

async function launch(options: PdfOptions): Promise<Browser> {
  const choice = process.env.PDF_BROWSER === 'chrome' ? 'chrome' : (options.browser ?? 'bundled');
  const executablePath = process.env.PDF_BROWSER_PATH ?? options.executablePath;
  const args = ['--disable-gpu', '--no-first-run'];
  const timeout = options.timeoutMs ?? 30_000;
  const attempts: Parameters<typeof chromium.launch>[0][] =
    choice === 'chrome'
      ? [{ channel: 'chrome', args, timeout }]
      : [
          { ...(executablePath !== undefined ? { executablePath } : {}), args, timeout },
          { channel: 'chrome', args, timeout },
          { channel: 'msedge', args, timeout },
        ];
  let last: unknown;
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...attempt });
    } catch (error) {
      last = error;
    }
  }
  throw new ExportUnavailableError(
    'Nenhum navegador disponivel para gerar o PDF (Chromium do Playwright, Chrome ou Edge).',
    { cause: last },
  );
}

/** Prints the resume HTML to a PDF (selectable text, real links) with JavaScript and the network disabled. */
export async function renderPdf(model: RenderModel, options: PdfOptions = {}): Promise<Uint8Array> {
  const browser = await launch(options);
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, acceptDownloads: false });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url === 'about:blank') await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    await page.setContent(renderHtml(model), { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: model.paper,
      printBackground: false,
      preferCSSPageSize: true,
    });
    return new Uint8Array(pdf);
  } catch (error) {
    if (error instanceof ExportUnavailableError) throw error;
    throw new ExportUnavailableError('Falha ao gerar o PDF.', { cause: error });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
