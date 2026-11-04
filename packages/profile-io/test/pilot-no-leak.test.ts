/**
 * Teste "sem vazamento do piloto" (ADR-0014, criterio da Fase 0 do Adendo: "nenhum fluxo depende de
 * campos ou nomes exclusivos de Thiago").
 *
 * Duas partes:
 *   (a) se o fixture privado existir (`fixtures-private/pilot.profile.v2.yaml`, ignorado pelo git),
 *       ele precisa ser aceito pelo pipeline de importacao (strict) e ter round-trip estavel;
 *   (b) varredura dos arquivos versionados em busca de PII e de nomes exclusivos do piloto.
 *
 * TECNICA ANTI-PII: nenhum dado real esta neste arquivo. Os padroes sao DERIVADOS EM TEMPO DE
 * EXECUCAO do proprio fixture privado (nome completo, e-mail, telefone, links, colaboradores;
 * organizacoes e projetos para o codigo-fonte do produto). Sem o fixture, restam os detectores
 * genericos (e-mail fora de dominios reservados, telefone brasileiro, perfil do LinkedIn).
 * As mensagens de falha informam arquivo, linha e CATEGORIA, nunca o valor encontrado.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFactKind, listRecords, type ProfileDocument } from '@chameleon/contracts';
import { importProfile, loadProfile, serializeProfile } from '../src/index';

const ROOT = resolve(__dirname, '../../..');
const PILOT_FIXTURE_PATH = 'fixtures-private/pilot.profile.v2.yaml';
const PILOT_FIXTURE = join(ROOT, PILOT_FIXTURE_PATH);
const HAS_FIXTURE = existsSync(PILOT_FIXTURE);
const SKIP_REASON =
  'fixtures-private/pilot.profile.v2.yaml ausente (ADR-0014: o fixture privado nao e versionado)';

/**
 * EXCECOES EXPLICITAS (caminhos exatos, na raiz): especificacoes originais que contem PII real do
 * piloto, conforme docs/decisions/ADR-0014. O usuario decide entre (a) redigir as linhas de contato
 * do Anexo A, (b) manter o repositorio privado ou (c) mover o Anexo A para um arquivo ignorado;
 * quando decidir, remova a entrada daqui. Nenhum outro arquivo (nem diretorio) e isento.
 */
const PII_EXCEPTIONS: readonly { file: string; reason: string }[] = [
  {
    file: 'PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md',
    reason:
      'Plano V3 original: o Anexo A reproduz os dados de contato reais do piloto (ADR-0014). Alvo da decisao do usuario sobre redacao/repositorio privado.',
  },
];

// ---------------------------------------------------------------------------------------------
// Enumeracao dos arquivos versionaveis

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.txt',
  '.html',
  '.css',
  '.sql',
  '.prisma',
  '.toml',
  '.example',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_FILE_NAMES = new Set(['pnpm-lock.yaml']);
const WALK_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.data',
  '.git',
  'fixtures-private',
  'playwright-report',
  'test-results',
  '.turbo',
]);

const toPosix = (path: string): string => path.split('\\').join('/');

/** `git ls-files` (rastreados + nao rastreados nao ignorados), ou `null` se o git nao estiver disponivel. */
function listWithGit(): string[] | null {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const files = out.split('\0').filter(Boolean);
    return files.length > 0 ? files.map(toPosix) : null;
  } catch {
    return null;
  }
}

/** Alternativa sem git: percorre a arvore replicando as exclusoes do `.gitignore`. */
function listByWalking(): string[] {
  const out: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!WALK_SKIP_DIRS.has(entry.name)) walk(rel);
      } else if (entry.isFile()) {
        const privateRootFile = !relative && /^(BASE_DE_DADOS_|\.env)/.test(entry.name);
        const exampleEnv = entry.name === '.env.example';
        if (!privateRootFile || exampleEnv) out.push(rel);
      }
    }
  };
  walk('');
  return out;
}

