/**
 * 演示数据的识别与清理。
 *
 * 只认种子里的 id：用户自己加的物品、批次、流水 id 都对不上，一律当真实数据保留。
 * 演示物品被用户消耗过后，流水 id 可能不是种子的，但 batch_id 还指向演示批次，
 * 所以清理时要顺着 item → batch → consumption 的关系一起删，避免留下孤儿流水。
 */
import { buildSeedRows } from './seed';
import type { TableName } from '@/types/models';

type Row = Record<string, unknown>;

const seed = buildSeedRows();

const ID_TABLES: Exclude<TableName, 'schema_meta'>[] = [
  'item',
  'batch',
  'consumption',
  'shopping_item',
  'reminder',
  'alias',
  'location',
];

const seedIds = new Map<TableName, Set<string>>();
for (const table of ID_TABLES) {
  seedIds.set(table, new Set((seed[table] as Row[]).map((row) => String(row.id))));
}

/** 「买好回库」记录存在 schema_meta，key 形如 shopping_restock:<待购 id> */
const RESTOCK_META_PREFIX = 'shopping_restock:';

function idOf(row: Row): string {
  return String(row.id ?? row.key ?? '');
}

function isSeedRow(table: TableName, row: Row): boolean {
  return seedIds.get(table)?.has(idOf(row)) ?? false;
}

/** 一份快照（本机或服务器）是不是「原封不动的演示数据」 */
export function isDemoSnapshot(data: Partial<Record<TableName, Row[]>>): boolean {
  const items = data.item ?? [];
  if (!items.length) return false;

  for (const table of ID_TABLES) {
    const ids = seedIds.get(table) as Set<string>;
    for (const row of data[table] ?? []) {
      if (!ids.has(String(row.id))) return false;
    }
  }
  return true;
}

export interface DemoStripResult {
  data: Partial<Record<TableName, Row[]>>;
  changed: boolean;
  /** 删掉或改写的行数，用于日志 */
  changedRows: number;
}

/**
 * 从一份快照里剔除所有演示数据，保留用户自己的内容：
 * - 演示物品、批次、消耗流水、提醒、别名、待购条目直接删；
 * - 用户自己建的待购如果指向演示物品，保留条目但断开 item_id；
 * - 演示位置只在该位置没有真实物品引用时删除，父位置一起保留；
 * - schema_meta 只删指向演示物品的回库记录。
 */
export function stripDemoRows(input: Partial<Record<TableName, Row[]>>): DemoStripResult {
  const rowsOf = (table: TableName): Row[] => (input[table] ?? []) as Row[];

  const demoItemIds = new Set(
    rowsOf('item').filter((row) => isSeedRow('item', row)).map(idOf),
  );
  const demoBatchIds = new Set(
    rowsOf('batch')
      .filter((row) => isSeedRow('batch', row) || demoItemIds.has(String(row.item_id ?? '')))
      .map(idOf),
  );

  let changedRows = 0;

  const item = rowsOf('item').filter((row) => {
    const drop = isSeedRow('item', row);
    if (drop) changedRows += 1;
    return !drop;
  });

  const batch = rowsOf('batch').filter((row) => {
    const drop = isSeedRow('batch', row) || demoBatchIds.has(idOf(row));
    if (drop) changedRows += 1;
    return !drop;
  });

  const consumption = rowsOf('consumption').filter((row) => {
    const drop = isSeedRow('consumption', row) || demoBatchIds.has(String(row.batch_id ?? ''));
    if (drop) changedRows += 1;
    return !drop;
  });

  const reminder = rowsOf('reminder').filter((row) => {
    const target = String(row.target_id ?? '');
    const drop = isSeedRow('reminder', row) || demoItemIds.has(target) || demoBatchIds.has(target);
    if (drop) changedRows += 1;
    return !drop;
  });

  const alias = rowsOf('alias').filter((row) => {
    const drop = isSeedRow('alias', row) || demoItemIds.has(String(row.item_id ?? ''));
    if (drop) changedRows += 1;
    return !drop;
  });

  const shoppingItem = rowsOf('shopping_item').flatMap((row) => {
    if (isSeedRow('shopping_item', row)) {
      changedRows += 1;
      return [];
    }
    // 用户自己加的待购条目留着，只断开已经删掉的演示物品
    if (row.item_id && demoItemIds.has(String(row.item_id))) {
      changedRows += 1;
      return [{ ...row, item_id: null }];
    }
    return [row];
  });

  // 真实物品还在用的位置（含父级）必须保留；其余演示位置可以删
  const locationById = new Map(rowsOf('location').map((row) => [idOf(row), row]));
  const keptLocationIds = new Set<string>();
  for (const row of item) {
    let locationId = row.location_id ? String(row.location_id) : '';
    while (locationId && !keptLocationIds.has(locationId)) {
      keptLocationIds.add(locationId);
      const parent = locationById.get(locationId)?.parent_id;
      locationId = parent ? String(parent) : '';
    }
  }
  const location = rowsOf('location').filter((row) => {
    const drop = isSeedRow('location', row) && !keptLocationIds.has(idOf(row));
    if (drop) changedRows += 1;
    return !drop;
  });

  const schemaMeta = rowsOf('schema_meta').filter((row) => {
    const key = String(row.key ?? '');
    if (!key.startsWith(RESTOCK_META_PREFIX)) return true;
    try {
      const record = JSON.parse(String(row.value ?? '{}')) as { itemId?: unknown };
      if (record.itemId && demoItemIds.has(String(record.itemId))) {
        changedRows += 1;
        return false;
      }
    } catch {
      // 记录坏了也不影响清理其他数据
    }
    return true;
  });

  if (!changedRows) return { data: input, changed: false, changedRows: 0 };

  return {
    data: {
      ...input,
      item,
      batch,
      consumption,
      reminder,
      alias,
      shopping_item: shoppingItem,
      location,
      schema_meta: schemaMeta,
    },
    changed: true,
    changedRows,
  };
}
