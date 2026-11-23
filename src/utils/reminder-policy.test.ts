import { describe, expect, it } from 'vitest';
import {
  batchShelfLifeDays,
  recommendedLeadDays,
  shelfLifeDays,
} from './reminder-policy';

describe('shelfLifeDays', () => {
  it('用生产日期和到期日计算总保质期', () => {
    expect(shelfLifeDays('2026-01-01', '2026-01-31')).toBe(30);
  });

  it('日期缺失或倒挂时返回 null', () => {
    expect(shelfLifeDays(null, '2026-01-31')).toBeNull();
    expect(shelfLifeDays('2026-01-01', null)).toBeNull();
    expect(shelfLifeDays('2026-01-31', '2026-01-01')).toBeNull();
  });
});

describe('batchShelfLifeDays', () => {
  it('优先使用包装日期', () => {
    expect(batchShelfLifeDays({
      production_date: '2026-01-01',
      expiry_date: '2026-01-31',
      opened_at: null,
      pao_months: 6,
    })).toBe(30);
  });

  it('没有包装到期日时用开封后保质期兜底', () => {
    expect(batchShelfLifeDays({
      production_date: null,
      expiry_date: null,
      opened_at: '2026-11-01',
      pao_months: 1,
    })).toBe(30);
  });

  it('按天的开封后保质期优先于按月', () => {
    expect(batchShelfLifeDays({
      production_date: null,
      expiry_date: null,
      opened_at: '2026-11-20',
      pao_months: 1,
      pao_days: 3,
    })).toBe(3);
  });

  it('按天为 0 时退回按月计算', () => {
    expect(batchShelfLifeDays({
      production_date: null,
      expiry_date: null,
      opened_at: '2026-11-01',
      pao_months: 1,
      pao_days: 0,
    })).toBe(30);
  });

  it('没有任何依据时返回 null', () => {
    expect(batchShelfLifeDays({
      production_date: null,
      expiry_date: null,
      opened_at: '2026-11-01',
      pao_months: null,
    })).toBeNull();
  });
});

describe('recommendedLeadDays', () => {
  it('按保质期长度分档', () => {
    expect(recommendedLeadDays(1)).toBe(1);
    expect(recommendedLeadDays(7)).toBe(1);
    expect(recommendedLeadDays(8)).toBe(3);
    expect(recommendedLeadDays(30)).toBe(3);
    expect(recommendedLeadDays(31)).toBe(7);
    expect(recommendedLeadDays(90)).toBe(7);
    expect(recommendedLeadDays(91)).toBe(15);
    expect(recommendedLeadDays(180)).toBe(15);
    expect(recommendedLeadDays(181)).toBe(30);
  });

  it('无效输入返回 null', () => {
    expect(recommendedLeadDays(null)).toBeNull();
    expect(recommendedLeadDays(0)).toBeNull();
    expect(recommendedLeadDays(-1)).toBeNull();
    expect(recommendedLeadDays(Number.NaN)).toBeNull();
  });
});
