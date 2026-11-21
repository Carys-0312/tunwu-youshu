/**
 * 本机数据归属。
 *
 * 本地库是设备级的：H5 的 IndexedDB 和 App 的 `_doc/tunwu.db` 都不带 user_id，
 * 同一台设备上的所有账号共用一套表。所以必须记下这份数据最后属于哪个账号，
 * 登录 / 注册 / 找回密码时据此决定是保留、询问还是清除，
 * 避免把上一个账号（或游客）的库存静默推到新账号。
 */

import type { TableName } from '@/types/models';
import { TABLES } from '@/db/schema';
import { clearAllTables, readAllTables } from '@/db/repo';

const OWNER_KEY = 'local_data_owner_v1';
const GUEST = 'guest';

/**
 * undefined = 没有归属记录（老版本升级上来的设备）
 * null      = 游客数据（从没归属过任何账号）
 * string    = 上一个使用这份数据的账号 id
 */
export type LocalOwner = string | null | undefined;

export function getLocalOwner(): LocalOwner {
  try {
    const raw = uni.getStorageSync(OWNER_KEY);
    if (typeof raw !== 'string' || !raw) return undefined;
    return raw === GUEST ? null : raw;
  } catch {
    return undefined;
  }
}

export function setLocalOwner(userId: string | null): void {
  try {
    uni.setStorageSync(OWNER_KEY, userId ?? GUEST);
  } catch {
    // 存储不可用时不影响本次登录；下次启动会按「来源不明」处理
  }
}

export interface LocalDataCount {
  /** 物品数，用于给用户看 */
  items: number;
  /** 业务表总行数（不含 schema_meta），用于判断本机到底有没有数据 */
  rows: number;
}

/** schema_meta 里是迁移标记、管家设定等，不能算作「用户库存」 */
const CONTENT_TABLES = TABLES.filter((table) => table !== 'schema_meta') as TableName[];

export async function countLocalData(): Promise<LocalDataCount> {
  const data = await readAllTables();
  let rows = 0;
  for (const table of CONTENT_TABLES) {
    rows += data[table]?.length ?? 0;
  }
  return { items: data.item?.length ?? 0, rows };
}

/** 清空本机全部业务表（含 schema_meta），用于从空库存开始 */
export async function clearLocalData(): Promise<void> {
  await clearAllTables();
}
