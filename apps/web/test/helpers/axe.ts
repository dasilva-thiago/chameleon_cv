import axe from 'axe-core';

/** Violacoes do axe em `container` (texto curto). Contraste fica de fora: o jsdom nao calcula cores. */
export async function violations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
}
