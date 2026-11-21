import type { TableName } from '@/types/models';
import { SqliteDriver } from './sqlite-driver';
import { IdbDriver } from './idb-driver';

export type Row = Record<string, unknown>;

export interface DbDriver {
  init(): Promise<void>;
  getAll<T>(table: TableName): Promise<T[]>;
  /** 按主键 upsert，一次写入一批 */
  putMany(table: TableName, rows: Row[]): Promise<void>;
  /** 按主键删除，用于撤销消耗流水 */
  deleteMany(table: TableName, ids: string[]): Promise<void>;
  clear(table: TableName): Promise<void>;
}

/** 按运行平台选择驱动：App 走 plus.sqlite，H5 走 IndexedDB。 */
export function createDriver(): DbDriver {
  // #ifdef APP-PLUS
  return new SqliteDriver();
  // #endif
  // #ifdef H5
  return new IdbDriver();
  // #endif
  // 兜底：未被条件编译命中的环境（如微信小程序）暂用 H5 驱动
  return new IdbDriver();
}
