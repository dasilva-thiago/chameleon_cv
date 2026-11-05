import {
  ANALYSIS_LIMITS,
  type JobRequirement,
  type RequirementImportance,
} from '@chameleon/contracts';
import { foldDiacritics } from './text';

/**
 * Extracao deterministica de requisitos do texto de uma vaga. O texto e DADO nao confiavel: nada aqui o
 * executa nem o interpreta como instrucao; so recorta linhas sob titulos conhecidos e extrai siglas/termos.
 */

export const EXTRACTOR_VERSION = 'req-1';

type SectionKind = RequirementImportance | 'ignored';

const HEADINGS: readonly { kind: SectionKind; names: readonly string[] }[] = [
  {
    kind: 'mandatory',
    names: [
      'requisitos',
      'requisitos obrigatorios',
      'requisitos e qualificacoes',
      'requisitos minimos',
      'pre requisitos',
      'qualificacoes',
      'qualificacoes obrigatorias',
      'obrigatorio',
      'obrigatorios',
      'o que esperamos',
      'o que buscamos',
      'o que voce precisa ter',
      'o que voce precisa saber',
      'voce precisa',
      'experiencia necessaria',
      'requirements',
      'required',
      'required qualifications',
      'minimum qualifications',
      'qualifications',
      'must have',
      'must haves',
      'what we need',
      'what you bring',
      'what we are looking for',
    ],
  },
  {
    kind: 'desirable',
    names: [
      'diferenciais',
      'diferencial',
      'desejavel',
      'desejaveis',
      'sera um diferencial',
      'pontos extras',
      'seria legal',
      'nice to have',
      'nice to haves',
      'preferred',
      'preferred qualifications',
      'bonus',
      'bonus points',
      'plus',
      'a plus',
    ],
  },
  {
    kind: 'responsibility',
    names: [
      'responsabilidades',
      'responsabilidades e atribuicoes',
      'atribuicoes',
      'atividades',
      'o que voce fara',
      'o que voce vai fazer',
      'seu dia a dia',
      'atuacao',
      'responsibilities',
      'what you will do',
      'what you ll do',
      'your role',
      'day to day',
      'duties',
    ],
  },
  {
    kind: 'ignored',
    names: [
      'oferecemos',
      'nos oferecemos',
      'beneficios',
      'o que oferecemos',
      'sobre a empresa',
      'sobre nos',
      'sobre a vaga',
      'sobre',
      'salario',
      'remuneracao',
      'processo seletivo',
      'etapas do processo',
      'informacoes adicionais',
      'about us',
      'about the company',
      'about the role',
      'benefits',
      'what we offer',
      'compensation',
      'salary',
      'how to apply',
    ],
  },
];

const HEADING_LOOKUP: ReadonlyMap<string, SectionKind> = new Map(
  HEADINGS.flatMap((group) => group.names.map((name) => [name, group.kind] as const)),
);

const BULLET = /^\s*(?:[-*•·▪◦●○‣⁃–—]|\d{1,2}[.)])\s+/u;

const FUZZY_HEADINGS: readonly { kind: SectionKind; test: RegExp }[] = [
  { kind: 'desirable', test: /desej|diferenc|nice to have|preferred|bonus|^plus$|extras?$/ },
  {
    kind: 'ignored',
    test: /benef|ofere|sobre|salari|remunera|processo|candidat|about|apply|salary|compens|etapas|informac|contrata|perfil da empresa|cultura/,
  },
  {
    kind: 'responsibility',
    test: /respons|atribui|atividade|o que (voce )?(fara|vai fazer)|dia a dia|atuacao|duties|your role|what you/,
  },
  {
    kind: 'mandatory',
    test: /requisit|qualific|obrigat|esperamos|buscamos|precisa|necessari|requirement|must have|looking for|what you bring/,
  },
];

function classifyLabel(label: string): SectionKind | undefined {
  const key = foldDiacritics(label)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (key === '' || key.split(' ').length > 7) return undefined;
  const exact = HEADING_LOOKUP.get(key);
  if (exact !== undefined) return exact;
  return FUZZY_HEADINGS.find((rule) => rule.test.test(key))?.kind;
}

interface HeadingLine {
  kind: SectionKind;
  /** Texto na mesma linha, depois dos dois-pontos ("Requisitos: Node e SQL"). */
  inline: string;
}

/** Linha curta que e um titulo de secao ("Requisitos", "O que você fará:", "Benefícios: vale-refeição"). */
function headingOf(line: string): HeadingLine | undefined {
  const stripped = line.trim();
  if (stripped === '' || BULLET.test(line)) return undefined;
  const colon = stripped.indexOf(':');
  if (colon > 0 && colon <= 40) {
    const kind = classifyLabel(stripped.slice(0, colon));
    if (kind !== undefined) return { kind, inline: stripped.slice(colon + 1).trim() };
  }
  if (stripped.length > 50 || /[.!?;]$/.test(stripped)) return undefined;
  const kind = classifyLabel(stripped.replace(/:$/, ''));
  return kind === undefined ? undefined : { kind, inline: '' };
}

const MIN_LINE = 6;

/** Palavras de abertura comuns que NAO sao tecnologias mesmo quando capitalizadas. */
const OPENING_WORDS = new Set(
  [
    'experiencia',
    'conhecimento',
    'conhecimentos',
    'vivencia',
    'nocoes',
    'dominio',
    'formacao',
    'graduacao',
    'certificacao',
    'ingles',
    'espanhol',
    'boa',
    'bom',
    'capacidade',
    'habilidade',
    'familiaridade',
    'desejavel',
    'diferencial',
    'proficiencia',
    'experience',
    'knowledge',
    'strong',
    'good',
    'ability',
    'proven',
    'degree',
  ].map(foldDiacritics),
);

