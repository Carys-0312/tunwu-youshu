import type { TableName } from '@/types/models';
import type { DbDriver, Row } from './driver';
import { DB_NAME, DB_VERSION, TABLES, keyPathOf } from './schema';

/** H5 端：IndexedDB，表名与 App 端 SQLite 保持一致。 */
export class IdbDriver implements DbDriver {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const table of TABLES) {
          if (!db.objectStoreNames.contains(table)) {
            db.createObjectStore(table, { keyPath: keyPathOf(table) });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('打开 IndexedDB 失败'));
      req.onblocked = () => reject(new Error('IndexedDB 被其他页面占用，请关闭后重试'));
    });
  }

  private store(table: TableName, mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('数据库尚未初始化');
    return this.db.transaction(table, mode).objectStore(table);
  }

  async getAll<T>(table: TableName): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const req = this.store(table, 'readonly').getAll();
      req.onsuccess = () => resolve((req.result ?? []) as T[]);
      req.onerror = () => reject(req.error ?? new Error(`读取 ${table} 失败`));
    });
  }

  async putMany(table: TableName, rows: Row[]): Promise<void> {
    if (!rows.length) return;
    if (!this.db) throw new Error('数据库尚未初始化');
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(table, 'readwrite');
      const store = tx.objectStore(table);
      for (const row of rows) store.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`写入 ${table} 失败`));
      tx.onabort = () => reject(tx.error ?? new Error(`写入 ${table} 被中断`));
    });
  }

  async deleteMany(table: TableName, ids: string[]): Promise<void> {
    if (!ids.length) return;
    if (!this.db) throw new Error('数据库尚未初始化');
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(table, 'readwrite');
      const store = tx.objectStore(table);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`删除 ${table} 失败`));
      tx.onabort = () => reject(tx.error ?? new Error(`删除 ${table} 被中断`));
    });
  }

  async clear(table: TableName): Promise<void> {
    if (!this.db) throw new Error('数据库尚未初始化');
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(table, 'readwrite');
      tx.objectStore(table).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`清空 ${table} 失败`));
    });
  }
}
