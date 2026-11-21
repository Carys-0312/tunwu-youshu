/**
 * 应用内运行日志。
 *
 * 只记账号、同步、识别这类关键动作，方便在手机上排查问题；
 * 存在本机 uni storage 里，不写数据库，所以不会跟着备份或同步走。
 * 不要往这里写密码、JWT、找回码或图片内容。
 */
import { nowStamp } from '@/utils/date';

export type LogLevel = 'info' | 'warn' | 'error';

export interface RunLogEntry {
  id: string;
  at: string;
  level: LogLevel;
  /** 动作分类：账号 / 同步 / 识别 / 启动 */
  scope: string;
  message: string;
  /** 可选的补充信息，比如错误原文、修订号 */
  detail?: string;
}

const STORAGE_KEY = 'run_logs_v1';
const MAX_ENTRIES = 300;

let cache: RunLogEntry[] | null = null;

function load(): RunLogEntry[] {
  if (cache) return cache;
  try {
    const raw = uni.getStorageSync(STORAGE_KEY);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    cache = Array.isArray(parsed) ? (parsed as RunLogEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(rows: RunLogEntry[]): void {
  cache = rows;
  try {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // 存储满了 / 不可用：内存里还有，页面本次仍能看到
  }
}

function push(level: LogLevel, scope: string, message: string, detail?: string): void {
  const rows = load();
  rows.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: nowStamp(),
    level,
    scope,
    message,
    detail,
  });
  if (rows.length > MAX_ENTRIES) rows.splice(0, rows.length - MAX_ENTRIES);
  persist(rows);
}

export function logInfo(scope: string, message: string, detail?: string): void {
  push('info', scope, message, detail);
}

export function logWarn(scope: string, message: string, detail?: string): void {
  push('warn', scope, message, detail);
}

export function logError(scope: string, message: string, detail?: string): void {
  push('error', scope, message, detail);
}

/** 新的在前，页面直接渲染 */
export function readLogs(): RunLogEntry[] {
  return [...load()].reverse();
}

export function clearLogs(): void {
  persist([]);
}

/** 把异常转成一行可读文字，空异常给个兜底 */
export function logDetail(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
