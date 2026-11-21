import type {
  Alias,
  Batch,
  Consumption,
  DashboardData,
  InventoryRow,
  Item,
  Location,
  Reminder,
  ShoppingItem,
  TableName,
} from '@/types/models';
import { createDriver, type DbDriver, type Row } from './driver';
import { isDemoSnapshot, stripDemoRows } from './demo';
import { TABLES } from './schema';
import { addDays, addMonths, daysFromToday, nowStamp } from '@/utils/date';
import { batchShelfLifeDays } from '@/utils/reminder-policy';
import { displayCategory } from '@/constants/categories';

let driver: DbDriver | null = null;

function db(): DbDriver {
  if (!driver) throw new Error('数据库尚未初始化，请先调用 initDatabase()');
  return driver;
}

/**
 * 老版本第一次启动会灌入演示数据；现在游客从空库存开始。
 * 这里只清理「原封不动的演示数据」：用户加过、改过任何东西就不再判定为演示数据，
 * 避免误删游客自己录入的真实内容。
 */
const REMOVED_DEMO_MIGRATION = 'removed_demo_data_v1';

async function removeLegacyDemoData(target: DbDriver): Promise<void> {
  const meta = await target.getAll<{ key: string }>('schema_meta');
  if (meta.some((row) => row.key === REMOVED_DEMO_MIGRATION)) return;

  if (isDemoSnapshot(await readAllTables(target))) {
    for (const table of TABLES) {
      if (table !== 'schema_meta') await target.clear(table);
    }
  }
  await target.putMany('schema_meta', [{ key: REMOVED_DEMO_MIGRATION, value: nowStamp() }]);
}

/**
 * 分类拆分前入库的老数据不会重新走 seed，这里补一次迁移：
 * 演示牛奶、以及名称/单位能明确判断为饮品的条目从「食品」改到「饮品」。
 */
const CATEGORY_SPLIT_MIGRATION = 'migrated_category_split_v1';
const BEVERAGE_NAME = /(纯牛奶|牛奶|酸奶|乳饮料|果汁|橙汁|咖啡|奶茶|汽水|可乐|饮用水|矿泉水|纯净水|苏打水|气泡水|茶饮料|能量饮料)/;
const SOLID_FOOD_NAME = /(巧克力|饼干|糖果|奶糖|蛋糕|面包|派|酥|雪糕|冰淇淋|冰棍|麦片|燕麦|奶粉)/;
const BEVERAGE_UNITS = new Set(['盒', '瓶', '杯', '罐', '听', '支', '箱', '提', '件']);

async function migrateStoredData(target: DbDriver): Promise<void> {
  const meta = await target.getAll<{ key: string; value: string }>('schema_meta');
  if (meta.some((row) => row.key === CATEGORY_SPLIT_MIGRATION)) return;

  const items = await target.getAll<Item>('item');
  const changed = items.filter((item) => {
    if (item.category !== '食品') return false;
    if (item.id === 'item-milk') return true;
    const name = item.name || '';
    return BEVERAGE_UNITS.has(item.unit) && BEVERAGE_NAME.test(name) && !SOLID_FOOD_NAME.test(name);
  });

  if (changed.length) {
    await target.putMany('item', changed.map((item) => ({ ...item, category: '饮品' })));

    const ids = new Set(changed.map((item) => item.id));
    const shopping = await target.getAll<ShoppingItem>('shopping_item');
    const shoppingChanged = shopping
      .filter((row) => row.item_id && ids.has(row.item_id) && row.section !== '饮品')
      .map((row) => ({ ...row, section: '饮品' }));
    if (shoppingChanged.length) await target.putMany('shopping_item', shoppingChanged);
  }

  await target.putMany('schema_meta', [{ key: CATEGORY_SPLIT_MIGRATION, value: nowStamp() }]);
}

/**
 * 早期「冷冻」只是库存页的派生分组，数据库里存的是食品。
 * 现在冷冻是正式分类，把储存说明明确写了冷冻的老条目迁到 category=冷冻。
 */
const FROZEN_CATEGORY_MIGRATION = 'migrated_frozen_category_v1';

