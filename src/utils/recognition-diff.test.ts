import { describe, expect, it } from 'vitest';
import { correctionFlags, type FinalRecognitionValues } from './recognition-diff';
import type { RecognizedItem } from '@/services/recognize';

function original(overrides: Partial<RecognizedItem> = {}): RecognizedItem {
  return {
    name: '伊利纯牛奶 250ml',
    category: '饮品',
    quantity: 12,
    unit: '盒',
    production_date: '2026-08-01',
    expiry_date: '2027-02-01',
    shelf_life_text: '6个月',
    storage_text: '冷藏 2-6℃',
    date_note: null,
    calories: 163,
    category_guess: '饮品',
    category_known: true,
    category_reason: '牛奶属于饮品',
    confidence: { name: 0.9, category: 0.9, dates: 0.8, storage: 0.8 },
    ...overrides,
  };
}

function finalOf(overrides: Partial<FinalRecognitionValues> = {}): FinalRecognitionValues {
  return {
    name: '伊利纯牛奶 250ml',
    category: '饮品',
    quantity: 12,
    production_date: '2026-08-01',
    expiry_date: '2027-02-01',
    storage_text: '冷藏 2-6℃',
    ...overrides,
  };
}

describe('correctionFlags', () => {
  it('完全一致时所有字段都不算纠正', () => {
    expect(correctionFlags(original(), finalOf())).toEqual({
      name: false,
      category: false,
      dates: false,
      storage: false,
      quantity: false,
    });
  });

  it('空白差异不算纠正', () => {
    expect(correctionFlags(
      original({ name: ' 伊利纯牛奶 250ml ', storage_text: null }),
      finalOf({ name: '伊利纯牛奶 250ml', storage_text: '' }),
    ).name).toBe(false);
  });

  it('名称、分类、储存、数量分别标记', () => {
    const flags = correctionFlags(original(), finalOf({
      name: '蒙牛纯牛奶 250ml',
      category: '食品',
      storage_text: '常温',
      quantity: 6,
    }));
    expect(flags).toEqual({
      name: true,
      category: true,
      dates: false,
      storage: true,
      quantity: true,
    });
  });

  it('生产日期或到期日任一变化都算日期纠正', () => {
    expect(correctionFlags(original(), finalOf({ production_date: '2026-08-02' })).dates).toBe(true);
    expect(correctionFlags(original(), finalOf({ expiry_date: '2027-02-02' })).dates).toBe(true);
  });
});
