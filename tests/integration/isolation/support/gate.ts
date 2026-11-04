import type { RouteManifestEntry } from './workspace';

/**
 * Cobertura de uma rota no gate de isolamento (ADR-0008 item 5b).
 * - `cross-case`: a rota tem um caso cruzado A/B registrado em `cross-cases.ts` (obrigatorio para
 *   rota com parametro de recurso e para qualquer rota que exija sessao).
 * - `no-private-data`: so para rota publica, sem parametro de recurso e que NAO muta estado
 *   (ex.: liveness). Exige justificativa.
 */
export type Coverage =
  { kind: 'cross-case'; caseId: string } | { kind: 'no-private-data'; reason: string };

export type CoverageMap = Readonly<Record<string, Coverage>>;

/** O que o gate precisa saber de um caso cruzado (a implementacao fica em cross-cases.ts). */
export interface CaseInfo {
  /** Chaves `METHOD /caminho/:param` que o caso afirma exercitar (e que o teste confere em execucao). */
  routes: readonly string[];
}

export const routeKey = (entry: Pick<RouteManifestEntry, 'method' | 'path'>): string =>
  `${entry.method} ${entry.path}`;

/**
 * Avalia o gate. Devolve a lista de problemas (vazia = gate verde). Funcao pura: o teste do app real
 * e o teste negativo (app sintetico com rota extra) usam exatamente esta funcao.
 */
export function evaluateGate(
  manifest: readonly RouteManifestEntry[],
  coverage: CoverageMap,
  cases: Readonly<Record<string, CaseInfo>>,
): string[] {
  const problems: string[] = [];
  const keys = new Set(manifest.map(routeKey));

  for (const entry of manifest) {
    const key = routeKey(entry);
    if (entry.auth === 'unclassified') {
      problems.push(
        `${key}: rota NAO classificada (declare-a por routes.<metodo>(path, { auth }, ...))`,
      );
    }
    if (entry.path.includes('<?>')) {
      problems.push(`${key}: router montado fora do registro (prefixo desconhecido '<?>')`);
    }

    const entryCoverage = coverage[key];
    if (!entryCoverage) {
      problems.push(
        `${key}: sem cobertura cruzada (adicione a rota em coverage.ts e um caso em cross-cases.ts)`,
      );
      continue;
    }

    const needsCrossCase = entry.hasResourceParam || entry.auth !== 'public';
    const privateReason = entry.hasResourceParam
      ? 'tem parametro de recurso'
      : entry.auth !== 'public'
        ? `exige sessao (auth=${entry.auth})`
        : null;
    if (entryCoverage.kind === 'no-private-data') {
      if (needsCrossCase)
        problems.push(`${key}: ${privateReason}; "no-private-data" nao basta, exige caso cruzado`);
      if (entry.mutating)
        problems.push(`${key}: rota que muta estado nao pode ser "no-private-data"`);
      if (entryCoverage.reason.trim().length < 10)
        problems.push(`${key}: justificativa de "no-private-data" vazia`);
      continue;
    }

    const info = cases[entryCoverage.caseId];
    if (!info) {
      problems.push(`${key}: caso cruzado "${entryCoverage.caseId}" nao existe em cross-cases.ts`);
    } else if (!info.routes.includes(key)) {
      problems.push(`${key}: o caso "${entryCoverage.caseId}" nao declara exercitar esta rota`);
    }
  }

  for (const key of Object.keys(coverage)) {
    if (!keys.has(key))
      problems.push(`${key}: entrada de cobertura de rota que NAO existe mais (remova)`);
  }
  for (const [id, info] of Object.entries(cases)) {
    for (const route of info.routes) {
      if (!keys.has(route)) problems.push(`caso "${id}": declara a rota inexistente ${route}`);
    }
    const referenced = Object.values(coverage).some(
      (c) => c.kind === 'cross-case' && c.caseId === id,
    );
    if (!referenced)
      problems.push(
        `caso "${id}": nao e referenciado por nenhuma entrada de coverage.ts (codigo morto)`,
      );
  }
  return problems;
}

/** Regex que casa o caminho real com o modelo `/api/x/:id/y` do manifesto. */
function templateRegex(path: string): RegExp {
  const source = path
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${source}/?$`);
}

/** Descobre a rota do manifesto a que `METHOD url` pertence (a mais especifica). */
export function matchRoute(
  manifest: readonly RouteManifestEntry[],
  method: string,
  url: string,
): string | null {
  const pathname = url.split('?')[0] ?? url;
  const upper = method.toUpperCase();
  const candidates = manifest
    .filter((entry) => entry.method === upper && templateRegex(entry.path).test(pathname))
    .sort((x, y) => x.resourceParams.length - y.resourceParams.length);
  const best = candidates[0];
  return best ? routeKey(best) : null;
}
