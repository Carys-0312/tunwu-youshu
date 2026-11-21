/**
 * 备份与恢复：把本地 8 张表整体序列化成一份 JSON。
 *
 * 数据只存在本机（H5 是 IndexedDB、App 是 SQLite），换设备/清缓存就会丢，
 * 所以这里提供「导出一份文件」和「从文件恢复」。格式同时是后续云同步的载体。
 */

import { readAllTables, replaceAllTables } from '@/db/repo';
import { DB_VERSION, TABLES } from '@/db/schema';
import type { TableName } from '@/types/models';

/** 文件里的身份标记，防止误导入别的 JSON */
const BACKUP_FORMAT = 'tunwu-youshu-backup';

export interface BackupFile {
  format: string;
  schema_version: number;
  exported_at: string;
  counts: Record<string, number>;
  data: Partial<Record<TableName, Record<string, unknown>[]>>;
}

export interface ExportResult {
  fileName: string;
  counts: Record<string, number>;
  /** App 端写进 _doc 的绝对路径；H5 走浏览器下载，没有路径 */
  path?: string;
}

/** 读一遍所有表，组装成待写出的快照 */
export async function buildBackup(): Promise<BackupFile> {
  const data = await readAllTables();
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    counts[table] = data[table]?.length ?? 0;
  }
  return {
    format: BACKUP_FORMAT,
    schema_version: DB_VERSION,
    exported_at: new Date().toISOString(),
    counts,
    data,
  };
}

export function backupFileName(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `tunwu-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

function backupText(snapshot: BackupFile): string {
  return JSON.stringify(snapshot, null, 2);
}

// #ifdef H5
function downloadInBrowser(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
// #endif

// #ifndef H5
/** App 端：写到应用私有目录 _doc/，用户可以再从文件管理器或分享里取出 */
function writeToDocDir(text: string, fileName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const plus = (globalThis as any).plus;
    if (!plus?.io) {
      reject(new Error('当前环境不支持写文件'));
      return;
    }
    plus.io.resolveLocalFileSystemURL(
      '_doc/',
      (root: any) => {
        root.getFile(
          fileName,
          { create: true },
          (entry: any) => {
            entry.createWriter(
              (writer: any) => {
                writer.onwriteend = () => resolve(plus.io.convertLocalFileSystemURL(`_doc/${fileName}`));
                writer.onerror = () => reject(new Error('写备份文件失败'));
                writer.write(text);
              },
              () => reject(new Error('打开备份文件失败')),
            );
          },
          () => reject(new Error('创建备份文件失败')),
        );
      },
      () => reject(new Error('找不到应用私有目录')),
    );
  });
}

/** App 端没有文件选择器，只能读自己导出到 _doc 的最近一份 */
function readLatestFromDocDir(): Promise<string> {
  return new Promise((resolve, reject) => {
    const plus = (globalThis as any).plus;
    if (!plus?.io) {
      reject(new Error('当前环境不支持读文件'));
      return;
    }
    plus.io.resolveLocalFileSystemURL(
      '_doc/',
      (root: any) => {
        root.createReader().readEntries(
          (entries: any[]) => {
            // 文件名带时间戳，按名字倒序第一条就是最新的
            const files = entries
              .filter((e: any) => e.isFile && /^tunwu-backup-\d{8}-\d{4}\.json$/.test(e.name))
              .sort((a: any, b: any) => b.name.localeCompare(a.name));
            if (!files.length) {
              reject(new Error('_doc 目录里没有找到备份文件'));
              return;
            }
            files[0].file(
              (file: any) => {
                const reader = new plus.io.FileReader();
                reader.onloadend = (e: any) => resolve(String(e?.target?.result ?? ''));
                reader.onerror = () => reject(new Error('读取备份文件失败'));
                reader.readAsText(file);
              },
              () => reject(new Error('读取备份文件失败')),
            );
          },
          () => reject(new Error('读取目录失败')),
        );
      },
      () => reject(new Error('找不到应用私有目录')),
    );
  });
}
// #endif

/** 导出：H5 触发浏览器下载，App 写进 _doc */
export async function exportBackup(): Promise<ExportResult> {
  const snapshot = await buildBackup();
  const text = backupText(snapshot);
  const fileName = backupFileName();

  // #ifdef H5
  downloadInBrowser(text, fileName);
  return { fileName, counts: snapshot.counts };
  // #endif

  // #ifndef H5
  const path = await writeToDocDir(text, fileName);
  return { fileName, counts: snapshot.counts, path };
  // #endif
}

// #ifdef H5
function pickFileInBrowser(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
      fn();
    };

    // 用户取消选择时不会触发 change，靠窗口重新获得焦点来判断
    const onFocus = (): void => {
      window.setTimeout(() => settle(() => reject(new Error('已取消选择文件'))), 500);
    };
    window.addEventListener('focus', onFocus);

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        settle(() => reject(new Error('已取消选择文件')));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => settle(() => resolve(String(reader.result ?? '')));
      reader.onerror = () => settle(() => reject(new Error('读取备份文件失败')));
      reader.readAsText(file);
    };
    input.oncancel = () => settle(() => reject(new Error('已取消选择文件')));

    input.click();
  });
}
// #endif

/** 让用户提供一份备份内容：H5 选文件，App 读 _doc 里最近一次导出 */
export function readBackupText(): Promise<string> {
  // #ifdef H5
  return pickFileInBrowser();
  // #endif

  // #ifndef H5
  return readLatestFromDocDir();
  // #endif
}

/** 校验并解析备份文件，任何一处不对都抛错，避免写坏本地数据 */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('这个文件不是有效的 JSON');
  }

  const file = parsed as Partial<BackupFile> | null;
  if (!file || file.format !== BACKUP_FORMAT) {
    throw new Error('这不是囤物有数的备份文件');
  }
  if (typeof file.schema_version !== 'number') {
    throw new Error('备份文件缺少版本号');
  }
  if (file.schema_version > DB_VERSION) {
    throw new Error(`备份来自更新的版本（v${file.schema_version}），请先升级应用`);
  }
  if (!file.data || typeof file.data !== 'object') {
    throw new Error('备份文件里没有数据');
  }

  const data: BackupFile['data'] = {};
  for (const table of TABLES) {
    const rows = (file.data as Record<string, unknown>)[table];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      throw new Error(`备份里的 ${table} 不是列表`);
    }
    data[table] = rows as Record<string, unknown>[];
  }

  return {
    format: BACKUP_FORMAT,
    schema_version: file.schema_version,
    exported_at: typeof file.exported_at === 'string' ? file.exported_at : '',
    counts: (file.counts as Record<string, number>) ?? {},
    data,
  };
}

/** 用备份覆盖本机全部数据，调用方负责随后刷新 store */
export async function applyBackup(file: BackupFile): Promise<void> {
  await replaceAllTables(file.data);
}
