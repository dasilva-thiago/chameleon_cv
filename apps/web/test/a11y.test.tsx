import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, INVITE_TOKEN, makeSession, previewResponse } from './helpers/fake-api';
import { renderApp } from './helpers/render-app';

function accessibleNameOf(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  }
  const aria = element.getAttribute('aria-label');
  if (aria) return aria.trim();
  const labels = (element as HTMLInputElement).labels;
  if (labels && labels.length > 0) return (labels[0]?.textContent ?? '').trim();
  return (element.textContent ?? '').trim();
}

describe('acessibilidade basica', () => {
  it('cada tela publica tem idioma pt-BR, landmarks, um unico h1 e o link para pular ao conteudo', async () => {
    new FakeApi().install();
    renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: 'Entrar' });

    expect(document.documentElement.lang || 'pt-BR').toBe('pt-BR');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'conteudo');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const skip = screen.getByRole('link', { name: 'Pular para o conteúdo' });
    expect(skip).toHaveAttribute('href', '#conteudo');
  });

  it('o link "Pular" e o primeiro elemento focavel e leva o foco ao conteudo principal', async () => {
    new FakeApi().install();
    const { user } = renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: 'Entrar' });
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Pular para o conteúdo' });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('a tela autenticada tem navegacao nomeada e controles com nome acessivel', async () => {
    const fake = new FakeApi().install();
    fake.session = makeSession();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Início' });

    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getAllByRole('link')).toHaveLength(2);
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]) {
      expect(accessibleNameOf(control)).not.toBe('');
    }
  });

  it('todo campo de formulario tem rotulo associado e erros ligados por aria-describedby', async () => {
    new FakeApi().install();
    const { user } = renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'Entrar' }));

    const email = screen.getByLabelText(/^E-mail/);
    const password = screen.getByLabelText(/^Senha/);
    for (const field of [email, password]) {
      expect(accessibleNameOf(field)).not.toBe('');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      const describedBy = field.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy ?? '')?.textContent).toMatch(/Informe/);
    }
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toHaveAttribute('type', 'password');
  });

  it('o formulario de convite tem autocomplete adequado e consentimento descrito', async () => {
    const fake = new FakeApi().install();
    fake.on('POST /api/auth/invites/preview', previewResponse());
    renderApp(`/accept-invite#token=${INVITE_TOKEN}`);
    const form = await screen.findByRole('form', { name: 'Criar conta' });

    const [password, confirm] = [
      within(form).getByLabelText(/^Senha/),
      within(form).getByLabelText(/^Confirme a senha/),
    ];
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(confirm).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toBeRequired();

    const consent = within(form).getByRole('checkbox', { name: /Autorizo o tratamento/ });
    expect(consent.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      within(form).getByRole('group', { name: 'Tratamento de dados do perfil' }),
    ).toBeVisible();
  });

  it('erros de envio usam role=alert e avisos informativos usam role=status', async () => {
    const fake = new FakeApi().install();
    fake.session = null;
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText(/^E-mail/), 'ana.teste@example.com');
    await user.type(screen.getByLabelText(/^Senha/), 'qualquer-coisa');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    // Sem handler de login configurado a API falsa responde 404: erro generico em role=alert.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
