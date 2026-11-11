import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_CV, BASE_PROFILE } from '../apps/api/test/helpers/scripted-provider';

/**
 * Visual gate of the design system (plan §6, criteria 4 and 5): every main screen in the light and the dark theme, with
 * axe's real color-contrast rule (jsdom cannot compute colors) and a screenshot for review. Synthetic data only (the
 * scripted AI provider and the synthetic base); screenshots go to e2e/.tmp/screens, which is never committed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SCREENS = join(here, '.tmp', 'screens');
const AXE = createRequire(join(here, '..', 'apps', 'web', 'package.json')).resolve(
  'axe-core/axe.min.js',
);
const { email, token } = JSON.parse(readFileSync(join(here, '.tmp', 'session.json'), 'utf8')) as {
  email: string;
  token: string;
};
const PASSWORD = 'uma senha longa e unica 2026';
const JOB = `Desenvolvedor(a) Backend Júnior

Requisitos
- Node.js é obrigatório
- Kubernetes em produção.
`;

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^E-mail/).fill(email);
  await page.getByLabel(/^Senha/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  const home = page.getByRole('heading', { level: 1, name: 'Início' });
  const signedIn = await home
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (signedIn) return;
  // First spec to run: create the account from the invite.
  await page.goto(`/accept-invite#token=${token}`);
  await page.getByLabel(/^Senha/).fill(PASSWORD);
  await page.getByLabel(/^Confirme a senha/).fill(PASSWORD);
  await page.getByRole('checkbox', { name: /Autorizo o tratamento/ }).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(home).toBeVisible();
}

/** A job with an evaluation and a resume, created through the UI when the other spec did not run first. */
async function ensureJobWithResume(page: Page): Promise<{ jobUrl: string; editorUrl: string }> {
  await page.goto('/vagas?status=all');
  const existing = page.getByRole('link', { name: 'Dev Backend' }).first();
  const found = await existing
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!found) {
    await page.goto('/perfil');
    await page.getByLabel('CV (Markdown)').fill(BASE_CV);
    await page.getByLabel('Perfil e regras (Markdown)').fill(BASE_PROFILE);
    await page.getByRole('button', { name: 'Salvar base' }).click();
    await expect(page.getByText('Base salva')).toBeVisible();
    await page.goto('/vagas/nova');
    await page.getByLabel(/Descrição da vaga/).fill(JOB);
    await page.getByLabel('Cargo').fill('Dev Backend');
    await page.getByLabel('Empresa').fill('Acme Ltda.');
    await page.getByRole('button', { name: 'Salvar vaga' }).click();
    await page.getByRole('button', { name: 'Permitir uso de IA' }).click();
    await page.getByRole('button', { name: 'Avaliar vaga' }).click();
    await expect(page.getByText('Vale se candidatar')).toBeVisible();
    await page.getByRole('button', { name: 'Gerar currículo' }).click();
    await expect(page.getByRole('link', { name: /Abrir a versão 1 no editor/ })).toBeVisible();
  } else {
    await existing.click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Dev Backend' })).toBeVisible();
  const jobUrl = page.url();
  const open = page.getByRole('link', { name: /^Abrir (a )?versão \d+/ }).first();
  const editorUrl = new URL((await open.getAttribute('href')) ?? '/', jobUrl).toString();
  return { jobUrl, editorUrl };
}

async function contrastViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  // Evaluated as source in the page: the e2e tsconfig has no DOM types.
  const found = await page.evaluate(`(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });
    return result.violations.flatMap((v) =>
      v.nodes.slice(0, 5).map((n) => v.id + ': ' + n.target.join(' ')),
    );
  })()`);
  return found as string[];
}

for (const theme of ['light', 'dark'] as const) {
  test(`main screens in the ${theme} theme: real contrast and screenshots`, async ({ page }) => {
    mkdirSync(SCREENS, { recursive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.addInitScript((value) => {
      localStorage.setItem('chameleon.theme', value);
    }, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page);
    const { jobUrl, editorUrl } = await ensureJobWithResume(page);

    const screens: [string, string, RegExp | string][] = [
      ['inicio', '/', 'Início'],
      ['vagas', '/vagas', 'Vagas'],
      ['vaga', jobUrl, 'Dev Backend'],
      ['editor', editorUrl, /./],
      ['base', '/perfil', 'Base profissional'],
      ['conta', '/conta', 'Conta'],
    ];
    const findings: string[] = [];
    for (const [name, url, heading] of screens) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: join(SCREENS, `${theme}-${name}.png`), fullPage: true });
      await page.screenshot({ path: join(SCREENS, `${theme}-${name}-viewport.png`) });
      findings.push(...(await contrastViolations(page)).map((f) => `${name}: ${f}`));
    }

    // Narrow screen: no horizontal scroll, the drawer opens and closes.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(jobUrl);
    await expect(page.getByRole('heading', { level: 1, name: 'Dev Backend' })).toBeVisible();
    // No horizontal page scroll at phone width (evaluated in the page; the e2e tsconfig has no DOM types).
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(
      true,
    );
    await page.screenshot({ path: join(SCREENS, `${theme}-vaga-mobile.png`), fullPage: true });
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    await page.screenshot({ path: join(SCREENS, `${theme}-menu-mobile.png`) });

    expect(findings).toEqual([]);
  });
}
