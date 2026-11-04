import { describe, expect, it } from 'vitest';
import {
  compareNullableDates,
  comparePartialDates,
  comparePeriodsMostRecentFirst,
  datePrecision,
  datesMayOverlap,
  formatPartialDate,
  formatPeriod,
  isDefinitelyAfter,
  isDefinitelyBefore,
  isOngoing,
  isPartialDate,
  parsePartialDate,
  periodDurationMonths,
  toEarliestIsoDate,
  toLatestIsoDate,
  toPartialDate,
  validatePeriod,
} from '../src/index';

describe('parsePartialDate / precisao', () => {
  it('infere a precisao pelo comprimento e nunca a aumenta', () => {
    expect(parsePartialDate('2020')).toMatchObject({
      year: 2020,
      month: null,
      day: null,
      precision: 'year',
    });
    expect(parsePartialDate('2020-03')).toMatchObject({
      year: 2020,
      month: 3,
      day: null,
      precision: 'month',
    });
    expect(parsePartialDate('2020-03-15')).toMatchObject({
      year: 2020,
      month: 3,
      day: 15,
      precision: 'day',
    });
    expect(datePrecision('2020')).toBe('year');
    expect(datePrecision('2020-03-15')).toBe('day');
  });

  it.each([
    '',
    '20',
    '2020-1',
    '2020-13',
    '2020-00',
    '2020-02-30',
    '2021-02-29',
    '2020-04-31',
    '2020-03-32',
    '0999',
    '0000',
    'last summer',
    '2020/03',
    '2020-03-15T10:00:00Z',
    ' 2020',
  ])('rejeita %j', (value) => {
    expect(parsePartialDate(value)).toBeNull();
    expect(isPartialDate(value)).toBe(false);
  });

  it('aceita 29/02 em ano bissexto (incluindo seculo divisivel por 400) e rejeita em seculo nao bissexto', () => {
    expect(isPartialDate('2024-02-29')).toBe(true);
    expect(isPartialDate('2000-02-29')).toBe(true);
    expect(isPartialDate('1900-02-29')).toBe(false);
  });

  it('nao aceita valores que nao sao texto', () => {
    expect(isPartialDate(2020)).toBe(false);
    expect(isPartialDate(null)).toBe(false);
    expect(isPartialDate(undefined)).toBe(false);
  });
});

describe('limites do intervalo coberto', () => {
  it('expande para o primeiro e o ultimo dia', () => {
    expect(toEarliestIsoDate('2020')).toBe('2020-01-01');
    expect(toLatestIsoDate('2020')).toBe('2020-12-31');
    expect(toEarliestIsoDate('2020-02')).toBe('2020-02-01');
    expect(toLatestIsoDate('2020-02')).toBe('2020-02-29');
    expect(toLatestIsoDate('2021-02')).toBe('2021-02-28');
    expect(toEarliestIsoDate('2020-03-15')).toBe('2020-03-15');
    expect(toLatestIsoDate('2020-03-15')).toBe('2020-03-15');
    expect(toEarliestIsoDate('invalida')).toBeNull();
  });
});

describe('comparePartialDates', () => {
  it('ordena por inicio do intervalo e, no empate, pela precisao (mais grossa primeiro)', () => {
    const shuffled = ['2020-03-15', '2020', '2019-12', '2020-03', '2021', '2020-01'];
    expect([...shuffled].sort(comparePartialDates)).toEqual([
      '2019-12',
      '2020',
      '2020-01',
      '2020-03',
      '2020-03-15',
      '2021',
    ]);
  });

  it('e antissimetrica e retorna 0 para datas iguais', () => {
    expect(comparePartialDates('2020-03', '2020-03')).toBe(0);
    expect(comparePartialDates('2020', '2021')).toBe(-1);
    expect(comparePartialDates('2021', '2020')).toBe(1);
  });

  it('lanca RangeError para datas invalidas', () => {
    expect(() => comparePartialDates('x', '2020')).toThrow(RangeError);
    expect(() => comparePartialDates('2020', '2020-13')).toThrow(RangeError);
  });

  it('compareNullableDates deixa nulos e invalidos no fim', () => {
    const values: (string | null | undefined)[] = [null, '2021', 'x', '2019', undefined];
    expect([...values].sort(compareNullableDates)).toEqual(['2019', '2021', null, 'x', undefined]);
  });
});

describe('certeza de ordem com datas imprecisas', () => {
  it('isDefinitelyBefore/After consideram o intervalo inteiro', () => {
    expect(isDefinitelyBefore('2019', '2020-03')).toBe(true);
    expect(isDefinitelyBefore('2020', '2020-03')).toBe(false); // 2020 contem 2020-03
    expect(isDefinitelyBefore('2020-02', '2020-03')).toBe(true);
    expect(isDefinitelyBefore('2020-03-15', '2020-03-16')).toBe(true);
    expect(isDefinitelyBefore('2020-03-15', '2020-03-15')).toBe(false);
    expect(isDefinitelyAfter('2021', '2020-12')).toBe(true);
    expect(isDefinitelyAfter('2020', '2020-12')).toBe(false);
    expect(isDefinitelyBefore('x', '2020')).toBe(false);
  });

  it('datesMayOverlap', () => {
    expect(datesMayOverlap('2020', '2020-06')).toBe(true);
    expect(datesMayOverlap('2020-06', '2020-07')).toBe(false);
    expect(datesMayOverlap('2019', '2020')).toBe(false);
    expect(datesMayOverlap('bad', '2020')).toBe(false);
  });
});