/** Palavra inteira em maiusculas e longa ("IMPORTANTE"): grito, nao sigla. */
const isShouting = (word: string): boolean => /^\p{Lu}{7,}$/u.test(word);

/** Termos que parecem tecnologias, ferramentas ou siglas (capitalizados no meio da frase, com simbolos ou SIGLAS). */
export function extractKeywords(text: string): string[] {
  const words = text.split(/[\s,;:()[\]{}"“”]+/u).filter((word) => word !== '');
  const found: string[] = [];
  const seen = new Set<string>();
  words.forEach((rawWord, index) => {
    const word = rawWord.replace(/^[.!?¿¡'-]+|[.!?'-]+$/gu, '');
    if (word.length < 2 || word.length > 40) return;
    const pieces = word.includes('/') ? word.split('/').filter((piece) => piece !== '') : [word];
    const candidates = word.includes('/') && pieces.length > 1 ? [word, ...pieces] : pieces;
    for (const piece of candidates) {
      const folded = foldDiacritics(piece);
      const hasSymbol = /[0-9+#]|[a-z]\.[a-z]/i.test(piece);
      const isAcronym = /^[A-Z][A-Z0-9]{1,5}$/u.test(piece);
      const capitalized = /^\p{Lu}/u.test(piece) && piece.length > 2;
      const afterStop = index > 0 && /[.!?:]$/.test(words[index - 1] ?? '');
      const midSentence =
        index > 0 && !afterStop && capitalized && !OPENING_WORDS.has(folded) && !isShouting(piece);
      const openingTech = index === 0 && capitalized && /[A-Z].*[A-Z]|[0-9+#.]/.test(piece);
      if (!(hasSymbol || isAcronym || midSentence || openingTech)) continue;
      if (OPENING_WORDS.has(folded) || seen.has(folded)) continue;
      seen.add(folded);
      found.push(piece);
    }
  });
  return found.slice(0, ANALYSIS_LIMITS.keywordsPerRequirement);
}

const YEARS = /(\d{1,2})\s*\+?\s*(?:anos?|years?|yrs?)\b/iu;

export function yearsIn(text: string): number | null {
  const match = YEARS.exec(text);
  if (!match?.[1]) return null;
  const years = Number(match[1]);
  return years >= 1 && years <= 50 ? years : null;
}

function cleanLine(line: string): string {
  return line
    .replace(BULLET, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ANALYSIS_LIMITS.requirementText);
}

export interface ExtractionResult {
  requirements: JobRequirement[];
  warnings: string[];
}

/**
 * Recorta os requisitos: cada item de lista (ou linha) sob um titulo reconhecido vira um requisito.
 * Sem titulos reconhecidos, os itens de lista viram obrigatorios; sem listas, as primeiras frases viram
 * responsabilidades; sempre com aviso.
 */
export function extractRequirements(jobText: string): ExtractionResult {
  const warnings: string[] = [];
  const lines = jobText.replace(/\r\n?/g, '\n').split('\n');
  const raw: { importance: RequirementImportance; text: string }[] = [];
  let section: SectionKind | undefined;
  let sawHeading = false;

  for (const line of lines) {
    const heading = headingOf(line);
    if (heading !== undefined) {
      section = heading.kind;
      sawHeading = true;
      const inline = cleanLine(heading.inline);
      if (heading.kind !== 'ignored' && inline.length >= MIN_LINE) {
        raw.push({ importance: heading.kind, text: inline });
      }
      continue;
    }
    if (section === undefined || section === 'ignored') continue;
    const text = cleanLine(line);
    if (text.length < MIN_LINE) continue;
    raw.push({ importance: section, text });
  }

  if (!sawHeading || raw.length === 0) {
    const bullets = lines.filter((line) => BULLET.test(line)).map(cleanLine);
    const picked = bullets.filter((text) => text.length >= MIN_LINE);
    if (picked.length > 0) {
      warnings.push(
        'Nenhuma seção de requisitos foi reconhecida; os itens de lista foram tratados como obrigatórios.',
      );
      for (const text of picked) raw.push({ importance: 'mandatory', text });
    } else {
      const sentences = jobText
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/u)
        .map((sentence) => sentence.trim().slice(0, ANALYSIS_LIMITS.requirementText))
        .filter((sentence) => sentence.length >= 20)
        .slice(0, 15);
      if (sentences.length > 0) {
        warnings.push(
          'O texto não tem seções nem listas; as primeiras frases foram tratadas como responsabilidades.',
        );
        for (const text of sentences) raw.push({ importance: 'responsibility', text });
      } else {
        warnings.push('Não foi possível identificar requisitos neste texto.');
      }
    }
  }

  if (raw.length > ANALYSIS_LIMITS.requirements) {
    warnings.push(
      `A vaga tem mais de ${String(ANALYSIS_LIMITS.requirements)} itens; só os primeiros foram analisados.`,
    );
  }
  const requirements = raw.slice(0, ANALYSIS_LIMITS.requirements).map((item, index) => ({
    id: `r${String(index + 1)}`,
    importance: item.importance,
    text: item.text,
    keywords: extractKeywords(item.text),
    yearsRequired: yearsIn(item.text),
  }));
  return { requirements, warnings };
}

const INSTRUCTION_LIKE =
  /\b(ignore|ignorar|desconsidere|esque[cç]a)\b.{0,40}\b(instru[cç][õo]es|instructions|prompt)\b|\b(system prompt|prompt do sistema|revele o prompt|reveal the prompt)\b/iu;

/** O texto contem trechos que parecem comandos para uma IA: so e avisado, nunca obedecido. */
export function looksLikeInstructions(jobText: string): boolean {
  return INSTRUCTION_LIKE.test(jobText);
}