async function migrateFrozenCategory(target: DbDriver): Promise<void> {
  const meta = await target.getAll<{ key: string; value: string }>('schema_meta');
  if (meta.some((row) => row.key === FROZEN_CATEGORY_MIGRATION)) return;

  const items = await target.getAll<Item>('item');
  const changed = items.filter(
    (item) => item.category !== '冷冻' && displayCategory(item) === '冷冻',
  );

  if (changed.length) {
    await target.putMany('item', changed.map((item) => ({ ...item, category: '冷冻' })));

    const ids = new Set(changed.map((item) => item.id));
    const shopping = await target.getAll<ShoppingItem>('shopping_item');
    const shoppingChanged = shopping
      .filter((row) => row.item_id && ids.has(row.item_id) && row.section !== '冷冻')
      .map((row) => ({ ...row, section: '冷冻' }));
    if (shoppingChanged.length) await target.putMany('shopping_item', shoppingChanged);
  }

  await target.putMany('schema_meta', [{ key: FROZEN_CATEGORY_MIGRATION, value: nowStamp() }]);
}

/**
 * 早期入库时只有填了日期才建批次，没填日期的物品没有批次，
 * 于是「用掉 1」只扣数量、不写消耗流水，月报日历也就看不到它。
 * 这里给所有缺批次的物品补一个空日期批次，让每次消耗都能落到批次上。
 */
const ITEM_BATCH_MIGRATION = 'migrated_item_batch_v1';

/** 给缺批次的物品补一个空日期批次；同步、恢复备份后也会调用 */
async function ensureItemBatches(target: DbDriver): Promise<void> {
  const [items, batches] = await Promise.all([
    target.getAll<Item>('item'),
    target.getAll<Batch>('batch'),
  ]);
  const itemsWithBatch = new Set(batches.map((batch) => batch.item_id));
  const missing = items.filter((item) => !itemsWithBatch.has(item.id));

  if (missing.length) {
    const rows: Batch[] = missing.map((item) => ({
      id: makeId('batch'),
      item_id: item.id,
      production_date: null,
      expiry_date: null,
      opened_at: null,
      pao_months: null,
      quantity: item.quantity,
    }));
    await target.putMany('batch', rows.map((row) => ({ ...row })));
  }
}

async function migrateItemBatch(target: DbDriver): Promise<void> {
  const meta = await target.getAll<{ key: string; value: string }>('schema_meta');
  if (meta.some((row) => row.key === ITEM_BATCH_MIGRATION)) return;

  await ensureItemBatches(target);
  await target.putMany('schema_meta', [{ key: ITEM_BATCH_MIGRATION, value: nowStamp() }]);
}

/** 应用启动时调用一次：建表 → 清理老的演示数据 → 老数据迁移 */
export async function initDatabase(): Promise<void> {
  if (driver) return;
  const next = createDriver();
  await next.init();
  await removeLegacyDemoData(next);
  await migrateStoredData(next);
  await migrateFrozenCategory(next);
  await migrateItemBatch(next);
  driver = next;
}

/**
 * 登录后把本机残留的演示数据剔掉（包括和真实数据混在一起的情况），返回删改行数。
 * 用户自己录入的物品、批次、流水、待购不受影响。
 */
export async function removeDemoRows(): Promise<number> {
  const target = db();
  const before = await readAllTables(target);
  const result = stripDemoRows(before);
  if (!result.changed) return 0;

  for (const table of TABLES) {
    const oldRows = (before[table] ?? []) as Record<string, unknown>[];
    const newRows = (result.data[table] ?? []) as Record<string, unknown>[];
    // 没变的表保持原样，别整表重写
    if (oldRows.length === newRows.length && oldRows.every((row, index) => row === newRows[index])) {
      continue;
    }
    await target.clear(table);
    if (newRows.length) await target.putMany(table, newRows as Row[]);
  }
  return result.changedRows;
}

/** 备份用：把所有表原样读出来 */
export async function readAllTables(
  target: DbDriver = db(),
): Promise<Partial<Record<TableName, Record<string, unknown>[]>>> {
  const out: Partial<Record<TableName, Record<string, unknown>[]>> = {};
  for (const table of TABLES) {
    out[table] = await target.getAll<Record<string, unknown>>(table);
  }
  return out;
}

