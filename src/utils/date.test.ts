import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  daysFromToday,
  describeDays,
  expiryFromShelfLife,
  formatDate,
} from './date';

describe('formatDate', () => {
  it('补零到 YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDate(new Date(2026, 10, 22))).toBe('2026-11-22');
  });
});

describe('addDays', () => {
  it('跨月、跨年', () => {
    expect(addDays(1, new Date(2026, 0, 31))).toBe('2026-02-01');
    expect(addDays(1, new Date(2026, 11, 31))).toBe('2027-01-01');
    expect(addDays(-1, new Date(2026, 2, 1))).toBe('2026-02-28');
  });
});

describe('addMonths', () => {
  it('月末自动收敛', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-08-01', 18)).toBe('2028-02-01');
  });
});

describe('expiryFromShelfLife', () => {
  it('识别月、年、天', () => {
    expect(expiryFromShelfLife('2026-08-01', '保质期6个月')).toBe('2027-02-01');
    expect(expiryFromShelfLife('2026-08-01', '2年')).toBe('2028-08-01');
    expect(expiryFromShelfLife('2026-08-01', '180天')).toBe('2027-01-28');
  });

  it('缺少生产日期或认不出时返回 null', () => {
    expect(expiryFromShelfLife('', '6个月')).toBeNull();
    expect(expiryFromShelfLife('2026-08-01', '')).toBeNull();
    expect(expiryFromShelfLife('2026-08-01', '见包装')).toBeNull();
  });

  it('完整日期不当成保质期', () => {
    expect(expiryFromShelfLife('2026-08-01', '生产日期 2026年8月1日')).toBeNull();
  });
});

describe('daysBetween / daysFromToday', () => {
  it('计算日期差', () => {
    expect(daysBetween('2026-11-20', '2026-11-22')).toBe(2);
    expect(daysBetween('2026-11-22', '2026-11-20')).toBe(-2);
    expect(daysFromToday('2026-11-25', '2026-11-22')).toBe(3);
    expect(daysFromToday('2026-11-20', '2026-11-22')).toBe(-2);
  });
});

describe('describeDays', () => {
  it('到期文案', () => {
    expect(describeDays(0)).toBe('今天到期');
    expect(describeDays(5)).toBe('5 天后');
    expect(describeDays(-2)).toBe('已过期 2 天');
  });
});
