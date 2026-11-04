import { describe, expect, it } from 'vitest';
import { DEFAULT_PARSE_LIMITS, detectTextFormat, parseProfileText } from '../src/index';

const codes = (result: ReturnType<typeof parseProfileText>) =>
  result.ok ? [] : result.errors.map((e) => e.code);

describe('detectTextFormat', () => {
  it('JSON quando comeca com {; caso contrario YAML', () => {
    expect(detectTextFormat('{"a":1}')).toBe('json');
    expect(detectTextFormat('  \n {"a":1}')).toBe('json');
    expect(detectTextFormat('\uFEFF{"a":1}')).toBe('json');
    expect(detectTextFormat('schema_version: "2.0.0"')).toBe('yaml');
    expect(detectTextFormat('# comentario\nprofile: {}')).toBe('yaml');
  });
});

describe('parse valido', () => {
  it('le YAML e JSON equivalentes para o mesmo dado', () => {
    const yaml = parseProfileText(
      'schema_version: "2.0.0"\nprofile:\n  identity:\n    full_name: Ana\n',
    );
    const json = parseProfileText(
      '{"schema_version":"2.0.0","profile":{"identity":{"full_name":"Ana"}}}',
    );
    expect(yaml.ok && json.ok).toBe(true);
    expect(yaml.ok && yaml.data).toEqual(json.ok && json.data);
    expect(yaml.format).toBe('yaml');
    expect(json.format).toBe('json');
  });

  it('YAML usa esquema core 1.2: datas ficam como texto, null e booleanos tipados, sem timestamps', () => {
    const result = parseProfileText(
      'a: 2020-03-15\nb: 2020-03\nc: 2020\nd: ~\ne: yes\nf: 1.0.0\ng: "007"\nh: null\n',
    );
    expect(result.ok && result.data).toEqual({
      a: '2020-03-15',
      b: '2020-03',
      c: 2020,
      d: null,
      e: 'yes',
      f: '1.0.0',
      g: '007',
      h: null,
    });
  });

  it('aceita BOM, CRLF e comentarios', () => {
    const result = parseProfileText('\uFEFF# c\r\nschema_version: "2.0.0"\r\nprofile: {}\r\n');
    expect(result.ok && result.data).toEqual({ schema_version: '2.0.0', profile: {} });
  });

  it('o formato pode ser forcado', () => {
    expect(parseProfileText('{"a":1}', { format: 'yaml' }).ok).toBe(true); // JSON e YAML valido
    expect(codes(parseProfileText('a: 1', { format: 'json' }))).toEqual(['SYNTAX']);
  });

  it('preserva unicode e quebras de linha em blocos', () => {
    const result = parseProfileText('t: |\n  linha 1\n  linha 2 — ação\n');
    expect(result.ok && result.data.t).toBe('linha 1\nlinha 2 — ação\n');
  });
});

describe('entradas invalidas', () => {
  it('vazio, so comentarios e raiz que nao e objeto', () => {
    expect(codes(parseProfileText(''))).toEqual(['EMPTY']);
    expect(codes(parseProfileText('   \n\t'))).toEqual(['EMPTY']);
    expect(codes(parseProfileText('# so comentario'))).toEqual(['NOT_AN_OBJECT']);
    expect(codes(parseProfileText('- a\n- b'))).toEqual(['NOT_AN_OBJECT']);
    expect(codes(parseProfileText('texto solto'))).toEqual(['NOT_AN_OBJECT']);
    expect(codes(parseProfileText('[1,2]', { format: 'json' }))).toEqual(['NOT_AN_OBJECT']);
    expect(codes(parseProfileText('null', { format: 'json' }))).toEqual(['NOT_AN_OBJECT']);
  });

  it('erros de sintaxe YAML e JSON', () => {
    expect(codes(parseProfileText('a: [1, 2'))).toContain('SYNTAX');
    expect(codes(parseProfileText('a: b: c'))).toContain('SYNTAX');
    expect(codes(parseProfileText('{"a": }'))).toEqual(['SYNTAX']);
    expect(codes(parseProfileText('{"a": 1,}'))).toEqual(['SYNTAX']);
  });

  it('chaves duplicadas e documentos multiplos', () => {
    expect(codes(parseProfileText('a: 1\na: 2\n'))).toContain('DUPLICATE_KEY');
    expect(codes(parseProfileText('a: 1\n---\nb: 2\n'))).toContain('MULTIPLE_DOCUMENTS');
  });
});