/** 切换账号 / 从空库存开始时使用：清空本机全部业务表（含 schema_meta） */
export async function clearAllTables(): Promise<void> {
  const target = db();
  for (const table of TABLES) {
    await target.clear(table);
  }
}

/** 恢复用：先清空所有表，再按备份内容整表写回 */
export async function replaceAllTables(
  data: Partial<Record<TableName, Record<string, unknown>[]>>,
): Promise<void> {
  const target = db();
  for (const table of TABLES) {
    await target.clear(table);
    const rows = data[table];
    if (Array.isArray(rows) && rows.length) {
      await target.putMany(table, rows);
    }
  }
  // 旧备份/旧同步快照里可能还有没批次的物品，恢复后补上
  await ensureItemBatches(target);
}

/**
 * 批次的实际到期日：印刷到期日和「开封日 + 开封后保质期」取更早的那个。
 *
 * 开封后的期限通常比印刷日期短（牛奶开封后 3 天、面霜开封后 6 个月），
 * 所以 PAO 必须能把实际到期日提前；只有它更晚时才继续用印刷日期。
 */
export function effectiveExpiry(batch: Batch): string | null {
  const printed = batch.expiry_date || null;
  const opened =
    batch.opened_at && batch.pao_months
      ? addMonths(batch.opened_at.slice(0, 10), batch.pao_months)
      : null;

  if (printed && opened) return printed < opened ? printed : opened;
  return printed ?? opened;
}

export async function loadInventory(): Promise<InventoryRow[]> {
  const target = db();
  const [items, batches, locations] = await Promise.all([
    target.getAll<Item>('item'),
    target.getAll<Batch>('batch'),
    target.getAll<Location>('location'),
  ]);

  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const nearest = new Map<string, Batch>();
  for (const batch of batches) {
    const expiry = effectiveExpiry(batch);
    if (!expiry) continue;
    const current = nearest.get(batch.item_id);
    if (!current || expiry < (effectiveExpiry(current) as string)) {
      nearest.set(batch.item_id, batch);
    }
  }

  return items
    .map<InventoryRow>((item) => {
      // 数量为 0（已经用完）时不再参与临期判断，避免已用完的东西还弹过期提醒
      const batch = item.quantity > 0 ? nearest.get(item.id) : undefined;
      const expiryDate = batch ? effectiveExpiry(batch) : null;
      return {
        item,
        locationName: (item.location_id && locationName.get(item.location_id)) || '未归类',
        expiryDate,
        daysLeft: expiryDate ? daysFromToday(expiryDate) : null,
        shelfLifeDays: batch ? batchShelfLifeDays(batch) : null,
        isLowStock: item.threshold > 0 && item.quantity <= item.threshold,
      };
    })
    .sort((a, b) => {
      const av = a.daysLeft ?? Number.MAX_SAFE_INTEGER;
      const bv = b.daysLeft ?? Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      return a.item.name.localeCompare(b.item.name, 'zh-Hans-CN');
    });
}

export async function loadDashboard(rows?: InventoryRow[]): Promise<DashboardData> {
  const inventory = rows ?? (await loadInventory());
  const shopping = await db().getAll<ShoppingItem>('shopping_item');

  let totalUnits = 0;
  let expiringSoon = 0;
  let expired = 0;
  let lowStock = 0;

  for (const row of inventory) {
    totalUnits += row.item.quantity;
    if (row.daysLeft !== null) {
      if (row.daysLeft < 0) expired += 1;
      else if (row.daysLeft <= 7) expiringSoon += 1;
    }
    if (row.isLowStock) lowStock += 1;
  }

  return {
    totalItems: inventory.length,
    totalUnits,
    expiringSoon,
    expired,
    lowStock,
    shoppingPending: shopping.filter((s) => s.status === 'pending').length,
  };
}

