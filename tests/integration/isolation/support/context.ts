import { matchRoute } from './gate';
import { registerSecret } from './logs';
import {
  TestClient,
  getRouteManifest,
  type RouteManifestEntry,
  type TestResponse,
} from './workspace';
import { createPair, type Actor, type World } from './world';

const TRACKED_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/**
 * Contexto de execucao de um caso cruzado: instrumenta os clientes HTTP para registrar QUAL rota do
 * manifesto cada requisicao atingiu (o gate confere que o caso realmente exercitou a rota que
 * declara) e acumula tudo que cada observador recebeu (para a varredura de canarios).
 */
export class CrossCaseContext {
  readonly hits = new Set<string>();
  readonly unmatched: string[] = [];
  private readonly observed = new Map<string, string[]>();
  private readonly manifest: RouteManifestEntry[];

  constructor(readonly world: World) {
    this.manifest = getRouteManifest(world.app);
  }

  /** Devolve um cliente que registra as rotas atingidas (mesmo estado/cookies do original). */
  http(client: TestClient): TestClient {
    const record = (method: string, url: string): void => {
      const key = matchRoute(this.manifest, method, url);
      if (key) this.hits.add(key);
      else this.unmatched.push(`${method.toUpperCase()} ${url}`);
    };
    return new Proxy(client, {
      get: (target, property) => {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== 'function') return value;
        const name = String(property);
        return (...args: unknown[]) => {
          if (TRACKED_METHODS.has(name)) record(name, String(args[0]));
          else if (name === 'request') record(String(args[0]), String(args[1]));
          else if (name === 'postRaw') record('post', String(args[0]));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  }

  /** Cliente novo, sem cookies, rastreado. */
  anonymous(): TestClient {
    return this.http(new TestClient(this.world.app, this.world.config));
  }

  /** Guarda tudo que `viewer` recebeu (status, cabecalhos, corpo) para a varredura final. */
  observe(viewer: { ownerId: string }, response: TestResponse): void {
    const list = this.observed.get(viewer.ownerId) ?? [];
    const { status, headers, body, text } = response as {
      status: number;
      headers: unknown;
      body: unknown;
      text: unknown;
    };
    list.push(JSON.stringify({ status, headers, body, text }));
    this.observed.set(viewer.ownerId, list);
  }

  /** Tudo que foi observado por observadores do lado B (A so e usado como controle positivo). */
  observedAll(): string {
    return [...this.observed.values()].flat().join('\n');
  }

  observedBy(viewer: { ownerId: string }): string {
    return (this.observed.get(viewer.ownerId) ?? []).join('\n');
  }

  /** Par descartavel A'/B' (fixtures de A e B, senhas distintas); segredos registrados para o teste de logs. */
  async pair(label: string): Promise<{ a: Actor; b: Actor }> {
    const pair = await createPair(this.world, label);
    for (const actor of [pair.a, pair.b]) {
      registerSecret(this.world, `senha de ${actor.email}`, actor.password);
      registerSecret(this.world, `e-mail de ${actor.email}`, actor.email);
    }
    return pair;
  }
}
