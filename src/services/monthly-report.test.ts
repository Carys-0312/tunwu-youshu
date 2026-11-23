import { describe, expect, it } from 'vitest';
import type { Batch, Consumption, Item } from '@/types/models';
import { filterReportSource, type ReportSource } from './monthly-report';

function item(id: string, category: string, name = id, storage: string | null = null): Item {
  return {
    id,
    name,
    category,
    image: null,
    location_id: null,
    unit: '件',
    quantity: 1,
    threshold: 0,
    storage_text: storage,
    calories: null,
    is_shared: 0,
    status: 'active',
    created_at: '2026-11-01 10:00:00',
  };
}

function batch(id: string, itemId: string): Batch {
  return {
    id,
    item_id: itemId,
    production_date: null,
    expiry_date: null,
    opened_at: null,
    pao_months: null,
    pao_days: null,
    quantity: 1,
  };
}

function consumption(id: string, batchId: string): Consumption {
  return {
    id,
    batch_id: batchId,
    delta: 1,
    source: 'manual',
    created_at: '2026-11-10 12:00:00',
  };
}

function source(): ReportSource {
  return {
    items: [item('milk', '饮品'), item('apple', '水果'), item('frozen-food', '食品', '速冻饺子', '冷冻 -18℃')],
    batches: [batch('b-milk', 'milk'), batch('b-apple', 'apple'), batch('b-frozen', 'frozen-food')],
    consumptions: [
      consumption('c-milk', 'b-milk'),
      consumption('c-apple', 'b-apple'),
      consumption('c-frozen', 'b-frozen'),
    ],
  };
}

describe('filterReportSource', () => {
  it('「全部」原样返回', () => {
    const data = source();
    expect(filterReportSource(data, '全部')).toBe(data);
    expect(filterReportSource(data, '')).toBe(data);
  });

  it('按品类收窄物品、批次和消耗流水', () => {
    const result = filterReportSource(source(), '饮品');
    expect(result.items.map((row) => row.id)).toEqual(['milk']);
    expect(result.batches.map((row) => row.id)).toEqual(['b-milk']);
    expect(result.consumptions.map((row) => row.id)).toEqual(['c-milk']);
  });

  it('兼容早期「食品 + 冷冻储存」归类到冷冻', () => {
    const result = filterReportSource(source(), '冷冻');
    expect(result.items.map((row) => row.id)).toEqual(['frozen-food']);
    expect(result.consumptions.map((row) => row.id)).toEqual(['c-frozen']);
  });

  it('没有该品类时返回空数组', () => {
    const result = filterReportSource(source(), '药品');
    expect(result.items).toEqual([]);
    expect(result.batches).toEqual([]);
    expect(result.consumptions).toEqual([]);
  });
});
