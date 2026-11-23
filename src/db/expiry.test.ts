import { describe, expect, it } from 'vitest';
import type { Batch } from '@/types/models';
import { effectiveExpiry } from './repo';

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 'b1',
    item_id: 'i1',
    production_date: null,
    expiry_date: null,
    opened_at: null,
    pao_months: null,
    pao_days: null,
    quantity: 1,
    ...overrides,
  };
}

describe('effectiveExpiry', () => {
  it('只有印刷到期日时直接用它', () => {
    expect(effectiveExpiry(batch({ expiry_date: '2027-01-01' }))).toBe('2027-01-01');
  });

  it('开封后按天：取开封后 3 天', () => {
    expect(
      effectiveExpiry(batch({ opened_at: '2026-11-20 08:00:00', pao_days: 3 })),
    ).toBe('2026-11-23');
  });

  it('开封后按月：兼容旧数据', () => {
    expect(
      effectiveExpiry(batch({ opened_at: '2026-11-01 08:00:00', pao_months: 1 })),
    ).toBe('2026-12-01');
  });

  it('同时存在时优先按天', () => {
    expect(
      effectiveExpiry(batch({ opened_at: '2026-11-01', pao_days: 3, pao_months: 12 })),
    ).toBe('2026-11-04');
  });

  it('印刷到期日更早时保留印刷日期', () => {
    expect(
      effectiveExpiry(batch({ expiry_date: '2026-11-22', opened_at: '2026-11-20', pao_days: 7 })),
    ).toBe('2026-11-22');
  });

  it('开封后到期日更早时提前到开封后', () => {
    expect(
      effectiveExpiry(batch({ expiry_date: '2027-01-01', opened_at: '2026-11-20', pao_days: 3 })),
    ).toBe('2026-11-23');
  });

  it('没有任何日期时返回 null', () => {
    expect(effectiveExpiry(batch())).toBeNull();
  });
});
