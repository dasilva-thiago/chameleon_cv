import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ExpandableText } from '../src/components/ui/ExpandableText';

describe('ExpandableText', () => {
  it('texto curto aparece inteiro, sem botão', () => {
    render(<ExpandableText text="Vaga curta." />);
    expect(screen.getByText('Vaga curta.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('texto longo começa recolhido e alterna com o botão, mantendo o texto no documento', async () => {
    const user = userEvent.setup();
    const text = Array.from({ length: 20 }, (_, i) => `Linha ${String(i + 1)} da vaga`).join('\n');
    render(<ExpandableText text={text} />);
    const pre = screen.getByText(/Linha 20 da vaga/);
    expect(pre).toHaveClass('line-clamp-6');

    const button = screen.getByRole('button', { name: 'Ver texto completo' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(pre).not.toHaveClass('line-clamp-6');
    expect(screen.getByRole('button', { name: 'Mostrar menos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Mostrar menos' }));
    expect(pre).toHaveClass('line-clamp-6');
  });
});
