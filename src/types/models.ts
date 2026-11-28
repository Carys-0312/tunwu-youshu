/** 与 PRD 第 8 节数据模型一一对应。日期统一 YYYY-MM-DD，数量统一整数。 */

export type ID = string;

export type ItemStatus = 'active' | 'archived';

export interface Item {
  id: ID;
  name: string;
  category: string;
  image: string | null;
  location_id: ID | null;
  unit: string;
  quantity: number;
  threshold: number;
  /** 包装上的储存条件，如「冷藏 2-6℃」「阴凉干燥处」 */
  storage_text: string | null;
  /** 每件（每份）热量 kcal；药品、日用品等没有热量的为 null */
  calories: number | null;
  is_shared: 0 | 1;
  /** 服务端 item 表有 NOT NULL 的 status 列，保留字段；客户端已去掉归档，统一写 active */
  status: ItemStatus;
  created_at: string;
}

export interface Batch {
  id: ID;
  item_id: ID;
  production_date: string | null;
  expiry_date: string | null;
  opened_at: string | null;
  /** 开封后保质期，二选一；按天更精确，按月兼容旧数据 */
  pao_months: number | null;
  pao_days: number | null;
  quantity: number;
}

export interface Consumption {
  id: ID;
  batch_id: ID;
  /** 正数为消耗，负数为补货 */
  delta: number;
  source: 'manual' | 'scan' | 'import';
  created_at: string;
}

export interface Location {
  id: ID;
  name: string;
  parent_id: ID | null;
  sort: number;
}

export type ShoppingStatus = 'pending' | 'done';

export interface ShoppingItem {
  id: ID;
  item_id: ID | null;
  name: string;
  qty: number;
  section: string;
  status: ShoppingStatus;
}

export type ReminderType = 'expiry' | 'opened' | 'restock' | 'weekly';
export type ReminderStatus = 'pending' | 'sent' | 'dismissed';

export interface Reminder {
  id: ID;
  type: ReminderType;
  target_id: ID;
  fire_at: string;
  channel: 'local' | 'system' | 'ics';
  status: ReminderStatus;
}

export interface Alias {
  id: ID;
  raw_text: string;
  item_id: ID;
  count: number;
}

export type TableName =
  | 'item'
  | 'batch'
  | 'consumption'
  | 'location'
  | 'shopping_item'
  | 'reminder'
  | 'alias'
  | 'schema_meta';

/** 库存列表用的聚合视图 */
export interface InventoryRow {
  item: Item;
  locationName: string;
  /** 最近一批的到期日，没有批次则为 null */
  expiryDate: string | null;
  /** 距今天数，负数表示已过期 */
  daysLeft: number | null;
  /** 最近一批食物自身的总保质期天数，用来推荐默认提醒时间 */
  shelfLifeDays: number | null;
  isLowStock: boolean;
}

export interface DashboardData {
  totalItems: number;
  totalUnits: number;
  expiringSoon: number;
  expired: number;
  lowStock: number;
  shoppingPending: number;
}
