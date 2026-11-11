import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { extractText, getDocumentProxy } from 'unpdf';
import { BASE_CV, BASE_PROFILE } from '../apps/api/test/helpers/scripted-provider';

const here = dirname(fileURLToPath(import.meta.url));
const { email, token } = JSON.parse(readFileSync(join(here, '.tmp', 'session.json'), 'utf8')) as {
  email: string;
  token: string;
};
const PASSWORD = 'uma senha longa e unica 2026';

// The API runs with a scripted AI provider (e2e/start-api.ts): the answers match this synthetic base.
const JOB = `Desenvolvedor(a) Backend Júnior

Requisitos
- Node.js é obrigatório
- Kubernetes em produção.

Benefícios
- Vale-refeição.
`;

async function createAccount(page: Page): Promise<void> {
  await page.goto(`/accept-invite#token=${token}`);
  await expect(page.getByLabel(/E-mail do convite/)).toHaveValue(email);
  await page.getByLabel(/^Senha/).fill(PASSWORD);
  await page.getByLabel(/^Confirme a senha/).fill(PASSWORD);
  await page.getByRole('checkbox', { name: /Autorizo o tratamento/ }).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
}

test('base -> job -> evaluation -> tailored resume -> checks -> approve -> DOCX and PDF', async ({
  page,
}) => {
  await createAccount(page);

  // --- professional base ---------------------------------------------------------------------
  await page.goto('/perfil');
  await page.getByLabel('CV (Markdown)').fill(BASE_CV);
  await page.getByLabel('Perfil e regras (Markdown)').fill(BASE_PROFILE);
  await page.getByRole('button', { name: 'Salvar base' }).click();
  await expect(page.getByText('Base salva')).toBeVisible();

  // --- job and evaluation ----------------------------------------------------------------------
  await page.goto('/vagas/nova');
  await page.getByLabel(/Descrição da vaga/).fill(JOB);
  await page.getByLabel('Cargo').fill('Dev Backend');
  await page.getByLabel('Empresa').fill('Acme Ltda.');
  await page.getByRole('button', { name: 'Salvar vaga' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dev Backend' })).toBeVisible();

  await page.getByRole('button', { name: 'Permitir uso de IA' }).click();
  await expect(page.getByText(/IA ativa/)).toBeVisible();
  await page.getByRole('button', { name: 'Avaliar vaga' }).click();
  await expect(page.getByText('Boa vaga para o alvo principal.')).toBeVisible();
  await expect(page.getByText('Vale se candidatar')).toBeVisible();
  const requirements = page.getByRole('region', { name: 'Requisitos × sua base' });
  await expect(requirements.getByText('Faltando')).toBeVisible(); // Kubernetes is not in the base
  await expect(page.getByRole('region', { name: 'Pretensão salarial sugerida' })).toContainText(
    'A empresa não informou salário.',
  );

  // --- generate and edit -----------------------------------------------------------------------
  await page.getByRole('button', { name: 'Gerar currículo' }).click();
  await page.getByRole('link', { name: /Abrir a versão 1 no editor/ }).click();
  await expect(page.getByRole('button', { name: 'Aprovar versão' })).toBeVisible();
  await expect(page.locator('p', { hasText: 'Palavras-chave da vaga cobertas:' })).toContainText(
    '67%',
  );
  await expect(page.getByLabel('Título profissional')).toHaveValue(
    'Desenvolvedora Backend Júnior | Node.js · PostgreSQL',
  );

  const bullet = page
    .getByLabel(/^Item \d+$/)
    .filter({ hasText: /Criou APIs REST/ })
    .first();
  await bullet.fill('Criou APIs REST em Node.js para o painel de equipamentos.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Editado').first()).toBeVisible();

  // an invented number is an error (approval blocked by the server); an unknown tool only warns
  const entry = page.getByRole('group').filter({
    has: page.getByLabel(/^Item \d+$/).filter({ hasText: /Triagem de incidentes/ }),
  });
  await entry.getByRole('button', { name: /^Adicionar item/ }).click();
  const added = entry.getByLabel(/^Item \d+$/).last();
  await added.fill('Atendimento a 900 clientes com Kubernetes.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(
    page.getByText(/O número "900" não aparece na base profissional/).first(),
  ).toBeVisible();
  await added.fill('Estudo de Kubernetes em laboratório.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(
    page
      .getByText('"Kubernetes" (palavra-chave da vaga) não aparece na base profissional', {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Revisei os avisos' }).check();

  // --- approve ---------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Aprovar versão' }).click();
  await expect(page.getByText('Versão aprovada', { exact: true }).first()).toBeVisible();

  // --- downloads -------------------------------------------------------------------------------
  const openDownloadMenu = (): Promise<void> =>
    page.getByRole('button', { name: /^Baixar/ }).click();
  const [docx] = await Promise.all([
    page.waitForEvent('download'),
    openDownloadMenu().then(() => page.getByRole('menuitem', { name: 'DOCX' }).click()),
  ]);
  expect(docx.suggestedFilename()).toMatch(/^Ana-Teste_Dev-Backend_Acme-Ltda_\d{8}\.docx$/);
  const zip = await JSZip.loadAsync(readFileSync(await docx.path()));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('Ana Teste');
  expect(xml).toContain('Criou APIs REST em Node.js para o painel de equipamentos.');
  expect(xml).toContain('ana.contato@example.test');

  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    openDownloadMenu().then(() => page.getByRole('menuitem', { name: 'PDF' }).click()),
  ]);
  const pdfBytes = new Uint8Array(readFileSync(await pdf.path()));
  expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-');
  const { text, totalPages } = await extractText(await getDocumentProxy(pdfBytes), {
    mergePages: true,
  });
  expect(totalPages).toBeLessThanOrEqual(2);
  const flat = text.replace(/\s+/g, ' ');
  expect(flat).toContain('Ana Teste');
  expect(flat).not.toContain('Vale-refeição'); // the posting never leaks into the resume
});
