/**
 * Limites de seguranca do parse de YAML/JSON de perfil (entrada nao confiavel).
 *
 * - `maxBytes`: tamanho do texto em bytes UTF-8 (ADR-0013: 2 MiB para importacao de perfil).
 * - `maxDepth`: profundidade maxima de aninhamento de mapas/listas (o contrato real usa ~8).
 * - `maxNodes`: quantidade total de nos (escalares, mapas, listas) do documento.
 * - `maxStringLength`: tamanho maximo de qualquer string (o contrato limita campos a 10.000).
 * - `maxKeyLength`: tamanho maximo de chave de mapa.
 *
 * YAML tambem e restrito por construcao (ver `parse.ts`): esquema "core" 1.2 (sem !!binary,
 * !!set, timestamps nem tags customizadas), SEM ancoras, aliases, chaves de mescla (`<<`),
 * tags explicitas, documentos multiplos ou chaves duplicadas.
 */
export interface ParseLimits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxStringLength: number;
  maxKeyLength: number;
}

export const DEFAULT_PARSE_LIMITS: Readonly<ParseLimits> = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxNodes: 200_000,
  maxStringLength: 20_000,
  maxKeyLength: 128,
});

/** Chaves que nunca sao aceitas em nenhum nivel (defesa contra poluicao de prototipo). */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