function listVersionableFiles(): { files: string[]; via: 'git' | 'walk' } {
  const fromGit = listWithGit();
  const raw = fromGit ?? listByWalking();
  const files = raw.filter((file) => {
    const name = file.slice(file.lastIndexOf('/') + 1);
    if (SKIP_FILE_NAMES.has(name)) return false;
    const dot = name.lastIndexOf('.');
    if (dot < 0 || !TEXT_EXTENSIONS.has(name.slice(dot))) return false;
    try {
      const stats = statSync(join(ROOT, file));
      return stats.isFile() && stats.size <= MAX_FILE_BYTES;
    } catch {
      return false; // rastreado, mas removido do disco
    }
  });
  return { files, via: fromGit ? 'git' : 'walk' };
}

/**
 * Codigo gerado por ferramenta de terceiros (cliente Prisma): traz exemplos de documentacao
 * (ex.: usuario@email.com) e nenhum dado do projeto. Fica fora SOMENTE dos detectores genericos;
 * os padroes derivados do fixture privado continuam valendo.
 */
const GENERIC_DETECTOR_SKIP_PREFIX = 'packages/db/src/generated/';

const PRIVATE_PATH = /^(fixtures-private\/|BASE_DE_DADOS_)/;
const EXCEPTION_FILES = new Set(PII_EXCEPTIONS.map((entry) => entry.file));

/** Codigo de producao do produto: `apps/<x>/src/**` e `packages/<x>/src/**` (sem testes). */
const isProductSource = (file: string): boolean =>
  /^(apps|packages)\/[^/]+\/src\//.test(file) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

// ---------------------------------------------------------------------------------------------
// Padroes derivados do fixture privado

const fold = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Detector {
  category: string;
  /** Padrao aplicado ao texto dobrado (minusculo, sem acentos, espacos colapsados). */
  folded?: RegExp;
  /** Padrao aplicado ao texto original (usado pelos detectores genericos). */
  raw?: RegExp;
  /** Filtro opcional sobre o trecho encontrado (para reduzir falsos positivos genericos). */
  accept?: (match: string) => boolean;
}

interface PilotPatterns {
  /** PII (pessoa, contato, links): varrida em todos os arquivos versionados. */
  pii: Detector[];
  /** Organizacoes, projetos e dominios do piloto: varridos apenas no codigo de producao. */
  product: Detector[];
}

const wordRegex = (value: string): RegExp =>
  new RegExp(`(?<![a-z0-9])${escapeRegex(fold(value))}(?![a-z0-9])`);

/** Telefone: os digitos em sequencia, com separadores opcionais, com ou sem o codigo do pais. */
function phoneRegex(value: string): RegExp | null {
  let digits = value.replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length < 8) return null;
  const body = digits.split('').join('[\\s().-]*');
  return new RegExp(`(?<!\\d)(?:\\+?55[\\s().-]*)?${body}(?!\\d)`);
}

