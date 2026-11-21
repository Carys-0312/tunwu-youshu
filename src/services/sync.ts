/**
 * 服务端同步：把本地整份快照推到 Postgres，或从服务器拉回来恢复。
 * 本地仍然是唯一的数据源，同步失败不影响日常使用。
 */

import type { TableName } from '@/types/models';
import { TABLES } from '@/db/schema';
import { readAllTables, readMeta, replaceAllTables, writeMeta } from '@/db/repo';
import { nowStamp } from '@/utils/date';
import { API_BASE } from './api';
import { authHeader, clearSession } from './auth';
import { httpRequest, parseJsonBody, type HttpMethod } from './http';

export interface SyncStatus {
  revision: number;
  deviceId: string | null;
  syncedAt: string | null;
  counts: Record<string, number>;
}

export interface SyncSnapshot {
  revision: number;
  deviceId: string | null;
  syncedAt: string | null;
  data: Partial<Record<TableName, Record<string, unknown>[]>>;
}

const DEVICE_KEY = 'device_id';

/** 每台设备一个稳定标识，只用于服务器记录是谁推的 */
async function deviceId(): Promise<string> {
  const existing = await readMeta(DEVICE_KEY);
  if (existing) return existing;
  const id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await writeMeta(DEVICE_KEY, id);
  return id;
}

/** 网络错误统一换成人话，页面直接展示 */
async function request(url: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  try {
    return await httpRequest({
      url,
      method: (init?.method as HttpMethod) ?? 'GET',
      header: init?.headers as Record<string, string>,
      data: parseJsonBody(init?.body),
      timeout: 60000,
    });
  } catch {
    throw new Error('连不上同步服务，检查手机网络后再试');
  }
}

async function readJson(status: number, body: string): Promise<Record<string, any>> {
  let parsed: Record<string, any> | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 网关错误页之类
  }
  if (status >= 200 && status < 300) return parsed ?? {};
  if (status === 401) {
    clearSession();
    throw new Error('登录已过期，请重新登录');
  }
  const message = (parsed as { error?: string } | null)?.error;
  throw new Error(message || `同步失败（${status}）`);
}

/** 同步接口必须带 JWT；未登录时直接提示，不发请求 */
function requireAuthHeader(): Record<string, string> {
  const header = authHeader();
  if (!header.Authorization) throw new Error('先登录后再同步');
  return header;
}

function normalizeStatus(data: Record<string, any>): SyncStatus {
  return {
    revision: Number(data.revision ?? 0),
    deviceId: data.deviceId ?? null,
    syncedAt: data.syncedAt ?? null,
    counts: (data.counts as Record<string, number>) ?? {},
  };
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await request(`${API_BASE}/api/sync/status`, {
    headers: { Accept: 'application/json', ...requireAuthHeader() },
  });
  return normalizeStatus(await readJson(res.status, res.body));
}

/** 推整份快照；服务器已有数据时，空库覆盖需要 force=true */
export async function pushSnapshot(force = false): Promise<SyncStatus> {
  const data = await readAllTables();
  const res = await request(`${API_BASE}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...requireAuthHeader(),
    },
    body: JSON.stringify({
      deviceId: await deviceId(),
      syncedAt: nowStamp(),
      force,
      data,
    }),
  });
  const parsed = await readJson(res.status, res.body);
  return normalizeStatus({
    revision: parsed.revision,
    deviceId: await deviceId(),
    syncedAt: parsed.serverTime ?? null,
    counts: parsed.counts,
  });
}

export async function pullSnapshot(): Promise<SyncSnapshot> {
  const res = await request(`${API_BASE}/api/sync`, {
    headers: { Accept: 'application/json', ...requireAuthHeader() },
  });
  const parsed = await readJson(res.status, res.body);
  const raw = (parsed.data ?? {}) as Record<string, unknown>;

  const data: Partial<Record<TableName, Record<string, unknown>[]>> = {};
  for (const table of TABLES) {
    const rows = raw[table];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`服务器返回的 ${table} 不是数组`);
    data[table] = rows as Record<string, unknown>[];
  }
  if (!data.item) throw new Error('服务器上还没有同步过数据');

  return {
    revision: Number(parsed.revision ?? 0),
    deviceId: parsed.deviceId ?? null,
    syncedAt: parsed.syncedAt ?? null,
    data,
  };
}

/** 用服务器快照覆盖本地；调用方负责确认和刷新 store */
export async function applySnapshot(snapshot: SyncSnapshot): Promise<void> {
  await replaceAllTables(snapshot.data);
}
