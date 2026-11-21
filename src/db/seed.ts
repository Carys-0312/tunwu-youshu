import type { TableName } from '@/types/models';
import type { Row } from './driver';
import { addDays, todayISO } from '@/utils/date';

/**
 * 第 1 步的假数据：覆盖正常、临期、已过期、低库存、开封五种状态，
 * 让管家页和库存页一打开就有东西可看。日期相对「今天」生成。
 */
export function buildSeedRows(): Record<TableName, Row[]> {
  const today = todayISO();
  const now = `${today} 09:00:00`;

  const locations: Row[] = [
    { id: 'loc-desk', name: '书桌柜', parent_id: null, sort: 1 },
    { id: 'loc-bed', name: '床下箱', parent_id: null, sort: 2 },
    { id: 'loc-fridge', name: '冰箱', parent_id: null, sort: 3 },
    { id: 'loc-freezer', name: '冷冻室', parent_id: 'loc-fridge', sort: 5 },
    { id: 'loc-med', name: '药箱', parent_id: null, sort: 4 },
  ];

  const items: Row[] = [
    {
      id: 'item-milk',
      name: '蒙牛纯牛奶 250ml',
      category: '饮品',
      image: null,
      location_id: 'loc-fridge',
      unit: '盒',
      quantity: 6,
      threshold: 3,
      storage_text: '冷藏 2-6℃',
      calories: 150,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-juice',
      name: '农夫山泉 NFC 橙汁 300ml',
      category: '饮品',
      image: null,
      location_id: 'loc-fridge',
      unit: '瓶',
      quantity: 2,
      threshold: 1,
      storage_text: '冷藏 2-6℃',
      calories: 135,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-apple',
      name: '红富士苹果',
      category: '水果',
      image: null,
      location_id: 'loc-fridge',
      unit: '个',
      quantity: 3,
      threshold: 2,
      storage_text: '冷藏 0-4℃',
      calories: 95,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-dumpling',
      name: '三全速冻水饺 500g',
      category: '冷冻',
      image: null,
      location_id: 'loc-freezer',
      unit: '袋',
      quantity: 1,
      threshold: 1,
      storage_text: '冷冻 -18℃',
      calories: 550,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-amox',
      name: '阿莫西林胶囊',
      category: '药品',
      image: null,
      location_id: 'loc-med',
      unit: '盒',
      quantity: 2,
      threshold: 1,
      storage_text: '密封，阴凉干燥处',
      calories: null,
      is_shared: 1,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-vc',
      name: '维C泡腾片',
      category: '药品',
      image: null,
      location_id: 'loc-med',
      unit: '瓶',
      quantity: 1,
      threshold: 1,
      storage_text: '密封，避光干燥处',
      calories: null,
      is_shared: 1,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-tissue',
      name: '抽纸',
      category: '日用品',
      image: null,
      location_id: 'loc-bed',
      unit: '包',
      quantity: 3,
      threshold: 5,
      storage_text: '常温干燥处',
      calories: null,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-detergent',
      name: '洗衣液 1kg',
      category: '日用品',
      image: null,
      location_id: 'loc-bed',
      unit: '瓶',
      quantity: 1,
      threshold: 1,
      storage_text: '常温避光',
      calories: null,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-chips',
      name: '乐事薯片',
      category: '食品',
      image: null,
      location_id: 'loc-desk',
      unit: '包',
      quantity: 2,
      threshold: 1,
      storage_text: '常温阴凉处',
      calories: 150,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-mask',
      name: '医用外科口罩',
      category: '日用品',
      image: null,
      location_id: 'loc-desk',
      unit: '包',
      quantity: 40,
      threshold: 10,
      storage_text: '干燥通风处',
      calories: null,
      is_shared: 1,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-soy',
      name: '海天生抽 500ml',
      category: '调味',
      image: null,
      location_id: 'loc-desk',
      unit: '瓶',
      quantity: 1,
      threshold: 1,
      storage_text: '开封后冷藏',
      calories: 65,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-coffee',
      name: '隅田川挂耳咖啡',
      category: '饮品',
      image: null,
      location_id: 'loc-desk',
      unit: '包',
      quantity: 8,
      threshold: 3,
      storage_text: '常温干燥处',
      calories: 5,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
    {
      id: 'item-egg',
      name: '鲜鸡蛋',
      category: '食品',
      image: null,
      location_id: 'loc-fridge',
      unit: '个',
      quantity: 10,
      threshold: 6,
      storage_text: '冷藏 0-4℃',
      calories: 70,
      is_shared: 0,
      status: 'active',
      created_at: now,
    },
  ];

  const batches: Row[] = [
    { id: 'b-milk-1', item_id: 'item-milk', production_date: addDays(-20), expiry_date: addDays(5), opened_at: null, pao_months: null, quantity: 6 },
    { id: 'b-juice-1', item_id: 'item-juice', production_date: addDays(-10), expiry_date: addDays(20), opened_at: null, pao_months: null, quantity: 2 },
    { id: 'b-apple-1', item_id: 'item-apple', production_date: null, expiry_date: addDays(14), opened_at: null, pao_months: null, quantity: 3 },
    { id: 'b-dumpling-1', item_id: 'item-dumpling', production_date: addDays(-30), expiry_date: addDays(120), opened_at: null, pao_months: null, quantity: 1 },
    { id: 'b-amox-1', item_id: 'item-amox', production_date: addDays(-200), expiry_date: addDays(45), opened_at: null, pao_months: null, quantity: 2 },
    { id: 'b-vc-1', item_id: 'item-vc', production_date: addDays(-400), expiry_date: addDays(-12), opened_at: null, pao_months: null, quantity: 1 },
    { id: 'b-tissue-1', item_id: 'item-tissue', production_date: null, expiry_date: null, opened_at: null, pao_months: null, quantity: 3 },
    { id: 'b-chips-1', item_id: 'item-chips', production_date: addDays(-30), expiry_date: addDays(60), opened_at: null, pao_months: null, quantity: 2 },
    { id: 'b-mask-1', item_id: 'item-mask', production_date: null, expiry_date: null, opened_at: null, pao_months: null, quantity: 40 },
    { id: 'b-soy-1', item_id: 'item-soy', production_date: null, expiry_date: null, opened_at: addDays(-60), pao_months: 6, quantity: 1 },
    { id: 'b-det-1', item_id: 'item-detergent', production_date: null, expiry_date: null, opened_at: addDays(-15), pao_months: 12, quantity: 1 },
    { id: 'b-coffee-1', item_id: 'item-coffee', production_date: addDays(-45), expiry_date: addDays(180), opened_at: null, pao_months: null, quantity: 8 },
    { id: 'b-egg-1', item_id: 'item-egg', production_date: null, expiry_date: addDays(12), opened_at: null, pao_months: null, quantity: 10 },
  ];

  /**
   * 演示用流水：最近两个多月的真实使用节奏，数量按「每隔几天用一次」来设计，
   * 月报的日历、折线、最常用、补货时机才有东西可看。
   * 负数 delta 是补货（source=manual）或扔掉（source=discard）。
   */
  const consumption: Row[] = [];
  const pushUse = (batchId: string, daysAgo: number, delta = 1, hour = 9, source = 'manual') => {
    consumption.push({
      id: `demo-${consumption.length + 1}`,
      batch_id: batchId,
      delta,
      source,
      created_at: `${addDays(-daysAgo)} ${String(hour).padStart(2, '0')}:00:00`,
    });
  };
  const useOn = (batchId: string, daysList: number[], delta = 1, hour = 9) => {
    for (const daysAgo of daysList) pushUse(batchId, daysAgo, delta, hour);
  };

  // 几乎天天用的
  useOn('b-coffee-1', [1, 2, 3, 5, 6, 8, 9, 11, 13, 15, 17, 19, 21, 23, 26, 28, 31, 34, 37, 40, 43, 46, 50, 54, 58, 62, 66]);
  useOn('b-tissue-1', [1, 3, 5, 7, 9, 12, 14, 16, 18, 20, 23, 25, 28, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69]);
  useOn('b-milk-1', [1, 2, 4, 6, 8, 10, 12, 14, 16, 19, 21, 24, 27, 30, 33, 36, 39, 43, 47, 51, 55, 59, 63, 67]);
  // 隔几天一次的
  useOn('b-egg-1', [2, 4, 7, 10, 13, 16, 20, 24, 28, 32, 36, 41, 46, 51, 56, 61, 66], 2, 8);
  useOn('b-apple-1', [3, 6, 10, 15, 21, 27, 34, 41, 48, 55, 62]);
  useOn('b-chips-1', [4, 11, 18, 25, 33, 42, 51, 60], 1, 16);
  useOn('b-juice-1', [7, 16, 26, 37, 47, 57]);
  useOn('b-dumpling-1', [9, 23, 38, 52, 65]);
  useOn('b-soy-1', [5, 19, 34, 50, 65]);
  useOn('b-det-1', [12, 40, 68]);
  useOn('b-vc-1', [20]);
  useOn('b-amox-1', [30]);
  // 很久没动过，给「一直没动」留一条
  useOn('b-mask-1', [80]);

  // 补货：数量和周期对得上，月报的「下次补货」才有依据
  pushUse('b-tissue-1', 68, -6, 20);
  pushUse('b-tissue-1', 44, -6, 20);
  pushUse('b-milk-1', 60, -12, 18);
  pushUse('b-milk-1', 35, -12, 18);
  pushUse('b-milk-1', 9, -12, 18);
  pushUse('b-coffee-1', 45, -3, 19);
  pushUse('b-coffee-1', 12, -3, 19);
  pushUse('b-egg-1', 30, -10, 18);
  pushUse('b-juice-1', 40, -4, 18);
  pushUse('b-chips-1', 30, -3, 18);
  pushUse('b-det-1', 66, -1, 20);
  pushUse('b-mask-1', 90, -20, 18);
  // 本月初补过一板鸡蛋，月报的「买进」不是 0
  pushUse('b-egg-1', 2, -10, 18);

  // 扔掉：过期维C和坏掉的苹果，月报会单独算「扔掉」
  pushUse('b-vc-1', 3, -1, 11, 'discard');
  pushUse('b-apple-1', 8, -1, 11, 'discard');

  const shopping: Row[] = [
    { id: 's-tissue', item_id: 'item-tissue', name: '抽纸', qty: 2, section: '日用', status: 'pending' },
    { id: 's-detergent', item_id: 'item-detergent', name: '洗衣液', qty: 1, section: '日用', status: 'pending' },
    { id: 's-battery', item_id: null, name: '5 号电池', qty: 4, section: '数码', status: 'pending' },
    { id: 's-mask', item_id: 'item-mask', name: '口罩', qty: 1, section: '日用', status: 'done' },
  ];

  const reminders: Row[] = [
    { id: 'r-milk', type: 'expiry', target_id: 'b-milk-1', fire_at: `${addDays(5)} 09:00:00`, channel: 'local', status: 'pending' },
    { id: 'r-vc', type: 'expiry', target_id: 'b-vc-1', fire_at: `${addDays(-9)} 09:00:00`, channel: 'local', status: 'dismissed' },
  ];

  const alias: Row[] = [
    { id: 'a-1', raw_text: '牛奶', item_id: 'item-milk', count: 3 },
    { id: 'a-2', raw_text: '纸巾', item_id: 'item-tissue', count: 1 },
  ];

  const meta: Row[] = [
    { key: 'schema_version', value: '1' },
    { key: 'seeded_at', value: now },
  ];

  return {
    location: locations,
    item: items,
    batch: batches,
    consumption,
    shopping_item: shopping,
    reminder: reminders,
    alias,
    schema_meta: meta,
  };
}