/** `https://www.exemplo.dev/in/x/` -> `exemplo.dev/in/x` (sem esquema, `www.` nem barra final). */
function urlKey(value: string): string {
  return fold(value)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#]+$/, '');
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** Divide nomes compostos ("Nome - Subtitulo (Sigla)") em segmentos distintivos. */
function nameSegments(value: string): string[] {
  const parts = [value, ...value.split(/\s[—–-]\s|[()]/)].map((part) => part.trim());
  return [...new Set(parts.filter((part) => fold(part).length >= 4))];
}

export function derivePilotPatterns(document: ProfileDocument): PilotPatterns {
  const pii: Detector[] = [];
  const product: Detector[] = [];
  const addWord = (target: Detector[], category: string, value: string | null): void => {
    if (value && fold(value).length >= 4) target.push({ category, folded: wordRegex(value) });
  };
  const profile: Record<string, unknown> = isObject(document.profile) ? document.profile : {};

  const identity = isObject(profile.identity) ? profile.identity : {};
  addWord(pii, 'nome completo do piloto', asText(identity.full_name));
  addWord(pii, 'nome de uso do piloto', asText(identity.preferred_name));

  for (const contact of asArray(profile.contact_points).filter(isObject)) {
    const value = asText(contact.value);
    if (!value) continue;
    if (contact.kind === 'email') {
      pii.push({ category: 'e-mail do piloto', folded: wordRegex(value) });
    } else if (contact.kind === 'phone') {
      const regex = phoneRegex(value);
      if (regex) pii.push({ category: 'telefone do piloto', raw: regex });
    } else if (contact.kind === 'link') {
      const key = urlKey(value);
      if (key.length >= 6) {
        pii.push({ category: 'link pessoal do piloto', folded: new RegExp(escapeRegex(key)) });
      }
    }
  }

  for (const project of asArray(profile.projects).filter(isObject)) {
    for (const collaborator of asArray(project.collaborators).filter(isObject)) {
      addWord(pii, 'colaborador do piloto', asText(collaborator.name_or_role));
    }
    for (const name of nameSegments(asText(project.name) ?? '')) {
      addWord(product, 'projeto do piloto', name);
    }
    for (const key of ['public_url', 'repository_url', 'demo_url', 'documentation_url']) {
      const url = asText(project[key]);
      if (url && urlKey(url).length >= 6) {
        product.push({
          category: 'URL de projeto do piloto',
          folded: new RegExp(escapeRegex(urlKey(url))),
        });
      }
    }
  }
  for (const experience of asArray(profile.experiences).filter(isObject)) {
    for (const key of ['organization_name', 'organization_public_name']) {
      for (const name of nameSegments(asText(experience[key]) ?? '')) {
        addWord(product, 'organizacao do piloto', name);
      }
    }
  }
  for (const education of asArray(profile.education).filter(isObject)) {
    for (const name of nameSegments(asText(education.institution) ?? '')) {
      addWord(product, 'instituicao do piloto', name);
    }
  }
  return { pii, product };
}

// ---------------------------------------------------------------------------------------------
// Detectores genericos (sempre ativos)

const RESERVED_EMAIL_DOMAIN =
  /(^|\.)(test|invalid|example|localhost|local)$|^example\.(com|org|net)$|^exemplo\.(com|com\.br)$|^anthropic\.com$|^users\.noreply\.github\.com$/;

/**
 * Telefone claramente ficticio: DDD "00", assinante com no maximo 3 digitos distintos
 * (90000-0000, 98888-7777), prefixo 90000 ou sequencia de 6+ digitos consecutivos (91234-5678).
 */
const isPlaceholderPhone = (match: string): boolean => {
  const digits = match.replace(/\D/g, '');
  const subscriber = digits.slice(-9);
  if (/^(?:55)?00/.test(digits) || subscriber.startsWith('90000')) return true;
  if (new Set(subscriber).size <= 3) return true;
  const steps = [...subscriber].map((digit, index, all) =>
    index === 0 ? 0 : Number(digit) - Number(all[index - 1]),
  );
  let run = 1;
  for (let i = 1; i < steps.length; i += 1) {
    run = Math.abs(steps[i] ?? 0) === 1 && steps[i] === steps[i - 1] ? run + 1 : 1;
    if (run >= 5) return true;
  }
  return false;
};

/** Local-parts obviamente ficticios (ex.: alguem@provedor.com) nao sao PII. */
const PLACEHOLDER_EMAIL_LOCAL =
  /^(?:.{1,2}|alguem|fulano|ciclano|beltrano|someone|user|usuario|nome|name|foo|bar|test|teste|email|exemplo|example)$/;

const PLACEHOLDER_LINKEDIN =
  /exemplo|example|sample|synthetic|ficti|teste|test|seu-|your-|nome|usuario/;

export const GENERIC_DETECTORS: readonly Detector[] = [
  {
    category: 'e-mail fora de dominios reservados',
    raw: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    accept: (match) => {
      const at = match.indexOf('@');
      return (
        !RESERVED_EMAIL_DOMAIN.test(match.slice(at + 1).toLowerCase()) &&
        !PLACEHOLDER_EMAIL_LOCAL.test(match.slice(0, at).toLowerCase())
      );
    },
  },
  {
    category: 'telefone brasileiro (celular)',
    raw: /(?<![\d.])(?:\+55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?9\d{4}[\s.-]?\d{4}(?!\d)/g,
    accept: (match) => /[\s().+-]/.test(match) && !isPlaceholderPhone(match),
  },
  {
    category: 'telefone brasileiro (fixo)',
    raw: /(?<![\d.])\(\d{2}\)\s?[2-5]\d{3}-\d{4}(?!\d)/g,
    accept: (match) => !isPlaceholderPhone(match),
  },
  {
    category: 'perfil do LinkedIn',
    raw: /linkedin\.com\/in\/([A-Za-z0-9%_-]+)/gi,
    accept: (match) => !PLACEHOLDER_LINKEDIN.test(match.toLowerCase()),
  },
];

export interface Finding {
  category: string;
  line: number;
}

/** Procura os detectores em um texto. Nunca devolve o trecho encontrado, so categoria e linha. */
export function scanText(text: string, detectors: readonly Detector[]): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  const foldedLines = lines.map(fold);
  for (const detector of detectors) {
    for (let index = 0; index < lines.length; index += 1) {
      const hit =
        (detector.folded
          ? matches(detector.folded, foldedLines[index] ?? '', detector.accept)
          : false) ||
        (detector.raw ? matches(detector.raw, lines[index] ?? '', detector.accept) : false);
      if (hit) findings.push({ category: detector.category, line: index + 1 });
    }
  }
  // Nomes quebrados em duas linhas (ex.: markdown com quebra no meio do nome).
  const foldedAll = foldedLines.join(' ').replace(/\s+/g, ' ');
  for (const detector of detectors) {
    if (!detector.folded) continue;
    const alreadyFound = findings.some((finding) => finding.category === detector.category);
    if (!alreadyFound && matches(detector.folded, foldedAll, detector.accept)) {
      findings.push({ category: detector.category, line: 0 });
    }
  }
  return findings;
}

function matches(pattern: RegExp, text: string, accept?: (match: string) => boolean): boolean {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(global)) {
    if (!accept || accept(match[0])) return true;
  }
  return false;
}