describe('periodos', () => {
  it('validatePeriod: aceita nulos e present', () => {
    expect(validatePeriod({}).valid).toBe(true);
    expect(validatePeriod({ start: '2020', end: null }).valid).toBe(true);
    expect(validatePeriod({ start: '2020-03', end: 'present' }).valid).toBe(true);
    expect(validatePeriod({ start: null, end: '2020' }).valid).toBe(true);
  });

  it('validatePeriod: intervalo invertido, inicio e fim invalidos', () => {
    expect(validatePeriod({ start: '2021', end: '2019-05' }).issues[0]?.code).toBe(
      'END_BEFORE_START',
    );
    expect(validatePeriod({ start: 'x', end: '2019' }).issues[0]?.code).toBe('INVALID_START');
    expect(validatePeriod({ start: '2020', end: 'depois' }).issues[0]?.code).toBe('INVALID_END');
    expect(validatePeriod({ start: '2020', end: '2020' }).valid).toBe(true); // mesmo ano e ambiguo, nao invalido
    expect(validatePeriod({ start: '2020-05', end: '2020' }).valid).toBe(true);
    expect(validatePeriod({ start: 'present', end: null }).issues[0]?.code).toBe('INVALID_START');
  });

  it('isOngoing so vale para present', () => {
    expect(isOngoing({ start: '2020', end: 'present' })).toBe(true);
    expect(isOngoing({ start: '2020', end: null })).toBe(false);
    expect(isOngoing({ start: '2020', end: '2021' })).toBe(false);
  });

  it('comparePeriodsMostRecentFirst: atual primeiro, depois fim, depois inicio, sem datas por ultimo', () => {
    const periods = [
      { id: 'sem-datas' },
      { id: 'antigo', start: '2010', end: '2012' },
      { id: 'atual-recente', start: '2022', end: 'present' },
      { id: 'atual-antigo', start: '2015', end: 'present' },
      { id: 'meio', start: '2013', end: '2018-06' },
      { id: 'meio-mais-longo', start: '2012', end: '2018-06' },
    ];
    const sorted = [...periods].sort((a, b) => comparePeriodsMostRecentFirst(a, b));
    expect(sorted.map((p) => p.id)).toEqual([
      'atual-recente',
      'atual-antigo',
      'meio',
      'meio-mais-longo',
      'antigo',
      'sem-datas',
    ]);
  });

  it('periodDurationMonths respeita a imprecisao e nao inventa duracao', () => {
    expect(periodDurationMonths({ start: '2020-01', end: '2020-12' })).toEqual({
      min: 10,
      max: 12,
    });
    expect(periodDurationMonths({ start: '2020', end: '2021' })).toEqual({ min: 0, max: 24 });
    expect(periodDurationMonths({ start: '2020-01-01', end: '2021-01-01' })).toEqual({
      min: 12,
      max: 12,
    });
    expect(periodDurationMonths({ start: '2020-01', end: null })).toBeNull();
    expect(periodDurationMonths({ start: null, end: '2020' })).toBeNull();
    expect(periodDurationMonths({ start: 'x', end: '2020' })).toBeNull();
    const now = new Date(Date.UTC(2024, 0, 15));
    const open = periodDurationMonths({ start: '2023-01', end: 'present' }, now);
    expect(open?.min).toBeGreaterThanOrEqual(11);
    expect(open?.max).toBeLessThanOrEqual(13);
  });
});

describe('formatacao', () => {
  it('respeita a precisao e o idioma', () => {
    expect(formatPartialDate('2020')).toBe('2020');
    expect(formatPartialDate('2020-03')).toBe('março de 2020');
    expect(formatPartialDate('2020-03-05')).toBe('5 de março de 2020');
    expect(formatPartialDate('2020-03', { locale: 'en-US' })).toBe('March 2020');
    expect(formatPartialDate('2020-03', { style: 'iso' })).toBe('2020-03');
    expect(formatPartialDate('2020-03', { style: 'short' }).length).toBeGreaterThan(0);
    expect(() => formatPartialDate('2020-13')).toThrow(RangeError);
  });

  it('formatPeriod usa o rotulo de "atual" do idioma', () => {
    expect(formatPeriod({ start: '2020', end: 'present' })).toBe('2020 - atual');
    expect(formatPeriod({ start: '2020', end: 'present' }, { locale: 'en-US' })).toBe(
      '2020 - present',
    );
    expect(formatPeriod({ start: '2020', end: 'present' }, { presentLabel: 'hoje' })).toBe(
      '2020 - hoje',
    );
    expect(formatPeriod({ start: '2019', end: '2021-06' })).toBe('2019 - junho de 2021');
    expect(formatPeriod({ start: '2019' })).toBe('2019 -');
    expect(formatPeriod({ end: '2019' })).toBe('- 2019');
    expect(formatPeriod({})).toBe('');
  });

  it('toPartialDate formata hoje em UTC no nivel pedido', () => {
    const date = new Date(Date.UTC(2024, 4, 9, 23, 30));
    expect(toPartialDate(date)).toBe('2024-05-09');
    expect(toPartialDate(date, 'month')).toBe('2024-05');
    expect(toPartialDate(date, 'year')).toBe('2024');
  });
});
