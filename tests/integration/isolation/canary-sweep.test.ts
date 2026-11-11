import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectNoLeaks, forbiddenFor, readEverythingAs } from './support/leaks';
import { assertLogsClean } from './support/logs';
import { createWorld, type World } from './support/world';

/**
 * ADR-0008 item 5(c): varredura de canarios. Cada dono do mundo tem base, vaga, avaliacao e curriculo com
 * canarios proprios; TUDO que um dono consegue ler (forOwner em todos os modelos privados) e serializado e nao
 * pode conter canario, e-mail nem id de linha de outro.
 */
let world: World;
beforeAll(async () => {
  world = await createWorld();
}, 120_000);
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

describe('varredura de canarios: o que cada dono le', () => {
  it('controle positivo: os canarios do proprio dono aparecem (a varredura nao e vazia)', async () => {
    for (const actor of world.all) {
      const text = await readEverythingAs(world, actor);
      expect(actor.canaries.length, `${actor.label} sem canarios`).toBeGreaterThan(0);
      const lowered = text.toLowerCase();
      const present = actor.canaries.filter((c) => lowered.includes(c.toLowerCase()));
      expect(present.sort()).toEqual([...actor.canaries].sort());
    }
  });

  it('nenhum dono le canario, e-mail, ownerId ou id de linha de outro dono', async () => {
    let scanned = 0;
    for (const viewer of world.all) {
      const forbidden = await forbiddenFor(world, viewer);
      expect(forbidden.length).toBeGreaterThan(80); // inventario nao vazio
      const text = await readEverythingAs(world, viewer);
      scanned += text.length;
      expectNoLeaks(`leitura completa de ${viewer.label}`, text, forbidden);
    }
    expect(scanned).toBeGreaterThan(20_000);
  });

  it('A tem canarios suficientes (>= 20) e nenhum aparece nas leituras de B', async () => {
    expect(world.a.canaries.length).toBeGreaterThanOrEqual(20);
    const text = await readEverythingAs(world, world.b);
    for (const canary of world.a.canaries) {
      expect(text.toLowerCase()).not.toContain(canary.toLowerCase());
    }
  });
});
