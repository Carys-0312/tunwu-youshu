/**
 * 后台静默同步：登录后自动把本机快照推到服务器，换设备登录时自动把服务器数据拉回来。
 * 原则是「不打扰」：失败只记日志，数据始终以本机为准；冲突按最后写入者覆盖处理。
 * 普通用户在「我的」页看不到同步入口（入口藏在「关于」连点 5 次里），所以这里兜底。
 */

import type { TableName } from '@/types/models';
import { TABLES } from '@/db/schema';
import { readAllTables, removeDemoRows, replaceAllTables } from '@/db/repo';
import { isDemoSnapshot, stripDemoRows } from '@/db/demo';
import { getSession } from './auth';
import { getLocalOwner, setLocalOwner } from './local-data-owner';
import { fetchSyncStatus, pushSnapshot, pullSnapshot } from './sync';
import { logDetail, logInfo, logWarn } from './logger';

export interface AutoSyncHooks {
  /** 等本地库准备好再算指纹，由 App 启动时注入 */
  ensureReady?: () => Promise<void>;
  /** 从服务器恢复完数据后刷新页面状态，由 App 启动时注入 */
  onApplied?: () => Promise<void> | void;
}

interface SyncState {
  revision: number;
  /** 上次同步成功时的本地内容指纹，用来判断本机有没有新改动 */
  checksum: string;
}

const STATE_PREFIX = 'auto_sync_state:';
const TICK_MS = 15_000;
const REMOTE_COOLDOWN_MS = 60_000;
const RETRY_COOLDOWN_MS = 60_000;

let hooks: AutoSyncHooks = {};
let running = false;
/** 登录 / 注册 / 找回密码正在处理本机数据归属时暂停同步，避免把旧账号的数据推出去 */
let suspended = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastRemoteCheck = 0;
let retryAfter = 0;
/** 离线时每 15 秒重试一次，别把日志刷满；失败提示最多 5 分钟记一条 */
let lastFailureLogAt = 0;

export function configureAutoSync(next: AutoSyncHooks): void {
  hooks = { ...hooks, ...next };
}

/** 账号切换期间调用，处理完本机数据归属后必须恢复 */
export function setAutoSyncSuspended(value: boolean): void {
  suspended = value;
}

/** 归属不一致只提示一次，避免每 15 秒刷一条日志 */
let ownerWarnFor = '';

function warnOwnerMismatch(userId: string): void {
  if (ownerWarnFor === userId) return;
  ownerWarnFor = userId;
  logWarn('同步', '本机数据属于其他账号，已跳过同步', '退出后重新登录当前账号会自动处理');
}

function stateKey(userId: string): string {
  return `${STATE_PREFIX}${userId}`;
}

function loadState(userId: string): SyncState | null {
  try {
    const raw = uni.getStorageSync(stateKey(userId));
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const revision = Number(parsed?.revision);
    if (!Number.isFinite(revision) || typeof parsed?.checksum !== 'string') return null;
    return { revision, checksum: parsed.checksum };
  } catch {
    return null;
  }
}

function saveState(userId: string, state: SyncState): void {
  try {
    uni.setStorageSync(stateKey(userId), JSON.stringify(state));
  } catch (err) {
    console.warn('[auto-sync] 保存同步状态失败', err);
  }
}