describe('protecao contra YAML malicioso', () => {
  it('bloqueia aliases e ancoras (billion laughs)', () => {
    const bomb = 'a: &a [x, x]\nb: &b [*a, *a]\nc: &c [*b, *b]\nd: [*c, *c]\n';
    const result = parseProfileText(bomb);
    expect(result.ok).toBe(false);
    expect(
      codes(result).some((code) => code === 'ALIAS_NOT_ALLOWED' || code === 'ANCHOR_NOT_ALLOWED'),
    ).toBe(true);
    expect(codes(parseProfileText('a: &x 1\n'))).toContain('ANCHOR_NOT_ALLOWED');
    expect(codes(parseProfileText('a: &x 1\nb: *x\n'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/ALIAS|ANCHOR/)]),
    );
  });

  it('bloqueia tags explicitas e tags desconhecidas/perigosas', () => {
    expect(codes(parseProfileText('a: !!js/function "function(){}"\n'))).toContain(
      'TAG_NOT_ALLOWED',
    );
    expect(codes(parseProfileText('a: !custom x\n'))).toContain('TAG_NOT_ALLOWED');
    expect(codes(parseProfileText('a: !!str 123\n'))).toContain('TAG_NOT_ALLOWED');
    expect(codes(parseProfileText('a: !!binary aGVsbG8=\n'))).toContain('TAG_NOT_ALLOWED');
    expect(codes(parseProfileText('a: !!set {x}\n'))).toContain('TAG_NOT_ALLOWED');
  });

  it('bloqueia chaves de mescla (<<)', () => {
    const merge = 'base: &b {x: 1}\nderived:\n  <<: *b\n  y: 2\n';
    expect(parseProfileText(merge).ok).toBe(false);
    expect(codes(parseProfileText('derived:\n  <<: {x: 1}\n'))).toContain('MERGE_KEY_NOT_ALLOWED');
  });

  it('bloqueia chaves de poluicao de prototipo em YAML e JSON, em qualquer nivel', () => {
    expect(codes(parseProfileText('__proto__:\n  polluted: true\n'))).toContain('FORBIDDEN_KEY');
    expect(codes(parseProfileText('{"profile":{"__proto__":{"polluted":true}}}'))).toContain(
      'FORBIDDEN_KEY',
    );
    expect(codes(parseProfileText('a:\n  - constructor: x\n'))).toContain('FORBIDDEN_KEY');
    expect(codes(parseProfileText('a:\n  prototype: x\n'))).toContain('FORBIDDEN_KEY');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejeita numeros nao finitos', () => {
    expect(codes(parseProfileText('a: .inf\n'))).toContain('NON_FINITE_NUMBER');
    expect(codes(parseProfileText('a: .nan\n'))).toContain('NON_FINITE_NUMBER');
    expect(codes(parseProfileText('a: -.inf\n'))).toContain('NON_FINITE_NUMBER');
  });
});

describe('limites de tamanho e profundidade', () => {
  it('limita bytes (UTF-8, nao caracteres)', () => {
    const big = `a: "${'x'.repeat(2_000)}"`;
    expect(codes(parseProfileText(big, { limits: { maxBytes: 1_000 } }))).toEqual(['TOO_LARGE']);
    // 400 caracteres de 3 bytes = 1200 bytes > 1000, embora 400 < 1000 caracteres
    const multibyte = `a: "${'€'.repeat(400)}"`;
    expect(codes(parseProfileText(multibyte, { limits: { maxBytes: 1_000 } }))).toEqual([
      'TOO_LARGE',
    ]);
    expect(parseProfileText('a: 1', { limits: { maxBytes: 1_000 } }).ok).toBe(true);
  });

  it('padrao: 2 MiB', () => {
    expect(DEFAULT_PARSE_LIMITS.maxBytes).toBe(2 * 1024 * 1024);
    const justOver = `a: "${'x'.repeat(DEFAULT_PARSE_LIMITS.maxBytes)}"`;
    expect(codes(parseProfileText(justOver))).toEqual(['TOO_LARGE']);
  });

  it('limita profundidade em JSON e em YAML (incluindo aninhamento extremo sem estourar a pilha)', () => {
    const depth = 40;
    const json = '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);
    expect(codes(parseProfileText(json))).toContain('TOO_DEEP');
    const yaml =
      Array.from({ length: depth }, (_, i) => `${'  '.repeat(i)}k${i}:`).join('\n') +
      `\n${'  '.repeat(depth)}v: 1\n`;
    expect(codes(parseProfileText(yaml))).toContain('TOO_DEEP');
    const ok = '{"a":'.repeat(10) + '1' + '}'.repeat(10);
    expect(parseProfileText(ok).ok).toBe(true);
    const extreme = '['.repeat(50_000) + ']'.repeat(50_000);
    const result = parseProfileText(`{"a":${extreme}}`);
    expect(result.ok).toBe(false);
  });

  it('limita quantidade de nos e tamanho de strings e chaves', () => {
    const many = `{"a":[${Array.from({ length: 300 }, () => '1').join(',')}]}`;
    expect(codes(parseProfileText(many, { limits: { maxNodes: 100 } }))).toContain(
      'TOO_MANY_NODES',
    );
    const manyYaml = `a:\n${Array.from({ length: 300 }, () => '  - 1').join('\n')}\n`;
    expect(codes(parseProfileText(manyYaml, { limits: { maxNodes: 100 } }))).toContain(
      'TOO_MANY_NODES',
    );
    expect(
      codes(parseProfileText(`a: "${'x'.repeat(50)}"`, { limits: { maxStringLength: 10 } })),
    ).toContain('STRING_TOO_LONG');
    expect(
      codes(parseProfileText(`${'k'.repeat(50)}: 1`, { limits: { maxKeyLength: 10 } })),
    ).toContain('KEY_TOO_LONG');
  });
});
