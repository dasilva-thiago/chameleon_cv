import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CROSS_CASES } from './cross-cases';
import { CrossCaseContext } from './support/context';
import { expectNoLeaks, forbiddenFor } from './support/leaks';
import { assertLogsClean } from './support/logs';
import { createWorld, type World } from './support/world';

/**
 * Executa TODOS os casos cruzados HTTP registrados em cross-cases.ts (o gate de route-gate.test.ts
 * garante que cada rota do manifesto aponta para um deles) e confere que cada caso realmente atingiu
 * as rotas que declara. Termina com a varredura de canarios sobre tudo que B recebeu.
 */
let world: World;
const contexts = new Map<string, CrossCaseContext>();
beforeAll(async () => {
  world = await createWorld();
}, 120_000);
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

describe('casos cruzados HTTP (A x B)', () => {
  it('ha casos registrados', () => {
    expect(Object.keys(CROSS_CASES).length).toBeGreaterThanOrEqual(5);
  });

  for (const [id, crossCase] of Object.entries(CROSS_CASES)) {
    it(`${id}: ${crossCase.description}`, async () => {
      const ctx = new CrossCaseContext(world);
      contexts.set(id, ctx);
      await crossCase.run(ctx);
      for (const route of crossCase.routes) {
        expect(ctx.hits, `o caso "${id}" declara ${route} mas nao a exercitou`).toContain(route);
      }
    }, 60_000);
  }

  it('varredura final: nada de A em tudo que B recebeu em todos os casos; nada de B em logs', async () => {
    expect(contexts.size).toBe(Object.keys(CROSS_CASES).length);
    const forbidden = await forbiddenFor(world, world.b);
    let observedBytes = 0;
    for (const [id, ctx] of contexts) {
      const seen = ctx.observedAll();
      observedBytes += seen.length;
      // respostas observadas por B (e pelo par B') nao contem canario/e-mail/id/token de A
      expectNoLeaks(`respostas do caso ${id} (observadores B)`, seen, forbidden);
    }
    expect(observedBytes, 'a varredura precisa ter observado respostas reais').toBeGreaterThan(500);
  });
});
