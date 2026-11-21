import type { TableName } from '@/types/models';

/** 当前 schema 版本，写入 PRAGMA user_version（App）与 IDB 库版本（H5）。 */
export const DB_VERSION = 3;
export const DB_NAME = 'tunwu';

export const TABLES: TableName[] = [
  'item',
  'batch',
  'consumption',
  'location',
  'shopping_item',
  'reminder',
  'alias',
  'schema_meta',
];

/** 除 schema_meta 外，所有表以 id 为主键。 */
export function keyPathOf(table: TableName): string {
  return table === 'schema_meta' ? 'key' : 'id';
}

export const CREATE_TABLE_SQL: Record<TableName, string> = {
  location: `CREATE TABLE IF NOT EXISTS location (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  item: `CREATE TABLE IF NOT EXISTS item (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    image TEXT,
    location_id TEXT,
    unit TEXT NOT NULL DEFAULT '件',
    quantity INTEGER NOT NULL DEFAULT 0,
    threshold INTEGER NOT NULL DEFAULT 0,
    storage_text TEXT,
    calories INTEGER,
    is_shared INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  )`,
  batch: `CREATE TABLE IF NOT EXISTS batch (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    production_date TEXT,
    expiry_date TEXT,
    opened_at TEXT,
    pao_months INTEGER,
    quantity INTEGER NOT NULL DEFAULT 0
  )`,
  consumption: `CREATE TABLE IF NOT EXISTS consumption (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  )`,
  shopping_item: `CREATE TABLE IF NOT EXISTS shopping_item (
    id TEXT PRIMARY KEY,
    item_id TEXT,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    section TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
  )`,
  reminder: `CREATE TABLE IF NOT EXISTS reminder (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    fire_at TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'local',
    status TEXT NOT NULL DEFAULT 'pending'
  )`,
  alias: `CREATE TABLE IF NOT EXISTS alias (
    id TEXT PRIMARY KEY,
    raw_text TEXT NOT NULL,
    item_id TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1
  )`,
  schema_meta: `CREATE TABLE IF NOT EXISTS schema_meta (
    "key" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
  )`,
};

export const CREATE_INDEX_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_batch_item ON batch(item_id)',
  'CREATE INDEX IF NOT EXISTS idx_batch_expiry ON batch(expiry_date)',
  'CREATE INDEX IF NOT EXISTS idx_consumption_batch ON consumption(batch_id)',
  'CREATE INDEX IF NOT EXISTS idx_item_location ON item(location_id)',
  'CREATE INDEX IF NOT EXISTS idx_item_status ON item(status)',
];