export async function loadShopping(): Promise<ShoppingItem[]> {
  const all = await db().getAll<ShoppingItem>('shopping_item');
  const order = { pending: 0, done: 1 } as const;
  return all.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function setShoppingStatus(id: string, status: ShoppingItem['status']): Promise<void> {
  const all = await db().getAll<ShoppingItem>('shopping_item');
  const row = all.find((s) => s.id === id);
  if (!row) return;
  await db().putMany('shopping_item', [{ ...row, status }]);
}

/**
 * 回库记账存在 schema_meta 里（key = shopping_restock:<待购 id>），
 * 表结构不用改；撤销「买好」时按这条记录把库存和流水还原。
 */
const RESTOCK_META_PREFIX = 'shopping_restock:';

interface RestockRecord {
  itemId: string;
  qty: number;
  batchId: string;
  consumptionId: string;
}

export interface BuyShoppingResult {
  /** 是否真的回库了（手动条目、或用户选了只标记，都是 false） */
  restocked: boolean;
  qty: number;
  /** 回库后的库存件数；没回库为 null */
  stockAfter: number | null;
  unit: string | null;
}

/**
 * 勾选「买好」：选择回库时数量加回库存，建一个无日期批次并记一条负数流水（补货），
 * 同时把这次回库记进 schema_meta，供「撤销买好」还原。
 */
export async function buyShoppingItem(id: string, restock: boolean): Promise<BuyShoppingResult> {
  const target = db();
  const rows = await target.getAll<ShoppingItem>('shopping_item');
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error('找不到待购条目');

  const qty = Math.max(1, Math.trunc(row.qty));
  let restocked = false;
  let stockAfter: number | null = null;
  let unit: string | null = null;

  if (restock && row.item_id) {
    const items = await target.getAll<Item>('item');
    const item = items.find((entry) => entry.id === row.item_id);
    if (item) {
      const batchId = makeId('batch');
      const consumptionId = makeId('cons');
      const batch: Batch = {
        id: batchId,
        item_id: item.id,
        production_date: null,
        expiry_date: null,
        opened_at: null,
        pao_months: null,
        quantity: qty,
      };
      const record: Consumption = {
        id: consumptionId,
        batch_id: batchId,
        delta: -qty,
        source: 'manual',
        created_at: nowStamp(),
      };
      stockAfter = item.quantity + qty;
      unit = item.unit;
      await target.putMany('batch', [{ ...batch }]);
      await target.putMany('consumption', [{ ...record }]);
      await target.putMany('item', [{ ...item, quantity: stockAfter }]);
      const meta: RestockRecord = { itemId: item.id, qty, batchId, consumptionId };
      await target.putMany('schema_meta', [
        { key: `${RESTOCK_META_PREFIX}${row.id}`, value: JSON.stringify(meta) },
      ]);
      restocked = true;
    }
  }

  await target.putMany('shopping_item', [{ ...row, status: 'done' }]);
  return { restocked, qty, stockAfter, unit };
}

/** 「已买」放回待购；如果这条回库过，同时把库存扣回去并删掉补货流水 */
export async function restoreShoppingItem(id: string): Promise<{ reversed: boolean }> {
  const target = db();
  const rows = await target.getAll<ShoppingItem>('shopping_item');
  const row = rows.find((item) => item.id === id);
  if (!row) return { reversed: false };

  const metaKey = `${RESTOCK_META_PREFIX}${id}`;
  const metaRow = (await target.getAll<{ key: string; value: string }>('schema_meta')).find(
    (entry) => entry.key === metaKey,
  );
  let reversed = false;

  if (metaRow) {
    try {
      const record = JSON.parse(metaRow.value) as RestockRecord;
      const items = await target.getAll<Item>('item');
      const item = items.find((entry) => entry.id === record.itemId);
      if (item) {
        await target.putMany('item', [
          { ...item, quantity: Math.max(0, item.quantity - record.qty) },
        ]);
      }
      await target.deleteMany('batch', [record.batchId]);
      await target.deleteMany('consumption', [record.consumptionId]);
      reversed = true;
    } catch (err) {
      // 记录坏了就只放回清单，不动库存
      console.warn('[shopping] 回库记录解析失败', err);
    }
    await target.deleteMany('schema_meta', [metaKey]);
  }

  await target.putMany('shopping_item', [{ ...row, status: 'pending' }]);
  return { reversed };
}

/** 回库过的待购 id，「已买」列表据此显示「已回库」标记 */
export async function loadRestockedShoppingIds(): Promise<Set<string>> {
  const rows = await db().getAll<{ key: string; value: string }>('schema_meta');
  return new Set(
    rows
      .map((entry) => entry.key)
      .filter((key) => key.startsWith(RESTOCK_META_PREFIX))
      .map((key) => key.slice(RESTOCK_META_PREFIX.length)),
  );
}

export interface ShoppingDraft {
  name: string;
  qty: number;
  section: string;
}

/** 手动添加待购；待购里已有同名条目就返回 false，不重复加 */
export async function addManualShoppingItem(draft: ShoppingDraft): Promise<boolean> {
  const target = db();
  const name = draft.name.trim();
  if (!name) return false;
  const rows = await target.getAll<ShoppingItem>('shopping_item');
  if (rows.some((row) => row.status === 'pending' && row.name.trim() === name)) return false;

  const row: ShoppingItem = {
    id: makeId('shop'),
    item_id: null,
    name,
    qty: Math.max(1, Math.trunc(draft.qty)),
    section: draft.section || '其他',
    status: 'pending',
  };
  await target.putMany('shopping_item', [{ ...row }]);
  return true;
}

export async function updateShoppingItem(
  id: string,
  patch: Partial<Pick<ShoppingItem, 'name' | 'qty' | 'section'>>,
): Promise<void> {
  const rows = await db().getAll<ShoppingItem>('shopping_item');
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error('找不到待购条目');
  await db().putMany('shopping_item', [{ ...row, ...patch }]);
}

/** 删除待购条目；已回库的只删条目，库存不回退（想回退请先「放回待购」） */
export async function deleteShoppingItem(id: string): Promise<void> {
  const target = db();
  await target.deleteMany('shopping_item', [id]);
  await target.deleteMany('schema_meta', [`${RESTOCK_META_PREFIX}${id}`]);
}

export interface NewItemInput {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  location_id: string | null;
  storage_text: string | null;
  /** 每件热量 kcal，不知道就传 null */
  calories: number | null;
  image: string | null;
  is_shared: boolean;
  threshold: number;
  production_date: string | null;
  expiry_date: string | null;
  pao_months: number | null;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 新增一条物品，同时建一个批次；没有日期也建，保证「用掉」能记到批次上 */
export async function createItem(input: NewItemInput): Promise<string> {
  const id = makeId('item');
  const item: Item = {
    id,
    name: input.name,
    category: input.category,
    image: input.image,
    location_id: input.location_id,
    unit: input.unit,
    quantity: input.quantity,
    threshold: input.threshold,
    storage_text: input.storage_text,
    calories: input.calories,
    is_shared: input.is_shared ? 1 : 0,
    status: 'active',
    created_at: nowStamp(),
  };
  await db().putMany('item', [{ ...item }]);

  const batch: Batch = {
    id: makeId('batch'),
    item_id: id,
    production_date: input.production_date,
    expiry_date: input.expiry_date,
    opened_at: null,
    pao_months: input.pao_months,
    quantity: input.quantity,
  };
  await db().putMany('batch', [{ ...batch }]);

  return id;
}

/**
 * 彻底删除一件物品：批次、消耗流水、别名、相关提醒一起删掉。
 * 待购条目保留（东西还是要买），只断开 item_id 关联；回库记录里指向它的也清掉。
 * 服务器同步是整份快照推拉，下一次推送会把本机的删除同步上去。
 */
export async function deleteItemDeep(itemId: string): Promise<void> {
  const target = db();
  const [items, batches, consumptions, reminders, aliases, shopping, metas] = await Promise.all([
    target.getAll<Item>('item'),
    target.getAll<Batch>('batch'),
    target.getAll<Consumption>('consumption'),
    target.getAll<Reminder>('reminder'),
    target.getAll<Alias>('alias'),
    target.getAll<ShoppingItem>('shopping_item'),
    target.getAll<{ key: string; value: string }>('schema_meta'),
  ]);
  if (!items.some((item) => item.id === itemId)) return;

  const batchIds = new Set(batches.filter((batch) => batch.item_id === itemId).map((batch) => batch.id));
  const consumptionIds = consumptions
    .filter((row) => batchIds.has(row.batch_id))
    .map((row) => row.id);
  // 提醒的 target_id 可能指向物品，也可能指向批次
  const reminderIds = reminders
    .filter((row) => row.target_id === itemId || batchIds.has(row.target_id))
    .map((row) => row.id);
  const aliasIds = aliases.filter((row) => row.item_id === itemId).map((row) => row.id);
  const shoppingRows = shopping
    .filter((row) => row.item_id === itemId)
    .map((row) => ({ ...row, item_id: null }));
  const metaKeys = metas
    .filter((row) => row.key.startsWith(RESTOCK_META_PREFIX) && restockItemId(row.value) === itemId)
    .map((row) => row.key);

  if (consumptionIds.length) await target.deleteMany('consumption', consumptionIds);
  if (batchIds.size) await target.deleteMany('batch', [...batchIds]);
  if (reminderIds.length) await target.deleteMany('reminder', reminderIds);
  if (aliasIds.length) await target.deleteMany('alias', aliasIds);
  if (metaKeys.length) await target.deleteMany('schema_meta', metaKeys);
  if (shoppingRows.length) await target.putMany('shopping_item', shoppingRows as unknown as Row[]);
  await target.deleteMany('item', [itemId]);
}

function restockItemId(value: string): string {
  try {
    return (JSON.parse(value) as Partial<RestockRecord>).itemId ?? '';
  } catch {
    return '';
  }
}

export interface ConsumeChange {
  batchId: string;
  delta: number;
}

export interface ConsumeResult {
  itemId: string;
  name: string;
  unit: string;
  /** 实际扣掉的数量（可能小于传入值，到 0 为止） */
  amount: number;
  /** 扣完剩下的数量，0 表示用完了 */
  remaining: number;
  /** 每个批次的扣减明细，撤销时原样加回去 */
  changes: ConsumeChange[];
  /** 本次写入的流水 id，撤销时删掉 */
  consumptionIds: string[];
  /** 低于阈值时自动写入的待购条目 id；没触发为 null */
  restockId: string | null;
  /** 该物品是否已在待购清单里（含之前就有的） */
  restockPending: boolean;
}

/** 数量掉到阈值（含 0）时自动进待购；已有待购条目就不重复加 */
async function ensureRestock(item: Item): Promise<{ id: string | null; pending: boolean }> {
  if (item.threshold <= 0 || item.quantity > item.threshold) {
    return { id: null, pending: false };
  }
  const rows = await db().getAll<ShoppingItem>('shopping_item');
  const exists = rows.some((row) => row.item_id === item.id && row.status === 'pending');
  if (exists) return { id: null, pending: true };

  const row: ShoppingItem = {
    id: makeId('shop'),
    item_id: item.id,
    name: item.name,
    qty: Math.max(1, item.threshold),
    section: displayCategory(item),
    status: 'pending',
  };
  await db().putMany('shopping_item', [{ ...row }]);
  return { id: row.id, pending: true };
}

/**
 * 用掉若干件：先到期先用，减 item.quantity；归零后仍留在库存里，由用户决定是否加入待购。
 * 每次消耗都会写一条流水；老数据缺批次时这里补一个，避免消耗记不到日历上。
 */
export async function consumeItem(itemId: string, amount = 1): Promise<ConsumeResult> {
  const target = db();
  const items = await target.getAll<Item>('item');
  const item = items.find((row) => row.id === itemId);
  if (!item) throw new Error('找不到这个物品');
  if (item.quantity <= 0) throw new Error('库存已经是 0');

  const stockBefore = item.quantity;
  const take = Math.min(Math.max(1, Math.trunc(amount)), stockBefore);
  const remaining = stockBefore - take;

  const updated: Item = { ...item, quantity: remaining };
  await target.putMany('item', [{ ...updated }]);
  const restock = await ensureRestock(updated);

  let batches = (await target.getAll<Batch>('batch'))
    .filter((batch) => batch.item_id === itemId && batch.quantity > 0)
    .sort((a, b) => {
      const ae = effectiveExpiry(a) ?? '9999-12-31';
      const be = effectiveExpiry(b) ?? '9999-12-31';
      return ae.localeCompare(be);
    });

  if (!batches.length) {
    const batch: Batch = {
      id: makeId('batch'),
      item_id: itemId,
      production_date: null,
      expiry_date: null,
      opened_at: null,
      pao_months: null,
      quantity: stockBefore,
    };
    await target.putMany('batch', [{ ...batch }]);
    batches = [batch];
  }

  const changes: ConsumeChange[] = [];
  const consumptionIds: string[] = [];
  let left = take;

  for (const batch of batches) {
    if (left <= 0) break;
    const delta = Math.min(batch.quantity, left);
    left -= delta;
    changes.push({ batchId: batch.id, delta });
    await target.putMany('batch', [{ ...batch, quantity: batch.quantity - delta }]);

    const record: Consumption = {
      id: makeId('cons'),
      batch_id: batch.id,
      delta,
      source: 'manual',
      created_at: nowStamp(),
    };
    consumptionIds.push(record.id);
    await target.putMany('consumption', [{ ...record }]);
  }

  return {
    itemId,
    name: item.name,
    unit: item.unit,
    amount: take,
    remaining,
    changes,
    consumptionIds,
    restockId: restock.id,
    restockPending: restock.pending,
  };
}

/** 撤销一次 consumeItem：数量加回去、批次恢复、流水删掉 */
export async function undoConsume(result: ConsumeResult): Promise<void> {
  const target = db();
  const items = await target.getAll<Item>('item');
  const item = items.find((row) => row.id === result.itemId);
  if (item) {
    await target.putMany('item', [{ ...item, quantity: item.quantity + result.amount }]);
  }

  if (result.changes.length) {
    const batches = await target.getAll<Batch>('batch');
    for (const change of result.changes) {
      const batch = batches.find((row) => row.id === change.batchId);
      if (batch) await target.putMany('batch', [{ ...batch, quantity: batch.quantity + change.delta }]);
    }
  }

  if (result.consumptionIds.length) {
    await target.deleteMany('consumption', result.consumptionIds);
  }

  // 只删本次自动加的待购条目；用户已经标记买好的不动
  if (result.restockId) {
    const shopping = await target.getAll<ShoppingItem>('shopping_item');
    const row = shopping.find((item) => item.id === result.restockId);
    if (row && row.status === 'pending') await target.deleteMany('shopping_item', [row.id]);
  }
}

/** 归零后加入待购；同一物品已有待购条目时不再重复添加 */
export async function addShoppingItem(input: {
  item_id: string | null;
  name: string;
  qty: number;
  section: string;
}): Promise<void> {
  const target = db();
  const existing = await target.getAll<ShoppingItem>('shopping_item');
  if (input.item_id && existing.some((row) => row.item_id === input.item_id && row.status === 'pending')) {
    return;
  }
  const row: ShoppingItem = {
    id: makeId('shop'),
    item_id: input.item_id,
    name: input.name,
    qty: input.qty,
    section: input.section,
    status: 'pending',
  };
  await target.putMany('shopping_item', [{ ...row }]);
}

export interface BatchView extends Batch {
  /** 实际到期日：有 expiry_date 用它，否则 开封日 + PAO */
  expiry: string | null;
  daysLeft: number | null;
}

export interface ItemDetail {
  item: Item;
  locationName: string;
  batches: BatchView[];
  /** 最近 10 条消耗流水 */
  consumptions: Consumption[];
}

export async function loadItemDetail(itemId: string): Promise<ItemDetail | null> {
  const target = db();
  const [items, batches, locations, consumptions] = await Promise.all([
    target.getAll<Item>('item'),
    target.getAll<Batch>('batch'),
    target.getAll<Location>('location'),
    target.getAll<Consumption>('consumption'),
  ]);

  const item = items.find((row) => row.id === itemId);
  if (!item) return null;

  const views = batches
    .filter((batch) => batch.item_id === itemId)
    .map<BatchView>((batch) => {
      const expiry = effectiveExpiry(batch);
      return { ...batch, expiry, daysLeft: expiry ? daysFromToday(expiry) : null };
    })
    .sort((a, b) => {
      const av = a.expiry ?? '9999-12-31';
      const bv = b.expiry ?? '9999-12-31';
      return av.localeCompare(bv);
    });

  const batchIds = new Set(views.map((batch) => batch.id));
  const recent = consumptions
    .filter((row) => batchIds.has(row.batch_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10);

  const location = locations.find((row) => row.id === item.location_id);

  return { item, locationName: location?.name ?? '未归类', batches: views, consumptions: recent };
}

/** 改批次的日期 / 开封信息 */
export async function updateBatch(
  batchId: string,
  patch: Partial<Pick<Batch, 'expiry_date' | 'opened_at' | 'pao_months'>>,
): Promise<void> {
  const rows = await db().getAll<Batch>('batch');
  const batch = rows.find((row) => row.id === batchId);
  if (!batch) throw new Error('找不到这个批次');
  await db().putMany('batch', [{ ...batch, ...patch }]);
}

/** 给物品配照片或换照片；null 表示清掉 */
export async function setItemImage(itemId: string, image: string | null): Promise<void> {
  const rows = await db().getAll<Item>('item');
  const item = rows.find((row) => row.id === itemId);
  if (!item) throw new Error('找不到这件物品');
  await db().putMany('item', [{ ...item, image }]);
}

/** 手动把一个物品加入待购（详情页用） */
export async function addItemToShopping(itemId: string): Promise<void> {
  const rows = await db().getAll<Item>('item');
  const item = rows.find((row) => row.id === itemId);
  if (!item) return;
  await addShoppingItem({
    item_id: item.id,
    name: item.name,
    qty: Math.max(1, item.threshold),
    section: displayCategory(item),
  });
}

/** schema_meta 读写，提醒设置存在这里 */
export async function readMeta(key: string): Promise<string | null> {
  const rows = await db().getAll<{ key: string; value: string }>('schema_meta');
  return rows.find((row) => row.key === key)?.value ?? null;
}

export async function writeMeta(key: string, value: string): Promise<void> {
  await db().putMany('schema_meta', [{ key, value }]);
}

export async function loadReminders(): Promise<Reminder[]> {
  return db().getAll<Reminder>('reminder');
}

export async function addReminder(row: Reminder): Promise<void> {
  await db().putMany('reminder', [{ ...row }]);
}

export interface WeeklyStats {
  /** 近 7 天消耗件数 */
  consumed: number;
  /** 近 7 天新入库件数 */
  added: number;
}

export async function loadWeeklyStats(): Promise<WeeklyStats> {
  const target = db();
  const [consumptions, items] = await Promise.all([
    target.getAll<Consumption>('consumption'),
    target.getAll<Item>('item'),
  ]);
  const since = `${addDays(-6)} 00:00:00`;

  return {
    consumed: consumptions
      .filter((row) => row.created_at >= since)
      .reduce((sum, row) => sum + Math.max(0, row.delta), 0),
    added: items
      .filter((row) => row.created_at >= since)
      .reduce((sum, row) => sum + Math.max(0, row.quantity), 0),
  };
}

/** 月报需要的原始三张表；聚合逻辑在 services/monthly-report.ts */
export interface ReportData {
  items: Item[];
  batches: Batch[];
  consumptions: Consumption[];
}

export async function loadReportData(): Promise<ReportData> {
  const target = db();
  const [items, batches, consumptions] = await Promise.all([
    target.getAll<Item>('item'),
    target.getAll<Batch>('batch'),
    target.getAll<Consumption>('consumption'),
  ]);
  return { items, batches, consumptions };
}

export async function loadLocations(): Promise<Location[]> {
  const rows = await db().getAll<Location>('location');
  return rows.sort((a, b) => a.sort - b.sort);
}
