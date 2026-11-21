import type { TableName } from '@/types/models';
import type { DbDriver, Row } from './driver';
import { CREATE_INDEX_SQL, CREATE_TABLE_SQL, DB_NAME, DB_VERSION, TABLES, keyPathOf } from './schema';

/** App 端：plus.sqlite，库文件放在 _doc/ 下，随应用私有目录保存。 */
const DB_PATH = '_doc/tunwu.db';

function plusApi(): any {
  const plus = (globalThis as any).plus;
  if (!plus || !plus.sqlite) {
    throw new Error('plus.sqlite 不可用：请在 App 环境中运行');
  }
  return plus.sqlite;
}

function invoke(opts: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    opts.success = (res: any) => resolve(res);
    opts.fail = (err: any) => reject(new Error(err?.message ?? String(err)));
    plusApi().executeSql(opts);
  });
}

function select(sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    plusApi().selectSql({
      name: DB_NAME,
      sql,
      success: (rows: any[]) => resolve(rows ?? []),
      fail: (err: any) => reject(new Error(err?.message ?? String(err))),
    });
  });
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

export class SqliteDriver implements DbDriver {
  private ready = false;

  async init(): Promise<void> {
    if (this.ready) return;

    await new Promise<void>((resolve, reject) => {
      plusApi().openDatabase({
        name: DB_NAME,
        path: DB_PATH,
        success: () => resolve(),
        fail: (err: any) => {
          const msg = String(err?.message ?? err ?? '');
          // 重复打开不算错误
          if (msg.includes('already')) resolve();
          else reject(new Error(msg || '打开本地数据库失败'));
        },
      });
    });

    for (const table of TABLES) {
      await invoke({ name: DB_NAME, sql: CREATE_TABLE_SQL[table] });
    }
    for (const sql of CREATE_INDEX_SQL) {
      await invoke({ name: DB_NAME, sql });
    }

    // v1 -> v2：Item 增加储存条件字段；v2 -> v3：增加每件热量。列已存在时会报错，忽略即可。
    await this.tryExec('ALTER TABLE item ADD COLUMN storage_text TEXT');
    await this.tryExec('ALTER TABLE item ADD COLUMN calories INTEGER');

    await invoke({ name: DB_NAME, sql: `PRAGMA user_version = ${DB_VERSION}` });
    this.ready = true;
  }

  private async tryExec(sql: string): Promise<void> {
    try {
      await invoke({ name: DB_NAME, sql });
    } catch (err) {
      console.warn('[db] 迁移语句跳过', sql, err);
    }
  }

  async getAll<T>(table: TableName): Promise<T[]> {
    return (await select(`SELECT * FROM ${table}`)) as T[];
  }

  async putMany(table: TableName, rows: Row[]): Promise<void> {
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map((c) => literal(row[c]));
      const quoted = columns.map((c) => `"${c}"`).join(', ');
      await invoke({
        name: DB_NAME,
        sql: `INSERT OR REPLACE INTO ${table} (${quoted}) VALUES (${values.join(', ')})`,
      });
    }
  }

  async deleteMany(table: TableName, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const quoted = ids.map((id) => literal(id)).join(', ');
    await invoke({
      name: DB_NAME,
      sql: `DELETE FROM ${table} WHERE ${keyPathOf(table)} IN (${quoted})`,
    });
  }

  async clear(table: TableName): Promise<void> {
    await invoke({ name: DB_NAME, sql: `DELETE FROM ${table}` });
  }
}