const describeFindings = (file: string, findings: Finding[]): string[] =>
  findings.map(
    (finding) => `${file}${finding.line > 0 ? `:${finding.line}` : ''} -> ${finding.category}`,
  );

// ---------------------------------------------------------------------------------------------
// (a) fixture privado

describe(`fixture privado do piloto (ADR-0014)${HAS_FIXTURE ? '' : ` [IGNORADO: ${SKIP_REASON}]`}`, () => {
  const text = HAS_FIXTURE ? readFileSync(PILOT_FIXTURE, 'utf8') : '';

  it.skipIf(!HAS_FIXTURE)(
    'e aceito por loadProfile (strict), sem erros, avisos nem chaves nao mapeadas',
    () => {
      const result = loadProfile(text, { mode: 'strict' });
      expect(result.report.errors).toEqual([]);
      expect(result.ok).toBe(true);
      // o telefone pode estar em formato comum (ex.: com parenteses): a normalizacao e so informativa
      expect(result.report.warnings.filter((warning) => warning.severity !== 'info')).toEqual([]);
      expect(result.report.warnings.every((warning) => warning.code === 'PHONE_NORMALIZED')).toBe(
        true,
      );
      expect(result.report.unmapped).toEqual([]);
      expect(result.document?.schema_version).toBe('2.1.0');
    },
  );

  it.skipIf(!HAS_FIXTURE)(
    'e aceito por importProfile (strict): todo fato vira needs_review e os ids sao UUID',
    () => {
      const result = importProfile(text, { mode: 'strict' });
      expect(result.report.errors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.preview).not.toBeNull();
      const records = listRecords(result.document);
      const facts = records.filter((entry) => isFactKind(entry.kind));
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) {
        const meta = fact.value.meta as { status?: string } | null | undefined;
        expect(meta?.status, `status de ${fact.kind}`).toBe('needs_review');
      }
      for (const entry of records) {
        if (typeof entry.id === 'string') expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
      }
    },
  );

  it.skipIf(!HAS_FIXTURE)('a reimportacao com o mapa de ids anterior e idempotente', () => {
    const first = importProfile(text, { mode: 'strict' });
    const second = importProfile(text, { mode: 'strict', existingIdMap: first.report.id_map });
    expect(second.document).toEqual(first.document);
  });

  it.skipIf(!HAS_FIXTURE)('tem round-trip estavel em YAML e JSON', () => {
    const loaded = loadProfile(text, { mode: 'strict' });
    expect(loaded.ok).toBe(true);
    const document = loaded.document!;

    const yaml = serializeProfile(document, 'yaml');
    const fromYaml = loadProfile(yaml, { mode: 'strict' });
    expect(fromYaml.ok).toBe(true);
    expect(fromYaml.document).toEqual(document);
    expect(serializeProfile(fromYaml.document!, 'yaml')).toBe(yaml);

    const json = serializeProfile(document, 'json');
    const fromJson = loadProfile(json, { mode: 'strict' });
    expect(fromJson.ok).toBe(true);
    expect(fromJson.document).toEqual(document);
    expect(serializeProfile(fromJson.document!, 'json')).toBe(json);
  });

  it.skipIf(!HAS_FIXTURE)('deriva padroes de PII para a varredura (nome, contato e links)', () => {
    const loaded = loadProfile(text, { mode: 'strict' });
    const { pii, product } = derivePilotPatterns(loaded.document!);
    const categories = new Set(pii.map((detector) => detector.category));
    for (const expected of [
      'nome completo do piloto',
      'e-mail do piloto',
      'telefone do piloto',
      'link pessoal do piloto',
    ]) {
      expect(categories.has(expected), `categoria ${expected}`).toBe(true);
    }
    expect(product.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// (b) varredura dos arquivos versionados

describe('varredura de PII e de nomes exclusivos do piloto nos arquivos versionados', () => {
  const { files, via } = listVersionableFiles();
  const pilot = HAS_FIXTURE
    ? derivePilotPatterns(
        loadProfile(readFileSync(PILOT_FIXTURE, 'utf8'), { mode: 'strict' }).document!,
      )
    : { pii: [], product: [] };

  it('enumera os arquivos versionaveis (git ls-files quando disponivel) e nunca inclui os privados', () => {
    expect(files.length, `via ${via}`).toBeGreaterThan(50);
    expect(files).toContain('package.json');
    expect(files).toContain('packages/profile-io/test/pilot-no-leak.test.ts');
    const privateFiles = files.filter((file) => PRIVATE_PATH.test(file));
    expect(
      privateFiles,
      'arquivo privado do piloto apareceria no versionamento: confira o .gitignore (ADR-0014)',
    ).toEqual([]);
  });

  it('as excecoes sao caminhos exatos na raiz e existem', () => {
    for (const { file, reason } of PII_EXCEPTIONS) {
      expect(file, 'excecao deve ser um arquivo na raiz, sem curingas nem diretorios').toMatch(
        /^[A-Za-z0-9_.-]+$/,
      );
      expect(existsSync(join(ROOT, file)), `excecao sem arquivo: ${file}`).toBe(true);
      expect(reason.length).toBeGreaterThan(30);
    }
  });

  it('nenhum arquivo versionado (fora das excecoes) contem PII do piloto', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (EXCEPTION_FILES.has(file)) continue;
      const detectors = file.startsWith(GENERIC_DETECTOR_SKIP_PREFIX)
        ? pilot.pii
        : [...pilot.pii, ...GENERIC_DETECTORS];
      const findings = scanText(readFileSync(join(ROOT, file), 'utf8'), detectors);
      offenders.push(...describeFindings(file, findings));
    }
    expect(offenders, 'PII encontrada (so categoria e linha sao exibidas)').toEqual([]);
  });

  it('o codigo de producao (apps/*/src, packages/*/src) nao cita organizacoes, projetos nem URLs do piloto', () => {
    const source = files.filter(isProductSource);
    expect(source.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of source) {
      const findings = scanText(readFileSync(join(ROOT, file), 'utf8'), pilot.product);
      offenders.push(...describeFindings(file, findings));
    }
    expect(
      offenders,
      'nome exclusivo do piloto no produto (so categoria e linha sao exibidas)',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// O proprio detector precisa funcionar (sem embutir dado real)

describe('detectores da varredura (dados sinteticos montados em tempo de execucao)', () => {
  const synthetic = (): ProfileDocument =>
    ({
      schema_version: '2.0.0',
      profile: {
        identity: { full_name: ['Maria', 'Exemplar', 'Souza'].join(' ') },
        contact_points: [
          { kind: 'email', value: ['maria.souza', 'fonte-ficticia.net'].join('@') },
          { kind: 'phone', value: '21 98765-4321' },
          { kind: 'link', value: 'https://www.exemplar-souza.dev/' },
        ],
        projects: [
          {
            name: 'Projeto Aurora - Gestao ficticia',
            collaborators: [{ name_or_role: 'Joana Lima' }],
          },
        ],
        experiences: [{ organization_name: 'Empresa Ficticia Aurora' }],
      },
    }) as unknown as ProfileDocument;

  it('deriva padroes do fixture e encontra os valores (inclusive com acento, caixa e nome quebrado)', () => {
    const { pii, product } = derivePilotPatterns(synthetic());
    const hit = (text: string, detectors: Detector[]) =>
      scanText(text, detectors).map((f) => f.category);
    expect(hit('Contato: MARIA exemplar souza.', pii)).toContain('nome completo do piloto');
    expect(hit('Maria Exemplar\nSouza', pii)).toContain('nome completo do piloto');
    expect(hit(`escreva para ${['maria.souza', 'fonte-ficticia.net'].join('@')}`, pii)).toContain(
      'e-mail do piloto',
    );
    expect(hit('Tel: (21) 98765-4321 ou +55 21 987654321', pii)).toContain('telefone do piloto');
    expect(hit('veja exemplar-souza.dev/sobre', pii)).toContain('link pessoal do piloto');
    expect(hit('colaboracao com joana lima', pii)).toContain('colaborador do piloto');
    expect(hit('o projeto Aurora cresceu', product)).toContain('projeto do piloto');
    expect(hit('Empresa Ficticia Aurora S.A.', product)).toContain('organizacao do piloto');
  });

  it('nao acusa texto limpo nem palavras que apenas contem o nome como parte de outra', () => {
    const { pii, product } = derivePilotPatterns(synthetic());
    expect(
      scanText('Texto qualquer sobre perfis profissionais e currículos.', [...pii, ...product]),
    ).toEqual([]);
    expect(scanText('auroras boreais', product)).toEqual([]);
    expect(scanText('tel 219876543210', pii)).toEqual([]);
  });

  it('os detectores genericos pegam e-mail pessoal, celular e LinkedIn reais e aceitam dados ficticios', () => {
    const realEmail = ['alguem.real', 'gmail.com'].join('@');
    const realPhone = ['(12)', '99517-3846'].join(' ');
    const realLinkedin = ['linkedin.com', 'in', 'pessoa-real-123456'].join('/');
    const categories = scanText(
      `${realEmail}\n${realPhone}\nhttps://www.${realLinkedin}/`,
      GENERIC_DETECTORS,
    ).map((f) => f.category);
    expect(categories).toEqual(
      expect.arrayContaining([
        'e-mail fora de dominios reservados',
        'telefone brasileiro (celular)',
        'perfil do LinkedIn',
      ]),
    );

    const fictitious = [
      ['marina.lopes', 'exemplo.test'].join('@'),
      ['contato', 'example.invalid'].join('@'),
      '+55 81 90000-0000',
      ['https://www.linkedin.com', 'in', 'marina-exemplo'].join('/'),
      'pnpm@12.16.1 e vitest@5.1.0',
    ].join('\n');
    expect(scanText(fictitious, GENERIC_DETECTORS)).toEqual([]);
  });

  it('as mensagens nao reproduzem o valor encontrado', () => {
    const { pii } = derivePilotPatterns(synthetic());
    const lines = describeFindings('x.md', scanText('Maria Exemplar Souza', pii)).join('\n');
    expect(lines).toBe('x.md:1 -> nome completo do piloto');
  });
});