/** 内容指纹：行顺序无关，任何一张表发生变化都会变 */
async function localChecksum(): Promise<string> {
  const data = await readAllTables();
  const parts: string[] = [];
  for (const table of TABLES) {
    const rows = (data[table as TableName] ?? []) as Record<string, unknown>[];
    const encoded = rows.map((row) => JSON.stringify(row)).sort();
    parts.push(`${table}:${encoded.join('\n')}`);
  }
  const input = parts.join('|');
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = (h1 * 33) ^ code;
    h2 = (h2 * 31) ^ code;
  }
  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}-${input.length}`;
}

async function pullAndApply(): Promise<number> {
  const snapshot = await pullSnapshot();

  if (isDemoSnapshot(snapshot.data)) {
    // 服务器上只有演示数据（早期注册时被推上去的）：不拉回本地；
    // 先清掉本机残留的演示行，再推本机快照把服务器覆盖掉
    const removed = await removeDemoRows();
    const result = await pushSnapshot(true);
    logInfo(
      '同步',
      removed ? `服务器上是演示数据；本机也清掉了 ${removed} 处，已覆盖服务器快照` : '服务器上是演示数据，已用本机数据覆盖',
      `旧修订 ${snapshot.revision} → 新修订 ${result.revision}`,
    );
    await hooks.onApplied?.();
    return result.revision;
  }

  const cleaned = stripDemoRows(snapshot.data);
  if (cleaned.changed) {
    // 服务器快照混着演示数据和真实数据：应用清理后的版本，并把干净快照推回去
    await replaceAllTables(cleaned.data);
    const result = await pushSnapshot(!(cleaned.data.item?.length));
    logInfo(
      '同步',
      `服务器快照里有 ${cleaned.changedRows} 处演示数据，已清理并回写`,
      `旧修订 ${snapshot.revision} → 新修订 ${result.revision}`,
    );
    await hooks.onApplied?.();
    return result.revision;
  }

  await replaceAllTables(snapshot.data);
  logInfo('同步', '已拉取服务器数据', `修订 ${snapshot.revision}`);
  await hooks.onApplied?.();
  return snapshot.revision;
}

/** 手动同步（调试面板）成功后调用，免得后台又重复推一遍 */
export async function rememberSync(revision: number): Promise<void> {
  const session = getSession();
  if (!session) return;
  try {
    saveState(session.user.id, { revision, checksum: await localChecksum() });
  } catch (err) {
    console.warn('[auto-sync] 记录同步状态失败', err);
  }
}

/**
 * 跑一次同步：
 * - 本机没改过、服务器也没有更新 → 直接返回（不发请求）
 * - 这台设备第一次同步这个账号：服务器有数据就先拉下来，没有就把本机推上去
 * - 本机改过 → 推送；没改过但服务器 revision 更新 → 拉取
 */
export async function runAutoSync(options: { checkRemote?: boolean } = {}): Promise<void> {
  const session = getSession();
  if (!session) return;
  if (suspended || running || Date.now() < retryAfter) return;

  running = true;
  try {
    await hooks.ensureReady?.();
    const userId = session.user.id;

    // 本机数据必须属于当前账号才允许同步。登录流程会先处理归属；
    // 老版本升级没有归属记录时，沿用旧行为把当前登录态视为数据主人。
    const owner = getLocalOwner();
    if (owner === undefined) {
      setLocalOwner(userId);
    } else if (owner !== userId) {
      warnOwnerMismatch(userId);
      return;
    }

    // 登录状态下本机不该再有任何演示数据：清掉后再算指纹，算出来的就是干净快照
    try {
      const removed = await removeDemoRows();
      if (removed) logInfo('同步', `已清理本机 ${removed} 处演示数据`);
    } catch (err) {
      console.warn('[auto-sync] 清理本机演示数据失败', err);
    }

    const checksum = await localChecksum();
    const state = loadState(userId);
    const dirty = !state || state.checksum !== checksum;

    const checkRemote = Boolean(options.checkRemote)
      && Date.now() - lastRemoteCheck > REMOTE_COOLDOWN_MS;
    if (!dirty && !checkRemote) return;
    if (checkRemote) lastRemoteCheck = Date.now();

    const status = await fetchSyncStatus();
    const serverHasData = status.revision > 0 && Number(status.counts?.item ?? 0) > 0;

    if (!state && serverHasData) {
      // 新设备第一次登录这个账号：先拿服务器的数据，别用本机的演示数据覆盖
      const revision = await pullAndApply();
      saveState(userId, { revision, checksum: await localChecksum() });
      return;
    }

    if (!dirty) {
      if (status.revision > (state as SyncState).revision && serverHasData) {
        const revision = await pullAndApply();
        saveState(userId, { revision, checksum: await localChecksum() });
      }
      return;
    }

    // 本机有新改动：以本机为准推送
    const result = await pushSnapshot();
    saveState(userId, { revision: result.revision, checksum });
    logInfo('同步', '已推送本机数据', `修订 ${result.revision}`);
  } catch (err) {
    // 离线、服务端拒绝覆盖等情况都不打扰用户，过一会儿再试
    retryAfter = Date.now() + RETRY_COOLDOWN_MS;
    console.warn('[auto-sync] 本次同步跳过', err);
    if (Date.now() - lastFailureLogAt > 5 * 60_000) {
      lastFailureLogAt = Date.now();
      logWarn('同步', '同步没成功，稍后自动重试', logDetail(err));
    }
  } finally {
    running = false;
  }
}

/** 启动后台定时检查（只读本地指纹，有变化才发请求） */
export function startAutoSync(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runAutoSync();
  }, TICK_MS);
}
