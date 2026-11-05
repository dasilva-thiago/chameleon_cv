import { get, type FieldErrors, type FieldValues, type Resolver } from 'react-hook-form';
import { leafFields, type FieldDef, type FormSpec } from '../field-defs';

/** Chave de erro de formulario inteiro (nao ligado a um campo). */
export const FORM_ERROR_KEY = '__form';

type Json = Record<string, unknown>;

export const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Remove o que nao e informacao: `null`, `undefined`, texto vazio, listas e objetos vazios.
 * Retorna `undefined` quando nada sobra. Ausencia = "nao informado" (ADR-0005): o formulario nunca
 * grava `[]` nem texto vazio, para nao afirmar "nenhum item".
 */
export function prune(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined);
    return items.length === 0 ? undefined : items;
  }
  if (isJson(value)) {
    const out: Json = {};
    for (const [key, child] of Object.entries(value)) {
      const pruned = prune(child);
      if (pruned !== undefined) out[key] = pruned;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return value;
}

export function pruneRecord(values: FieldValues): Json {
  const pruned = prune(values);
  return isJson(pruned) ? pruned : {};
}

/** Chaves de sub-registros: sao editadas em listas proprias, nunca no formulario do pai. */
const CHILD_KEYS = ['items', 'collaborators'] as const;

/** Valores iniciais do formulario a partir de um registro existente (sem id nem filhos). */
export function toFormValues(record: Json | undefined): FieldValues {
  if (record === undefined) return {};
  const copy = structuredClone(record);
  delete copy.id;
  for (const key of CHILD_KEYS) delete copy[key];
  return copy;
}

/** Valor em `a.b.c` de um objeto (sem lancar). */
export function getPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (!isJson(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function blankToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  return Number(value.replace(',', '.'));
}

export function boolOrNull(value: unknown): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Resolver baseado nos schemas do contrato

interface IssueLike {
  code: string;
  message: string;
  path: readonly PropertyKey[];
  maximum?: number | bigint;
}

export interface ContractSchema {
  safeParse(
    data: unknown,
  ): { success: true; data: unknown } | { success: false; error: { issues: readonly IssueLike[] } };
}

function indexFields(spec: FormSpec): Map<string, FieldDef> {
  const index = new Map<string, FieldDef>();
  const walk = (fields: FieldDef[], prefix: string): void => {
    for (const field of fields) {
      const full = prefix === '' ? field.name : `${prefix}.${field.name}`;
      if (field.kind === 'group') walk(field.fields, full);
      else index.set(full, field);
    }
  };
  for (const g of spec.groups) walk(g.fields, '');
  return index;
}

/** Caminhos que o formulario de governanca (criacao) tambem exibe. */
const GOVERNANCE_PATHS = new Set(['meta.status', 'meta.visibility', 'meta.resume_use']);

function friendlyMessage(
  issue: IssueLike,
  field: FieldDef | undefined,
  values: FieldValues,
): string {
  const raw = issue.message;
  if (raw.startsWith('Registro sem conteudo')) {
    return 'Preencha ao menos um campo antes de salvar.';
  }
  if (raw.startsWith('A restricao precisa de um alvo')) return 'Informe o termo a restringir.';
  if (raw.includes('e anterior a ')) return 'A data final não pode ser anterior à data inicial.';
  if (raw.startsWith('Valor invalido para contato')) {
    const kind = getPath(values, 'kind');
    if (kind === 'email') return 'Informe um e-mail válido.';
    if (kind === 'phone') return 'Informe um telefone válido, com DDD (ex.: +55 11 91234-5678).';
    return 'Informe um endereço completo, começando com http:// ou https://.';
  }
  if (raw.startsWith('field_states')) {
    return 'Um campo marcado como "não se aplica", "prefiro não informar" ou "ainda não avaliado" tem valor preenchido. Limpe o valor ou remova a marca.';
  }
  if (raw.startsWith('Subtipo')) return 'Este subtipo não se aplica ao tipo escolhido.';
  if (raw.startsWith('url_or_location')) {
    return 'Informe um link http(s) válido ou apenas uma descrição de onde encontrar.';
  }
  if (field?.kind === 'date') return 'Use AAAA, AAAA-MM ou AAAA-MM-DD, com uma data que exista.';
  if (field?.kind === 'text' && field.input === 'url') {
    return 'Informe um endereço completo, começando com http:// ou https://.';
  }
  if (field?.kind === 'text' && field.input === 'email') return 'Informe um e-mail válido.';
  if (field?.kind === 'number') return 'Informe um número válido.';
  if (field?.kind === 'list') {
    return 'Algum item da lista é inválido ou longo demais. Use um item por linha.';
  }
  if (issue.code === 'too_big') {
    return typeof issue.maximum === 'number'
      ? `Texto longo demais (máximo de ${String(issue.maximum)} caracteres).`
      : 'Valor grande demais.';
  }
  if (issue.code === 'invalid_value') return 'Escolha uma das opções da lista.';
  if (issue.code === 'invalid_type') return 'Preencha este campo.';
  if (issue.code === 'invalid_format') return 'O formato não é válido. Confira a dica do campo.';
  return 'Valor inválido.';
}

function setNested(errors: Json, path: readonly string[], message: string, type: string): void {
  let cursor = errors;
  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      if (!isJson(cursor[segment]) || cursor[segment].message === undefined) {
        cursor[segment] = { type, message };
      }
      return;
    }
    const next = cursor[segment];
    if (isJson(next)) cursor = next;
    else {
      const created: Json = {};
      cursor[segment] = created;
      cursor = created;
    }
  });
}

/**
 * Resolver do react-hook-form construido sobre o schema do CONTRATO (o mesmo que a API aplica):
 * a validacao e a do dominio, aqui apenas traduzida para mensagens em pt-BR e mapeada para campos.
 * Os valores sao podados antes (texto em branco vira "nao informado"), e problemas do registro
 * inteiro ou de campos nao exibidos vao para `FORM_ERROR_KEY`.
 */
export function contractResolver(schema: ContractSchema, spec: FormSpec): Resolver<FieldValues> {
  const index = indexFields(spec);
  return (values) => {
    const result = schema.safeParse(pruneRecord(values));
    if (result.success) return { values, errors: {} };

    const errors: Json = {};
    const formMessages: string[] = [];
    for (const issue of result.error.issues) {
      // Erros em itens de lista (`tags.2`) sao mostrados no campo da lista.
      const firstIndex = issue.path.findIndex((segment) => typeof segment === 'number');
      const segments = (firstIndex === -1 ? issue.path : issue.path.slice(0, firstIndex)).map(
        String,
      );
      const key = segments.join('.');
      const field = index.get(key);
      const message = friendlyMessage(issue, field, values);
      if (field !== undefined || GOVERNANCE_PATHS.has(key) || key === 'meta.field_states') {
        setNested(errors, segments, message, issue.code);
      } else if (!formMessages.includes(message)) {
        formMessages.push(message);
      }
    }
    if (formMessages.length > 0) {
      errors[FORM_ERROR_KEY] = { type: 'form', message: formMessages.join(' ') };
    }
    return { values: {}, errors: errors as FieldErrors<FieldValues> };
  };
}

export { leafFields };

/** Mensagem de erro do react-hook-form no caminho dado, se houver. */
export function errorMessageAt(errors: FieldErrors, path: string): string | undefined {
  const entry: unknown = get(errors, path);
  if (typeof entry !== 'object' || entry === null || !('message' in entry)) return undefined;
  return typeof entry.message === 'string' ? entry.message : undefined;
}
