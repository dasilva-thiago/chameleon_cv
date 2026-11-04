import { expect } from 'vitest';
import { TEST_PASSWORD } from './workspace';
import type { World } from './world';

/** Segredos extras registrados pelos testes por mundo (ex.: tokens de convite). */
const extraSecrets = new WeakMap<World, Map<string, string>>();

export function registerSecret(world: World, label: string, value: string | undefined): void {
  if (!value) return;
  let map = extraSecrets.get(world);
  if (!map) extraSecrets.set(world, (map = new Map<string, string>()));
  map.set(value, label);
}

/**
 * Varre TODAS as linhas de log capturadas no mundo: senhas, tokens de sessao/CSRF/convite, e-mails,
 * hashes e canarios de perfil nunca podem aparecer (ADR-0014, ADR-0008 item 5c). Chame no `afterAll`
 * de todo arquivo da suite que usa `createWorld()`.
 */
export function assertLogsClean(world: World): void {
  const output = world.logs.text();
  expect(
    output.length,
    'o log capturado nao pode estar vazio (o app precisa ter logado)',
  ).toBeGreaterThan(0);
  const lowered = output.toLowerCase();

  const secrets = new Map<string, string>();
  secrets.set(TEST_PASSWORD, 'senha');
  for (const who of world.everyone) {
    secrets.set(who.email, `e-mail de ${who.label}`);
    for (const canary of who.canaries) secrets.set(canary, `canario ${who.label}`);
  }
  for (const actor of [...world.all, world.coverage]) {
    secrets.set(actor.password, `senha de ${actor.fixtureId}`);
    if (actor.client.sessionToken) {
      secrets.set(actor.client.sessionToken, `sessao de ${actor.fixtureId}`);
    }
    if (actor.client.csrfToken) secrets.set(actor.client.csrfToken, `csrf de ${actor.fixtureId}`);
  }
  for (const [value, label] of extraSecrets.get(world) ?? []) secrets.set(value, label);

  const leaked = [...secrets]
    .filter(([value]) => lowered.includes(value.toLowerCase()))
    .map(([value, label]) => `${label}: ${value}`);
  expect(leaked, 'segredos/PII/canarios encontrados no log').toEqual([]);

  expect(output).not.toMatch(/[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/); // nenhum e-mail
  expect(output).not.toMatch(/argon2id?\$|\$argon2/i); // nenhum hash de senha
  expect(output).not.toMatch(/set-cookie|authorization|x-csrf-token|cookie:/i);
  expect(output).not.toMatch(/CANARY-/i);
  // Cada linha e JSON valido (o parse falha alto se alguem usar console.log com texto livre).
  expect(() => world.logs.lines()).not.toThrow();
}
