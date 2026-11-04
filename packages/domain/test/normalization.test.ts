import { describe, expect, it } from 'vitest';
import {
  createLocalIdAllocator,
  emptyToNull,
  isBlankValue,
  isUuid,
  isUuidV7,
  newId,
  normalizeKey,
  normalizeText,
  uniqueByKey,
  unionStrings,
} from '../src/index';

describe('normalizeText', () => {
  it('colapsa espacos e normaliza NFC em linha unica', () => {
    expect(normalizeText('  Ana   Maria \t da  Silva  ')).toBe('Ana Maria da Silva');
    expect(normalizeText('Café')).toBe('Café'); // NFD -> NFC
  });

  it('remove caracteres de controle e converte CRLF', () => {
    expect(normalizeText('a\u0000b\u0007c')).toBe('abc');
    expect(normalizeText('linha 1\r\nlinha 2', { multiline: true })).toBe('linha 1\nlinha 2');
  });

  it('modo multilinha preserva paragrafos, a indentacao inicial e limita linhas em branco', () => {
    expect(normalizeText('a  b \n\n\n\n  c   d  ', { multiline: true })).toBe('a b\n\n  c d');
    expect(normalizeText('  inicio\n  - item\n    - subitem  ', { multiline: true })).toBe(
      'inicio\n  - item\n    - subitem',
    );
  });

  it('nao altera texto ja limpo (idempotente)', () => {
    const once = normalizeText('  texto   com\tespacos ');
    expect(normalizeText(once)).toBe(once);
  });
});

describe('emptyToNull', () => {
  it('converte vazio, espacos e null em null', () => {
    expect(emptyToNull('')).toBeNull();
    expect(emptyToNull('   \n\t')).toBeNull();
    expect(emptyToNull(null)).toBeNull();
    expect(emptyToNull(undefined)).toBeNull();
    expect(emptyToNull('  x ')).toBe('x');
    expect(emptyToNull('\u0000')).toBeNull();
  });
});

describe('normalizeKey / listas', () => {
  it('ignora caixa, acentos e espacos repetidos', () => {
    expect(normalizeKey('  Gestão   de  ESTOQUES ')).toBe('gestao de estoques');
    expect(normalizeKey('C#')).not.toBe(normalizeKey('C'));
    expect(normalizeKey('Java')).not.toBe(normalizeKey('JavaScript'));
  });

  it('uniqueByKey mantem a primeira ocorrencia e a ordem', () => {
    expect(uniqueByKey(['Excel', 'excel ', 'Word', 'WORD', '', '  '])).toEqual(['Excel', 'Word']);
  });

  it('unionStrings aceita listas ausentes', () => {
    expect(unionStrings(['a', 'b'], undefined, null, ['B', 'c'])).toEqual(['a', 'b', 'c']);
    expect(unionStrings()).toEqual([]);
  });

  it('isBlankValue', () => {
    expect(isBlankValue(null)).toBe(true);
    expect(isBlankValue('  ')).toBe(true);
    expect(isBlankValue([])).toBe(true);
    expect(isBlankValue([null, ''])).toBe(true);
    expect(isBlankValue({ a: '', b: [] })).toBe(true);
    expect(isBlankValue(false)).toBe(false);
    expect(isBlankValue(0)).toBe(false);
    expect(isBlankValue({ a: ['x'] })).toBe(false);
  });
});

describe('ids', () => {
  it('newId gera UUID v7 unicos e ordenaveis por tempo', () => {
    const a = newId();
    const b = newId();
    expect(isUuid(a)).toBe(true);
    expect(isUuidV7(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isUuidV7('11111111-1111-4111-8111-111111111111')).toBe(false); // v4
    expect(isUuid('EXP-001')).toBe(false);
  });

  it('alocador deterministico nao colide com ids existentes', () => {
    const next = createLocalIdAllocator(['SKL-001', 'SKL-003']);
    expect(next('SKL')).toBe('SKL-002');
    expect(next('SKL')).toBe('SKL-004');
    expect(next('EXP')).toBe('EXP-001');
    expect(next('EXP')).toBe('EXP-002');
  });
});
