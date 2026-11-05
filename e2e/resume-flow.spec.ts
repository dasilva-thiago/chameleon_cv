import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { extractText, getDocumentProxy } from 'unpdf';

const here = dirname(fileURLToPath(import.meta.url));
const { email, token } = JSON.parse(readFileSync(join(here, '.tmp', 'session.json'), 'utf8')) as {
  email: string;
  token: string;
};
const PASSWORD = 'uma senha longa e unica 2026';

const confirmed = { status: 'confirmed' };
// Synthetic profile (no real data). Facts arrive as "needs review" and are confirmed in the UI below.
const PROFILE = {
  schema_version: '2.1.0',
  profile: {
    identity: { full_name: 'Ana Souza Teste', city: 'Curitiba' },
    positioning: { professional_headline: 'Pessoa desenvolvedora backend' },
    contact_points: [
      { id: 'email-1', kind: 'email', value: 'ana@example.test', visibility: 'public' },
    ],
    experiences: [
      {
        id: 'exp-1',
        official_title: 'Desenvolvedora Backend',
        organization_name: 'Acme Ltda.',
        start_date: '2022-03',
        end_date: 'present',
        meta: confirmed,
        items: [
          {
            id: 'item-1',
            kind: 'achievement',
            text: 'Criou APIs REST em Node.js.',
            meta: confirmed,
          },
          {
            id: 'item-2',
            kind: 'responsibility',
            text: 'Manteve rotinas de deploy.',
            meta: confirmed,
          },
        ],
      },
    ],
    skills: [
      { id: 'skill-node', name: 'Node.js', meta: confirmed },
      { id: 'skill-pg', name: 'PostgreSQL', meta: confirmed },
    ],
    skill_usages: [
      {
        id: 'usage-1',
        skill_id: 'skill-node',
        usage_context: 'professional_experience',
        experience_id: 'exp-1',
        meta: confirmed,
      },
    ],
    education: [
      {
        id: 'edu-1',
        course_name: 'Sistemas de Informação',
        institution: 'UFPR',
        start_date: '2019',
        completion_date: '2023',
        meta: confirmed,
      },
    ],
  },
};

const JOB = `Desenvolvedor(a) Backend

Requisitos
- Experiência com Node.js e APIs REST.
- Conhecimento de PostgreSQL.
- Kubernetes em produção.

Diferenciais
- Git e testes automatizados.

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

async function importAndConfirmProfile(page: Page): Promise<void> {
  await page.goto('/perfil/importar');
  await page.getByLabel(/Ou cole o conteúdo aqui/).fill(JSON.stringify(PROFILE));
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  await expect(page.getByText('Prévia: nada foi gravado ainda')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar importação' }).click();
  await expect(page.getByText('Importação aplicada')).toBeVisible();

  await page.getByRole('link', { name: 'Revisar itens importados' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Para confirmar' })).toBeVisible();
  const group = page.getByRole('button', { name: /^Marcar os \d+ itens/ });
  while ((await group.count()) > 0) {
    await group.first().click();
  }
  await page.getByRole('button', { name: /^Confirmar \d+ itens? selecionados?/ }).click();
  await expect(page.getByText('Nenhum item aguardando confirmação no momento.')).toBeVisible();
}

test('profile -> job -> analysis -> resume -> edit -> approve -> DOCX and PDF', async ({
  page,
}) => {
  await createAccount(page);
  await importAndConfirmProfile(page);

  // --- job and analysis ---------------------------------------------------------------------
  await page.goto('/vagas/nova');
  await page.getByLabel(/Descrição da vaga/).fill(JOB);
  await page.getByLabel('Cargo').fill('Dev Backend');
  await page.getByLabel('Empresa').fill('Acme Ltda.');
  await page.getByRole('button', { name: 'Salvar vaga' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dev Backend' })).toBeVisible();
  await expect(page.locator('pre')).toContainText('Kubernetes em produção.');

  await page.getByRole('button', { name: 'Analisar vaga' }).click();
  await expect(page.getByRole('heading', { name: 'Resumo', exact: true })).toBeVisible();
  await expect(page.getByText('Sem evidência').first()).toBeVisible(); // Kubernetes has no support
  await expect(page.getByRole('link', { name: 'Competência: Node.js' }).first()).toBeVisible();

  // --- generate and edit --------------------------------------------------------------------
  await page.getByRole('button', { name: 'Gerar currículo' }).click();
  await page.getByRole('link', { name: /Abrir a versão 1 no editor/ }).click();
  await expect(page.getByRole('button', { name: 'Aprovar versão' })).toBeVisible();

  // generated text is verbatim from the profile
  await expect(page.getByText('Criou APIs REST em Node.js.').first()).toBeVisible();

  // edit a bullet and save: persisted and marked as edited
  const bullet = page
    .getByLabel(/^Item \d+$/)
    .filter({ hasText: /Criou APIs REST/ })
    .first();
  await bullet.fill('Criou APIs REST em Node.js para o time de pagamentos.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Criou APIs REST em Node.js para o time de pagamentos.').first(),
  ).toBeVisible();
  await expect(page.getByText('Editado').first()).toBeVisible();

  // an unsupported claim only warns; a bullet with no source is not possible to approve (server enforces it)
  const experienceEntry = page.getByRole('group').filter({
    has: page.getByLabel(/^Item \d+$/).filter({ hasText: /Criou APIs REST/ }),
  });
  await experienceEntry.getByRole('button', { name: /^Adicionar item/ }).click();
  await experienceEntry
    .getByLabel(/^Item \d+$/)
    .last()
    .fill('Operou Kubernetes em produção com 12 pessoas.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText(/termos ou números que não aparecem/).first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'Revisei os avisos' }).check();

  // preview shows what will be exported
  await page.getByRole('button', { name: 'Pré-visualizar' }).click();
  await expect(page.getByRole('heading', { name: 'Ana Souza Teste' })).toBeVisible();
  await expect(page.getByText('Operou Kubernetes em produção com 12 pessoas.')).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();

  // --- approve --------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Aprovar versão' }).click();
  await expect(page.getByText('Versão aprovada', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar rascunho' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Criar nova versão para editar' })).toBeVisible();

  // --- downloads ------------------------------------------------------------------------------
  const [docx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Baixar DOCX/ }).click(),
  ]);
  expect(docx.suggestedFilename()).toMatch(/^Ana-Souza-Teste_Dev-Backend_Acme-Ltda_\d{8}\.docx$/);
  const docxPath = await docx.path();
  const zip = await JSZip.loadAsync(readFileSync(docxPath));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('Ana Souza Teste');
  expect(xml).toContain('Criou APIs REST em Node.js para o time de pagamentos.');
  expect(xml).toContain('Operou Kubernetes em produção com 12 pessoas.');
  expect(xml).not.toContain('<w:tbl>');

  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Baixar PDF/ }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfBytes = new Uint8Array(readFileSync(await pdf.path()));
  expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-');
  const { text, totalPages } = await extractText(await getDocumentProxy(pdfBytes), {
    mergePages: true,
  });
  expect(totalPages).toBeLessThanOrEqual(2);
  const flat = text.replace(/\s+/g, ' ');
  expect(flat).toContain('Ana Souza Teste');
  expect(flat).toContain('Criou APIs REST em Node.js para o time de pagamentos.');
  expect(flat).not.toContain('Vale-refeição'); // benefits of the posting never leak into the resume
});
